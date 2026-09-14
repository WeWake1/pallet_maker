import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Registry } from '../src/tenancy/registry.js';
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
 * Looking after a company, and looking after the service.
 *
 * Two doors past the first one: an administrator may change their own
 * company's people, brand and prices; the vendor may do that for any company,
 * and make companies. A member may do neither, and nobody may reach across.
 */

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';

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

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...EDITOR_HEADER, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, text };
}

const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#123456"/></svg>';

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

describe('who may look after what', () => {
  it('keeps a member out of the company settings', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry, { role: 'member' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/admin/people', cookie)).status).toBe(403);
    expect((await call('GET', '/api/admin/brand', cookie)).status).toBe(403);
    // But they can still draw.
    expect((await call('GET', '/api/dashboard', cookie)).status).toBe(200);
  });

  it('keeps an administrator out of the service settings', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry, { role: 'admin' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/vendor/companies', cookie)).status).toBe(403);
    expect((await call('GET', '/api/admin/people', cookie)).status).toBe(200);
  });

  it('never lets one company reach into another', async () => {
    const registry = tempRegistry();
    const a = await seedTenant(registry, { slug: 'aa', email: 'a@aa.test' });
    const b = await seedTenant(registry, { slug: 'bb', email: 'b@bb.test' });
    await serve(registry);
    const cookie = await signIn(base, a.user.email, a.password);

    expect((await call('POST', `/api/admin/people/${b.user.id}/disable`, cookie)).status).toBe(404);
    expect((await call('POST', `/api/admin/people/${b.user.id}/reset`, cookie)).status).toBe(404);
    expect((await call('GET', '/api/admin/people', cookie)).body.users.map((u: any) => u.email)).toEqual(['a@aa.test']);
    expect(registry.user(b.user.id)?.status).toBe('active');
  });
});

