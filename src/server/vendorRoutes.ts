import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { isTimeZone } from '../ids.js';
import { runInTenant } from '../tenancy/context.js';
import { backupEverything } from '../tenancy/housekeeping.js';
import { RegistryError, SlugTakenError } from '../tenancy/registry.js';
import type { Registry } from '../tenancy/registry.js';
import type { Tenants } from '../tenancy/tenants.js';
import type { AuthConfig } from './app.js';
import { createInvitation, invitationLink } from './invitations.js';

/**
 * Looking after the service: the companies on it, and who looks after it.
 *
 * Only the vendor's own people reach any of this. They belong to no company,
 * so they have no designs of their own; what they have is every company's
 * settings, which is what onboarding one takes — a new company's logo and
 * prices are put in place before its first person ever signs in.
 */

const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

/** What the vendor sees of a company at a glance. */
function summary(registry: Registry, tenants: Tenants, tenantId: string) {
  const tenant = registry.tenant(tenantId)!;
  const people = registry.listUsers(tenant.id);
  let designs: number | null = null;
  let clients: number | null = null;
  let lastSaved: string | null = null;
  try {
    const store = tenants.context(tenant).handle.require();
    const held = store.listDesigns();
    designs = held.length;
    clients = store.readClients().length;
    lastSaved = held.reduce<string | null>((latest, d) => (latest === null || d.updatedAt > latest ? d.updatedAt : latest), null);
  } catch {
    // A folder that cannot be reached is reported as unknown rather than as
    // a company with nothing in it.
  }
  return {
    ...tenant,
    people: people.length,
    signedUp: people.filter((p) => p.hasPassword).length,
    lastLogin: people.reduce<string | null>((latest, p) => (p.lastLoginAt && (latest === null || p.lastLoginAt > latest) ? p.lastLoginAt : latest), null),
    designs,
    clients,
    lastSaved,
  };
}

export function vendorRoutes(registry: Registry, tenants: Tenants, auth: AuthConfig): Router {
  const router = Router();

  router.get('/companies', wrap((_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json(registry.listTenants().map((t) => summary(registry, tenants, t.id)));
  }));

  /**
   * A new company, and optionally the link that lets its first administrator
   * in. Its folder is made now, so the vendor can put its branding and prices
   * in place before that link is ever followed.
   */
  router.post('/companies', wrap((req, res) => {
    const body = req.body as { slug?: unknown; name?: unknown; timezone?: unknown; adminEmail?: unknown };
    const timezone = typeof body.timezone === 'string' && body.timezone !== '' ? body.timezone : 'UTC';
    if (!isTimeZone(timezone)) {
      res.status(400).json({ error: `"${timezone}" is not a time zone name. Use one like Asia/Kolkata.` });
      return;
    }
    const tenant = registry.createTenant({
      slug: typeof body.slug === 'string' ? body.slug : '',
      name: typeof body.name === 'string' ? body.name : '',
      timezone,
    });
    tenants.context(tenant);

    let link: string | null = null;
    if (typeof body.adminEmail === 'string' && body.adminEmail.trim() !== '') {
      const { token } = createInvitation(registry, {
        kind: 'invite',
        tenantId: tenant.id,
        email: body.adminEmail.trim(),
        role: 'admin',
        invitedBy: req.principal?.user.id ?? null,
      });
      link = invitationLink(auth.publicUrl, token);
    }
    res.status(201).json({ company: summary(registry, tenants, tenant.id), link });
  }));

  const companyOf = (req: Request, res: Response) => {
    const tenant = registry.tenantBySlug(String(req.params.slug));
    if (!tenant) res.status(404).json({ error: 'No such company' });
    return tenant ?? null;
  };

  router.post('/companies/:slug/suspend', wrap((req, res) => {
    const tenant = companyOf(req, res);
    if (!tenant) return;
    registry.setTenantStatus(tenant.id, 'suspended');
    res.json(summary(registry, tenants, tenant.id));
  }));

  router.post('/companies/:slug/resume', wrap((req, res) => {
    const tenant = companyOf(req, res);
    if (!tenant) return;
    registry.setTenantStatus(tenant.id, 'active');
    res.json(summary(registry, tenants, tenant.id));
  }));

  router.patch('/companies/:slug', wrap((req, res) => {
    const tenant = companyOf(req, res);
    if (!tenant) return;
    const body = req.body as { name?: unknown; timezone?: unknown };
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : tenant.name;
    const timezone = typeof body.timezone === 'string' && body.timezone !== '' ? body.timezone : tenant.timezone;
    if (!isTimeZone(timezone)) {
      res.status(400).json({ error: `"${timezone}" is not a time zone name.` });
      return;
    }
    registry.updateTenant(tenant.id, { name, timezone });
    res.json(summary(registry, tenants, tenant.id));
  }));

  /** Every company's library, and the registry, right now. */
  router.post('/backup', wrap((_req, res) => {
    res.json(backupEverything(tenants, registry, { keep: 30 }));
  }));

  /* ------------------------------------------- who looks after the service */

  router.get('/people', wrap((_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json({ users: registry.listUsers(null), invitations: registry.listInvitations(null) });
  }));

  router.post('/invitations', wrap((req, res) => {
    const email = (req.body as { email?: unknown }).email;
    if (typeof email !== 'string' || email.trim() === '') {
      res.status(400).json({ error: 'An email address is needed' });
      return;
    }
    if (registry.userByEmail(email)) {
      res.status(409).json({ error: `${email.trim()} already has an account.` });
      return;
    }
    const { invitation, token } = createInvitation(registry, {
      kind: 'invite',
      tenantId: null,
      email: email.trim(),
      role: 'vendor',
      invitedBy: req.principal?.user.id ?? null,
    });
    res.status(201).json({ invitation, link: invitationLink(auth.publicUrl, token) });
  }));

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SlugTakenError) {
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

/**
 * Work on a company the vendor named, as though signed in to it.
 *
 * The company's own administrator reaches the same routes with the company
 * taken from their session; the vendor names it in the address. Either way,
 * what runs afterwards has the company in context and cannot tell which.
 */
export function enterCompany(registry: Registry, tenants: Tenants) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenant = registry.tenantBySlug(String(req.params.slug));
    if (!tenant) {
      res.status(404).json({ error: 'No such company' });
      return;
    }
    runInTenant(tenants.context(tenant), next);
  };
}
