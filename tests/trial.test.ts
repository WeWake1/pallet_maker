import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { createInvitation } from '../src/server/invitations.js';
import { Registry, tenantOpen } from '../src/tenancy/registry.js';
import { Tenants } from '../src/tenancy/tenants.js';
import {
  cleanupStores,
  closeRegistries,
  EDITOR_HEADER,
  seedTenant,
  seedVendor,
  signIn,
  tempDataRoot,
  tempRegistry,
} from './helpers.js';

/**
 * A company that may only sign in until a date: a trial.
 *
 * Past the date it is shut exactly as a suspended one is — at the sign-in
 * form, for sessions already open, and at an invitation — and moving the date
 * or clearing it lets everybody straight back in with nothing lost.
 */

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';
const DAY = 24 * 60 * 60 * 1000;

let server: Server | undefined;
let base = '';
let staticDir: string;
let dataRoot: string;

async function serve(registry: Registry): Promise<void> {
  const tenants = new Tenants(dataRoot, registry);
  const app = createApp(tenants, {
    staticDir,
    auth: { registry, secret: SECRET, secure: false, publicUrl: 'https://pallets.example.test' },
  });
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(method: string, path: string, cookie: string | null, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...EDITOR_HEADER,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

beforeEach(() => {
  staticDir = mkdtempSync(join(tmpdir(), 'pallet-editor-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>editor</title>');
  dataRoot = tempDataRoot();
});

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  rmSync(staticDir, { recursive: true, force: true });
  cleanupStores();
  closeRegistries();
});

describe('the registry and a trial', () => {
  it('makes companies with no end date unless one is given', () => {
    const registry = tempRegistry();
    const customer = registry.createTenant({ slug: 'customer', name: 'Customer' });
    const trying = registry.createTenant({
      slug: 'trying',
      name: 'Trying',
      accessUntil: new Date(Date.now() + 7 * DAY).toISOString(),
    });
    expect(registry.tenant(customer.id)?.accessUntil).toBeNull();
    expect(registry.tenant(trying.id)?.accessUntil).toBe(trying.accessUntil);
    expect(tenantOpen(registry.tenant(trying.id)!)).toBe(true);
  });

  it('counts a company past its date as shut, and a suspended one too', () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme' });
    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 1000).toISOString());
    expect(tenantOpen(registry.tenant(tenant.id)!)).toBe(false);
    registry.setTenantAccessUntil(tenant.id, null);
    expect(tenantOpen(registry.tenant(tenant.id)!)).toBe(true);
    registry.setTenantStatus(tenant.id, 'suspended');
    expect(tenantOpen(registry.tenant(tenant.id)!)).toBe(false);
  });

  it('refuses a date that is not one', () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme' });
    expect(() => registry.setTenantAccessUntil(tenant.id, 'next tuesday')).toThrow(/not a date/);
  });

  /** The registry on the server was made before trials, and has to open. */
  it('opens a registry from before trials, and every company in it has no end date', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallet-registry-'));
    const path = join(dir, 'registry.sqlite');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE tenants (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      created_at TEXT NOT NULL)`);
    old.exec("INSERT INTO tenants VALUES ('t1', 'ambica', 'Ambica', 'Asia/Kolkata', 'active', '2026-09-01T00:00:00.000Z')");
    old.close();

    const registry = new Registry(path);
    try {
      const ambica = registry.tenantBySlug('ambica')!;
      expect(ambica.accessUntil).toBeNull();
      expect(tenantOpen(ambica)).toBe(true);
      registry.setTenantAccessUntil(ambica.id, '2030-01-01T00:00:00.000Z');
      expect(registry.tenantBySlug('ambica')?.accessUntil).toBe('2030-01-01T00:00:00.000Z');
    } finally {
      registry.close();
      rmSync(dir, { recursive: true, force: true });
    }
    // Opening it a second time finds the column already there.
    expect(() => new Registry(':memory:').close()).not.toThrow();
  });
});

describe('the door, for a company whose trial has ended', () => {
  it('tells somebody with the right password why they cannot come in', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry, { name: 'Acme Pallets' });
    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 1000).toISOString());
    await serve(registry);

    const refused = await call('POST', '/api/auth/login', null, { email: user.email, password });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/Acme Pallets's trial of Pallet Spec has ended/);
  });

  it('tells a stranger with the wrong password nothing more than it tells anybody', async () => {
    const registry = tempRegistry();
    const { tenant, user } = await seedTenant(registry);
    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 1000).toISOString());
    await serve(registry);

    const refused = await call('POST', '/api/auth/login', null, { email: user.email, password: 'not the password' });
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe('That email and password do not match an account.');
  });

  it('ends a session already open the moment the date goes by', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() + DAY).toISOString());
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/dashboard', cookie)).status).toBe(200);

    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 1000).toISOString());
    expect((await call('GET', '/api/dashboard', cookie)).status).toBe(401);
  });

  it('will not let an invitation into it be used', async () => {
    const registry = tempRegistry();
    const { tenant } = await seedTenant(registry);
    const { token } = createInvitation(registry, {
      kind: 'invite',
      tenantId: tenant.id,
      email: 'late@acme.test',
      role: 'member',
      invitedBy: null,
    });
    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 1000).toISOString());
    await serve(registry);

    expect((await call('GET', `/api/auth/invitation/${token}`, null)).status).toBe(404);
    const accepted = await call('POST', '/api/auth/accept', null, { token, name: 'Late', password: 'a long enough password' });
    expect(accepted.status).toBe(400);
    expect(registry.userByEmail('late@acme.test')).toBeUndefined();
  });

  it('says when the trial ends, to whoever is in it', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    const until = new Date(Date.now() + 3 * DAY).toISOString();
    registry.setTenantAccessUntil(tenant.id, until);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/session', cookie)).body.company.accessUntil).toBe(until);
  });
});

describe('the vendor and trials', () => {
  it('makes a company as a trial of so many days', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const made = await call('POST', '/api/vendor/companies', cookie, { slug: 'northgate', name: 'Northgate', trialDays: 7 });
    expect(made.status).toBe(201);
    const left = Date.parse(made.body.company.accessUntil) - Date.now();
    expect(left).toBeGreaterThan(7 * DAY - 60_000);
    expect(left).toBeLessThanOrEqual(7 * DAY);

    const customer = await call('POST', '/api/vendor/companies', cookie, { slug: 'customer', name: 'Customer', trialDays: null });
    expect(customer.body.company.accessUntil).toBeNull();
  });

  it('refuses a trial that is not a sensible number of days', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    for (const trialDays of [0, -3, 2.5, 1000, 'soon']) {
      const made = await call('POST', '/api/vendor/companies', cookie, { slug: 'northgate', name: 'Northgate', trialDays });
      expect(made.status, String(trialDays)).toBe(400);
    }
    expect(registry.tenantBySlug('northgate')).toBeUndefined();
  });

  it('adds days to a trial from its end, or from today once it has run out', async () => {
    const registry = tempRegistry();
    const { tenant } = await seedTenant(registry, { slug: 'acme' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const end = Date.now() + 2 * DAY;
    registry.setTenantAccessUntil(tenant.id, new Date(end).toISOString());
    const extended = await call('POST', '/api/vendor/companies/acme/access', cookie, { addDays: 7 });
    expect(extended.status).toBe(200);
    expect(Date.parse(extended.body.accessUntil)).toBe(end + 7 * DAY);

    registry.setTenantAccessUntil(tenant.id, new Date(Date.now() - 30 * DAY).toISOString());
    const reopened = await call('POST', '/api/vendor/companies/acme/access', cookie, { addDays: 7 });
    expect(Date.parse(reopened.body.accessUntil) - Date.now()).toBeGreaterThan(7 * DAY - 60_000);
  });

  it('starts a trial on a company that had no end, and takes the end away again', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const trial = await call('POST', '/api/vendor/companies/acme/access', cookie, { addDays: 7 });
    expect(trial.body.accessUntil).not.toBeNull();

    registry.setTenantAccessUntil(acme.tenant.id, new Date(Date.now() - 1000).toISOString());
    await expect(signIn(base, acme.user.email, acme.password)).rejects.toThrow();

    const customer = await call('POST', '/api/vendor/companies/acme/access', cookie, { unlimited: true });
    expect(customer.body.accessUntil).toBeNull();
    expect(await signIn(base, acme.user.email, acme.password)).toBeTruthy();
  });

  it('refuses a change it cannot read, and a company that is not there', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'acme' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    expect((await call('POST', '/api/vendor/companies/acme/access', cookie, { addDays: 0 })).status).toBe(400);
    expect((await call('POST', '/api/vendor/companies/acme/access', cookie, {})).status).toBe(400);
    expect((await call('POST', '/api/vendor/companies/nobody/access', cookie, { addDays: 7 })).status).toBe(404);
  });

  it('is the vendor\'s alone', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme' });
    await serve(registry);
    const theirs = await signIn(base, acme.user.email, acme.password);
    expect((await call('POST', '/api/vendor/companies/acme/access', theirs, { unlimited: true })).status).toBe(403);
  });
});
