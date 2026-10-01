import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { endOfDay, isTimeZone, today } from '../ids.js';
import { runInTenant } from '../tenancy/context.js';
import { backupEverything } from '../tenancy/housekeeping.js';
import { RegistryError, SlugTakenError } from '../tenancy/registry.js';
import type { Registry } from '../tenancy/registry.js';
import type { Tenants } from '../tenancy/tenants.js';
import type { AuthConfig } from './app.js';
import { invitationMessage, sendInvitation } from './invitations.js';
import { mailFailure } from './mail.js';

/** A trial, unless the vendor says otherwise when making a company. */
export const TRIAL_DAYS = 7;
/** Longer than any trial anybody means; past this it is a typing slip. */
const MAX_TRIAL_DAYS = 366;
/**
 * How far ahead an end date may be set. Further off than a contract runs is a
 * slip of the year, and a customer with no end is given full access instead.
 */
const MAX_AHEAD_YEARS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A whole number of days from 1 to a year, or null for anything else. */
function daysFrom(value: unknown): number | null {
  const days = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(days) && days >= 1 && days <= MAX_TRIAL_DAYS ? days : null;
}

/**
 * Looking after the service: the companies on it, and who looks after it.
 *
 * Only the vendor's own people reach any of this. They belong to no company,
 * so they have no designs of their own; what they have is every company's
 * settings, which is what onboarding one takes — a new company's logo is put
 * in place before its first person ever signs in, and who else may sign in is
 * decided here too.
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
   * A new company, and optionally the link that lets its first person in. Its
   * folder is made now, so the vendor can put its branding in place before
   * that link is ever followed.
   */
  router.post('/companies', wrap(async (req, res) => {
    const body = req.body as {
      slug?: unknown;
      name?: unknown;
      timezone?: unknown;
      firstEmail?: unknown;
      trialDays?: unknown;
    };
    const timezone = typeof body.timezone === 'string' && body.timezone !== '' ? body.timezone : 'UTC';
    if (!isTimeZone(timezone)) {
      res.status(400).json({ error: `"${timezone}" is not a time zone name. Use one like Asia/Kolkata.` });
      return;
    }
    // Absent or null is a company with no end date; anything else has to be
    // a sensible number of days, so a slip does not make a trial of a decade.
    let accessUntil: string | null = null;
    if (body.trialDays !== undefined && body.trialDays !== null) {
      const days = daysFrom(body.trialDays);
      if (days === null) {
        res.status(400).json({ error: `A trial is a whole number of days, from 1 to ${MAX_TRIAL_DAYS}.` });
        return;
      }
      accessUntil = new Date(Date.now() + days * DAY_MS).toISOString();
    }
    const tenant = registry.createTenant({
      slug: typeof body.slug === 'string' ? body.slug : '',
      name: typeof body.name === 'string' ? body.name : '',
      timezone,
      accessUntil,
    });
    tenants.context(tenant);

    let sent = null;
    if (typeof body.firstEmail === 'string' && body.firstEmail.trim() !== '') {
      sent = await sendInvitation(registry, auth, {
        kind: 'invite',
        tenantId: tenant.id,
        email: body.firstEmail.trim(),
        role: 'member',
        invitedBy: req.principal?.user.id ?? null,
      });
    }
    res.status(201).json({
      company: summary(registry, tenants, tenant.id),
      link: sent?.link ?? null,
      emailed: sent?.emailed ?? false,
      mailProblem: sent?.mailProblem ?? null,
    });
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

  /**
   * How long a company may go on signing in.
   *
   * `{ addDays: 7 }` gives it seven more days — counted from today where its
   * trial has already run out, or has never had an end, so extending a lapsed
   * trial always leaves a week to use rather than a week that is half gone.
   * `{ until: '2026-10-09' }` lets it in to the end of that day, in the
   * company's own time zone, for when the answer is a date rather than a
   * number of days. `{ unlimited: true }` takes the end date away: a customer,
   * rather than somebody trying it. Shutting a company at once is Suspend,
   * above.
   */
  router.post('/companies/:slug/access', wrap((req, res) => {
    const tenant = companyOf(req, res);
    if (!tenant) return;
    const body = req.body as { addDays?: unknown; until?: unknown; unlimited?: unknown };
    if (body.unlimited === true) {
      registry.setTenantAccessUntil(tenant.id, null);
    } else if (body.until !== undefined) {
      const day = typeof body.until === 'string' ? body.until : '';
      const end = endOfDay(day, tenant.timezone);
      if (end === null) {
        res.status(400).json({ error: 'Say which day, as YYYY-MM-DD.' });
        return;
      }
      // Compared as text, which for ISO dates is the same as comparing days.
      if (day < today(tenant.timezone)) {
        res.status(400).json({ error: `${day} has gone by already. To shut ${tenant.name} out now, suspend it.` });
        return;
      }
      if (Date.parse(end) - Date.now() > MAX_AHEAD_YEARS * 366 * DAY_MS) {
        res.status(400).json({
          error: `${day} is more than ${MAX_AHEAD_YEARS} years away. For a company with no end date, give it full access.`,
        });
        return;
      }
      registry.setTenantAccessUntil(tenant.id, end);
    } else {
      const days = daysFrom(body.addDays);
      if (days === null) {
        res.status(400).json({ error: `Say how many days to add, from 1 to ${MAX_TRIAL_DAYS}.` });
        return;
      }
      const held = tenant.accessUntil === null ? Date.now() : Math.max(Date.now(), Date.parse(tenant.accessUntil));
      registry.setTenantAccessUntil(tenant.id, new Date(held + days * DAY_MS).toISOString());
    }
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

  router.post('/invitations', wrap(async (req, res) => {
    const email = (req.body as { email?: unknown }).email;
    if (typeof email !== 'string' || email.trim() === '') {
      res.status(400).json({ error: 'An email address is needed' });
      return;
    }
    if (registry.userByEmail(email)) {
      res.status(409).json({ error: `${email.trim()} already has an account.` });
      return;
    }
    const sent = await sendInvitation(registry, auth, {
      kind: 'invite',
      tenantId: null,
      email: email.trim(),
      role: 'vendor',
      invitedBy: req.principal?.user.id ?? null,
    });
    res.status(201).json(sent);
  }));

  /* ------------------------------------------------------------- email */

  /** Whether this server sends mail, and as whom, for the vendor's screen. */
  router.get('/mail', wrap((_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json({ configured: Boolean(auth.mailer), from: auth.mailer?.from ?? null });
  }));

  /**
   * A test email to whoever pressed the button, so the settings can be
   * checked without inviting anybody. It is an invitation in form, with a
   * link that goes nowhere, so what arrives is what a customer would see.
   */
  router.post('/mail/test', wrap(async (req, res) => {
    const to = req.principal?.user.email;
    if (!auth.mailer || !to) {
      res.status(409).json({ error: 'This server is not set up to send email. See PALLET_SMTP_HOST in deploy/env.example.' });
      return;
    }
    try {
      await auth.mailer.send(
        invitationMessage({
          kind: 'invite',
          email: to,
          companyName: 'Test Company (a test email — this link does nothing)',
          link: `${auth.publicUrl.replace(/\/+$/, '')}/#/`,
          expiresAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        }),
      );
      res.json({ to });
    } catch (error) {
      res.status(502).json({ error: `The mail server would not take it: ${mailFailure(error)}` });
    }
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
 * The company is named in the address rather than taken from a session, since
 * the vendor belongs to none. What runs afterwards has it in context, the
 * same way a request from somebody at that company would.
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
