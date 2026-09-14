import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readBrandFile, writeBrandFile, storeLogo, removeLogo, storeFont, removeFont, BrandWriteError, logoOnDisk, fontOnDisk } from '../brand/write.js';
import { LogoError } from '../brand/logoFile.js';
import type { BrandFile } from '../brand/schema.js';
import { loadRates } from '../costing/load.js';
import { RATES_FILE } from '../costing/resolve.js';
import { parseRates } from '../costing/rates.js';
import { analysePallet } from '../geometry/layout.js';
import { parsePallet } from '../schema.js';
import { renderSheet } from '../sheet/sheet.js';
import { writeAtomic } from '../store/files.js';
import { currentTenant } from '../tenancy/context.js';
import { EmailTakenError, RegistryError } from '../tenancy/registry.js';
import type { Registry, Role } from '../tenancy/registry.js';
import previewDesign from '../../fixtures/wing-both-decks.json' with { type: 'json' };
import type { AuthConfig } from './app.js';
import { createInvitation, invitationLink } from './invitations.js';

/**
 * Looking after a company: who is in it, whose name is on its sheets, and what
 * it quotes at.
 *
 * Everything here reads and writes the company in context, and nothing here
 * decides which company that is — the same router answers an administrator
 * working on their own company and the vendor working on any, because the
 * middleware in front of it has already settled whose folder this is.
 *
 * What it writes is the files an administrator with a shell could have written
 * by hand: `brand.json`, the artwork under `brand/`, `rates.json`. So there is
 * one way a company's brand is stored, whichever way it got there.
 */

/** A file sent from the browser: its name, and its bytes as base64. */
interface Upload {
  name?: unknown;
  data?: unknown;
}

function bytesOf(upload: Upload): { name: string; bytes: Buffer } {
  if (typeof upload.name !== 'string' || typeof upload.data !== 'string') {
    throw new BrandWriteError('A file needs a name and its contents');
  }
  return { name: upload.name, bytes: Buffer.from(upload.data, 'base64') };
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

const fresh = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
};