describe('an administrator and the people in their company', () => {
  it('invites somebody and is handed the link to send', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    const invited = await call('POST', '/api/admin/invitations', cookie, { email: 'new@acme.test', role: 'member' });
    expect(invited.status).toBe(201);
    expect(invited.body.link).toMatch(/^https:\/\/pallets\.example\.test\/#\/invitation\/[A-Za-z0-9_-]{40,}$/);

    const people = (await call('GET', '/api/admin/people', cookie)).body;
    expect(people.invitations.map((i: any) => i.email)).toEqual(['new@acme.test']);

    expect((await call('DELETE', `/api/admin/invitations/${invited.body.invitation.id}`, cookie)).status).toBe(204);
    expect((await call('GET', '/api/admin/people', cookie)).body.invitations).toEqual([]);
  });

  it('will not invite an address that already has an account', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    const again = await call('POST', '/api/admin/invitations', cookie, { email: user.email, role: 'member' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already has an account/);
  });

  it('turns somebody off, and back on, but never themselves', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    const other = registry.createUser({ tenantId: tenant.id, email: 'other@acme.test', role: 'member' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    expect((await call('POST', `/api/admin/people/${other.id}/disable`, cookie)).body.status).toBe('disabled');
    expect((await call('POST', `/api/admin/people/${other.id}/enable`, cookie)).body.status).toBe('active');
    const self = await call('POST', `/api/admin/people/${user.id}/disable`, cookie);
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/your own account/);
  });

  it('makes somebody an administrator, and never demotes themselves', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    const other = registry.createUser({ tenantId: tenant.id, email: 'other@acme.test', role: 'member' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    expect((await call('POST', `/api/admin/people/${other.id}/role`, cookie, { role: 'admin' })).body.role).toBe('admin');
    expect((await call('POST', `/api/admin/people/${user.id}/role`, cookie, { role: 'member' })).status).toBe(400);
  });

  it('hands out a way back in for somebody who has lost their password', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    const other = registry.createUser({ tenantId: tenant.id, email: 'other@acme.test', role: 'member' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    const reset = await call('POST', `/api/admin/people/${other.id}/reset`, cookie);
    expect(reset.status).toBe(200);
    expect(reset.body.link).toContain('/#/invitation/');
  });
});

describe('an administrator and their company\'s brand', () => {
  it('starts with no brand file, and the sheet the program ships with', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    const brand = await call('GET', '/api/admin/brand', cookie);
    expect(brand.status).toBe(200);
    expect(brand.body.file).toBeNull();
    expect(brand.body.from).toBe('built-in');
    expect(brand.body.logo).toBeNull();
  });

  it('writes the brand file, and the sheet changes without anything restarting', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    const saved = await call('PUT', '/api/admin/brand', cookie, {
      companyName: 'Acme Pallets Ltd',
      projectionNote: 'Third-angle projection, all dimensions in mm',
      tolerances: { component: '± 1 mm', pallet: '± 3 mm' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.file.companyName).toBe('Acme Pallets Ltd');

    const onDisk = JSON.parse(readFileSync(join(dataRoot, 'tenants', tenant.slug, 'brand.json'), 'utf8'));
    expect(onDisk.companyName).toBe('Acme Pallets Ltd');
    expect((await call('GET', '/api/brand', cookie)).body.companyName).toBe('Acme Pallets Ltd');

    const preview = await call('GET', '/api/admin/preview', cookie);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('Acme Pallets Ltd');
    expect(preview.text).toContain('Third-angle projection');
  });

  it('takes a vector logo, puts it in the corner, and takes it away again', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    const put = await call('POST', '/api/admin/brand/logo', cookie, { name: 'mark.svg', data: b64(SVG) });
    expect(put.status).toBe(200);
    expect(put.body.logo).toBe('brand/logo.svg');
    expect(existsSync(join(dataRoot, 'tenants', tenant.slug, 'brand', 'logo.svg'))).toBe(true);
    expect((await call('GET', '/api/admin/preview', cookie)).text).toContain('fill="#123456"');

    expect((await call('DELETE', '/api/admin/brand/logo', cookie)).status).toBe(204);
    expect(existsSync(join(dataRoot, 'tenants', tenant.slug, 'brand', 'logo.svg'))).toBe(false);
    expect((await call('GET', '/api/admin/preview', cookie)).text).not.toContain('fill="#123456"');
  });

  it('refuses a logo that a sheet cannot carry, and says what to do', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>x()</script></svg>';
    const refused = await call('POST', '/api/admin/brand/logo', cookie, { name: 'bad.svg', data: b64(bad) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/cannot carry/);
    expect((await call('GET', '/api/admin/brand', cookie)).body.logo).toBeNull();

    const notAnImage = await call('POST', '/api/admin/brand/logo', cookie, { name: 'x.txt', data: b64('hello') });
    expect(notAnImage.status).toBe(400);
  });

  it('takes a face, names it, and keeps the name when the rest of the brand is saved', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    const fontBytes = readFileSync(join(__dirname, '..', 'config', 'brand', 'font.otf'));
    const put = await call('POST', '/api/admin/brand/font', cookie, {
      name: 'Anything.otf', data: b64(fontBytes), family: 'Acme Face', advanceEm: 0.4,
    });
    expect(put.status).toBe(200);
    expect(put.body.font).toMatchObject({ family: 'Acme Face', file: 'brand/font.otf', advanceEm: 0.4 });

    await call('PUT', '/api/admin/brand', cookie, { companyName: 'Acme' });
    const brand = (await call('GET', '/api/admin/brand', cookie)).body;
    expect(brand.file.font).toMatchObject({ family: 'Acme Face', file: 'brand/font.otf' });
    expect((await call('GET', '/api/admin/preview', cookie)).text).toContain("font-family: 'Acme Face'");

    expect((await call('DELETE', '/api/admin/brand/font', cookie)).status).toBe(204);
    expect((await call('GET', '/api/admin/brand', cookie)).body.file.font).toBeNull();
  });

  it('refuses a file that is not a font', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    const refused = await call('POST', '/api/admin/brand/font', cookie, { name: 'x.exe', data: b64('x'.repeat(2000)) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/\.otf, \.ttf/);
  });
});

describe('an administrator and their company\'s prices', () => {
  it('sees the shipped prices until it writes its own', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    expect((await call('GET', '/api/admin/rates', cookie)).body.from).toBe('built-in');
    const saved = await call('PUT', '/api/admin/rates', cookie, {
      currency: 'GBP', timberPerCft: { default: 40, oak: 90 }, nailsPerThousand: { default: 12 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.from).toBe('folder');
    expect(existsSync(join(dataRoot, 'tenants', tenant.slug, 'rates.json'))).toBe(true);
    expect((await call('GET', '/api/rates', cookie)).body.currency).toBe('GBP');

    expect((await call('DELETE', '/api/admin/rates', cookie)).status).toBe(204);
    expect((await call('GET', '/api/admin/rates', cookie)).body.from).toBe('built-in');
  });

  it('refuses prices that would be refused at costing time', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    const refused = await call('PUT', '/api/admin/rates', cookie, { timberPerCft: { default: 40 } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/currency/);
  });
});

describe('the vendor and the companies', () => {
  it('sees every company at a glance', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const companies = (await call('GET', '/api/vendor/companies', cookie)).body;
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({ slug: 'acme', people: 1, signedUp: 1, designs: 0 });
  });

  it('makes a company, its folder, and the link for its first administrator', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const made = await call('POST', '/api/vendor/companies', cookie, {
      slug: 'northgate', name: 'Northgate Pallets', timezone: 'Europe/London', adminEmail: 'boss@northgate.test',
    });
    expect(made.status).toBe(201);
    expect(made.body.company.slug).toBe('northgate');
    expect(made.body.link).toContain('/#/invitation/');
    expect(existsSync(join(dataRoot, 'tenants', 'northgate', 'designs'))).toBe(true);
    expect(registry.listInvitations(made.body.company.id)).toHaveLength(1);
  });

  it('refuses a company that already exists, and a bad time zone', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'acme' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    expect((await call('POST', '/api/vendor/companies', cookie, { slug: 'acme', name: 'Again' })).status).toBe(409);
    expect((await call('POST', '/api/vendor/companies', cookie, { slug: 'new', name: 'New', timezone: 'Mars/X' })).status).toBe(400);
  });

  it('suspends and resumes a company', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const theirs = await signIn(base, acme.user.email, acme.password);

    expect((await call('POST', '/api/vendor/companies/acme/suspend', cookie)).body.status).toBe('suspended');
    expect((await call('GET', '/api/dashboard', theirs)).status).toBe(401);
    expect((await call('POST', '/api/vendor/companies/acme/resume', cookie)).body.status).toBe('active');
  });

  /** Onboarding: the vendor sets a company up before anybody in it signs in. */
  it('works on a company\'s settings as though signed in to it', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const saved = await call('PUT', '/api/vendor/companies/acme/admin/brand', cookie, { companyName: 'Acme, set up by the vendor' });
    expect(saved.status).toBe(200);
    expect((await call('POST', '/api/vendor/companies/acme/admin/brand/logo', cookie, { name: 'm.svg', data: b64(SVG) })).status).toBe(200);
    expect((await call('GET', '/api/vendor/companies/acme/admin/people', cookie)).body.users.map((u: any) => u.email)).toEqual(['a@acme.test']);
    expect((await call('GET', '/api/vendor/companies/nope/admin/people', cookie)).status).toBe(404);

    // And the company itself sees what was set.
    const theirs = await signIn(base, acme.user.email, acme.password);
    expect((await call('GET', '/api/brand', theirs)).body.companyName).toBe('Acme, set up by the vendor');
    expect((await call('GET', '/api/brand', theirs)).body.logo.kind).toBe('svg');
  });

  it('renames a company and changes its time zone', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'acme' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const changed = await call('PATCH', '/api/vendor/companies/acme', cookie, { name: 'Acme Pallets Limited', timezone: 'Asia/Kolkata' });
    expect(changed.body).toMatchObject({ name: 'Acme Pallets Limited', timezone: 'Asia/Kolkata', slug: 'acme' });
  });

  it('backs everything up on request', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'acme' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const result = await call('POST', '/api/vendor/backup', cookie);
    expect(result.status).toBe(200);
    expect(result.body.companies).toBe(1);
    expect(result.body.failures).toBe(0);
    expect(existsSync(join(dataRoot, 'tenants', 'acme', 'backups'))).toBe(true);
  });

  it('invites another person to look after the service', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const invited = await call('POST', '/api/vendor/invitations', cookie, { email: 'second@vendor.test' });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation.role).toBe('vendor');
    expect((await call('GET', '/api/vendor/people', cookie)).body.invitations).toHaveLength(1);
  });
});