export function adminRoutes(registry: Registry, auth: AuthConfig): Router {
  const router = Router();

  /* -------------------------------------------------------------- people */

  router.get('/people', wrap((_req, res) => {
    const { tenant } = currentTenant();
    fresh(res);
    res.json({
      users: registry.listUsers(tenant.id),
      invitations: registry.listInvitations(tenant.id),
    });
  }));

  /** Invite somebody. The link is shown once, to whoever is sending it. */
  router.post('/invitations', wrap((req, res) => {
    const { tenant } = currentTenant();
    const body = req.body as { email?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
    if (email === '' || !role) {
      res.status(400).json({ error: 'An email address and a role (admin or member) are needed' });
      return;
    }
    if (registry.userByEmail(email)) {
      res.status(409).json({ error: `${email} already has an account. Send them a new-password link instead.` });
      return;
    }
    const { invitation, token } = createInvitation(registry, {
      kind: 'invite',
      tenantId: tenant.id,
      email,
      role: role as Role,
      invitedBy: req.principal?.user.id ?? null,
    });
    res.status(201).json({ invitation, link: invitationLink(auth.publicUrl, token) });
  }));

  router.delete('/invitations/:id', wrap((req, res) => {
    const { tenant } = currentTenant();
    const held = registry.listInvitations(tenant.id).find((i) => i.id === String(req.params.id));
    if (!held) {
      res.status(404).json({ error: 'No such invitation' });
      return;
    }
    registry.deleteInvitation(held.id);
    res.status(204).end();
  }));

  /** Somebody in this company, or nothing. Never somebody in another. */
  const personHere = (req: Request, res: Response) => {
    const { tenant } = currentTenant();
    const user = registry.user(String(req.params.id));
    if (!user || user.tenantId !== tenant.id) {
      res.status(404).json({ error: 'No such person here' });
      return null;
    }
    return user;
  };

  /** A way back in for somebody who has lost their password. */
  router.post('/people/:id/reset', wrap((req, res) => {
    const user = personHere(req, res);
    if (!user) return;
    const { token } = createInvitation(registry, {
      kind: 'reset',
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      invitedBy: req.principal?.user.id ?? null,
    });
    res.json({ link: invitationLink(auth.publicUrl, token) });
  }));

  router.post('/people/:id/disable', wrap((req, res) => {
    const user = personHere(req, res);
    if (!user) return;
    // Nobody may turn themselves off: the company would be left with one
    // fewer administrator and no one to notice.
    if (user.id === req.principal?.user.id) {
      res.status(400).json({ error: 'You cannot turn off your own account.' });
      return;
    }
    registry.setUserStatus(user.id, 'disabled');
    res.json(registry.user(user.id));
  }));

  router.post('/people/:id/enable', wrap((req, res) => {
    const user = personHere(req, res);
    if (!user) return;
    registry.setUserStatus(user.id, 'active');
    res.json(registry.user(user.id));
  }));

  router.post('/people/:id/role', wrap((req, res) => {
    const user = personHere(req, res);
    if (!user) return;
    const role = (req.body as { role?: unknown }).role;
    if (role !== 'admin' && role !== 'member') {
      res.status(400).json({ error: 'A role is either admin or member' });
      return;
    }
    if (user.id === req.principal?.user.id && role === 'member') {
      res.status(400).json({ error: 'You cannot take administration away from your own account.' });
      return;
    }
    registry.setUserRole(user.id, role);
    res.json(registry.user(user.id));
  }));

  /* --------------------------------------------------------------- brand */

  /**
   * The brand as it is written, for the form — and where the sheet is
   * actually getting it from, which is not always the same thing.
   */
  router.get('/brand', wrap((_req, res) => {
    const context = currentTenant();
    const root = context.handle.require().root;
    const inUse = context.brand();
    fresh(res);
    res.json({
      file: readBrandFile(root),
      from: inUse.from,
      problem: inUse.problem,
      logo: logoOnDisk(root),
      font: fontOnDisk(root),
    });
  }));

  /**
   * Write the brand file. The artwork it names is not sent here — that goes
   * through the upload routes below, and this keeps whatever they put there.
   */
  router.put('/brand', wrap((req, res) => {
    const root = currentTenant().handle.require().root;
    const body = req.body as Partial<BrandFile>;
    const held = readBrandFile(root);
    const file: BrandFile = {
      ...(held ?? ({} as BrandFile)),
      ...body,
      // What is on disk is the truth about the artwork, whatever the form said.
      logo: logoOnDisk(root),
      font: held?.font && fontOnDisk(root) ? { ...held.font, ...(body.font ?? {}), file: fontOnDisk(root)! } : null,
    };
    writeBrandFile(root, file);
    res.json({ file: readBrandFile(root) });
  }));

  router.post('/brand/logo', wrap((req, res) => {
    const root = currentTenant().handle.require().root;
    const { bytes } = bytesOf(req.body as Upload);
    const logo = storeLogo(root, bytes);
    const held = readBrandFile(root) ?? ({} as BrandFile);
    writeBrandFile(root, { ...held, logo });
    res.json({ logo });
  }));

  router.delete('/brand/logo', wrap((_req, res) => {
    const root = currentTenant().handle.require().root;
    removeLogo(root);
    const held = readBrandFile(root);
    if (held) writeBrandFile(root, { ...held, logo: null });
    res.status(204).end();
  }));

  router.post('/brand/font', wrap((req, res) => {
    const root = currentTenant().handle.require().root;
    const body = req.body as Upload & { family?: unknown; advanceEm?: unknown };
    const { name, bytes } = bytesOf(body);
    const family = typeof body.family === 'string' && body.family.trim() !== '' ? body.family.trim() : 'Company face';
    const advanceEm = typeof body.advanceEm === 'number' && body.advanceEm > 0 ? body.advanceEm : undefined;
    const file = storeFont(root, bytes, name);
    const held = readBrandFile(root) ?? ({} as BrandFile);
    writeBrandFile(root, { ...held, font: { family, file, ...(advanceEm === undefined ? {} : { advanceEm }) } });
    res.json({ font: { family, file, advanceEm } });
  }));

  router.delete('/brand/font', wrap((_req, res) => {
    const root = currentTenant().handle.require().root;
    removeFont(root);
    const held = readBrandFile(root);
    if (held) writeBrandFile(root, { ...held, font: null });
    res.status(204).end();
  }));

  /**
   * A sheet, as it will print with the brand as it stands now.
   *
   * Rendered from a design that ships with the program rather than from one
   * of the company's own, so there is always something to show — a company
   * setting itself up has drawn nothing yet — and so what is shown is the same
   * sheet for everybody, which is what makes two brands comparable.
   */
  router.get('/preview', wrap((_req, res) => {
    const brand = currentTenant().brand().brand;
    const pallet = parsePallet(previewDesign);
    fresh(res);
    res.type('html').send(renderSheet(pallet, analysePallet(pallet), { brand }));
  }));

  /* --------------------------------------------------------------- rates */

  router.get('/rates', wrap((_req, res) => {
    const context = currentTenant();
    const inUse = context.rates();
    fresh(res);
    res.json({ rates: inUse.rates, from: inUse.from, problem: inUse.problem });
  }));

  /**
   * Write the prices. Checked the way the resolver checks them, so a file that
   * would be refused at costing time is refused here instead.
   */
  router.put('/rates', wrap((req, res) => {
    const root = currentTenant().handle.require().root;
    const rates = parseRates(req.body);
    writeAtomic(join(root, RATES_FILE), `${JSON.stringify(rates, null, 2)}\n`);
    res.json({ rates: loadRates(join(root, RATES_FILE)), from: 'folder' });
  }));

  /** Back to the prices this build ships with. */
  router.delete('/rates', wrap((_req, res) => {
    rmSync(join(currentTenant().handle.require().root, RATES_FILE), { force: true });
    res.status(204).end();
  }));

  /* ------------------------------------------------------------- failures */

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof BrandWriteError || error instanceof LogoError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof EmailTakenError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof RegistryError) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  });

  return router;
}
