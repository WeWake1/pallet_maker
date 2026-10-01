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
 * One door past the first one, and only the vendor has the key: a company's
 * people and its brand are the vendor's to set, for any company, and so is
 * making companies. Nobody at a company may do any of it.
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
  /**
   * There is no company-side way in to any of it: the routes are not there at
   * all, whoever at the company is asking.
   */
  it('keeps everybody at a company out of its settings', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    for (const [method, path] of [
      ['GET', '/api/admin/people'],
      ['POST', '/api/admin/invitations'],
      ['POST', `/api/admin/people/${user.id}/reset`],
      ['POST', `/api/admin/people/${user.id}/disable`],
      ['GET', '/api/admin/brand'],
    ] as Array<['GET' | 'POST', string]>) {
      const refused = await call(method, path, cookie, method === 'GET' ? undefined : { email: 'x@acme.test' });
      expect(refused.status, `${method} ${path}`).toBe(404);
    }
    expect(registry.listInvitations(user.tenantId)).toEqual([]);
    expect(registry.user(user.id)?.status).toBe('active');
    // But they can still draw.
    expect((await call('GET', '/api/dashboard', cookie)).status).toBe(200);
  });

  it('keeps everybody at a company out of the vendor\'s side, their own company included', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry, { slug: 'acme' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/vendor/companies', cookie)).status).toBe(403);
    expect((await call('GET', '/api/vendor/companies/acme/admin/people', cookie)).status).toBe(403);
    expect((await call('POST', '/api/vendor/companies/acme/admin/invitations', cookie, { email: 'x@acme.test' })).status).toBe(403);
  });

  it('never lets the vendor, working on one company, reach somebody in another', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { slug: 'aa', email: 'a@aa.test' });
    const b = await seedTenant(registry, { slug: 'bb', email: 'b@bb.test' });
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    expect((await call('POST', `/api/vendor/companies/aa/admin/people/${b.user.id}/disable`, cookie)).status).toBe(404);
    expect((await call('POST', `/api/vendor/companies/aa/admin/people/${b.user.id}/reset`, cookie)).status).toBe(404);
    expect((await call('DELETE', `/api/vendor/companies/aa/admin/people/${b.user.id}`, cookie)).status).toBe(404);
    expect((await call('GET', '/api/vendor/companies/aa/admin/people', cookie)).body.users.map((u: any) => u.email)).toEqual(['a@aa.test']);
    expect(registry.user(b.user.id)?.status).toBe('active');
  });

  it('lets nobody at a company delete anybody, themselves included', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry, { slug: 'acme' });
    await serve(registry);
    const cookie = await signIn(base, user.email, password);
    expect((await call('DELETE', `/api/admin/people/${user.id}`, cookie)).status).toBe(404);
    expect((await call('DELETE', `/api/vendor/companies/acme/admin/people/${user.id}`, cookie)).status).toBe(403);
    expect(registry.user(user.id)).toBeDefined();
  });
});

describe('the vendor and the people in a company', () => {
  const PEOPLE = '/api/vendor/companies/acme/admin';

  it('invites somebody and is handed the link to send', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const invited = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'new@acme.test' });
    expect(invited.status).toBe(201);
    expect(invited.body.link).toMatch(/^https:\/\/pallets\.example\.test\/#\/invitation\/[A-Za-z0-9_-]{40,}$/);

    const people = (await call('GET', `${PEOPLE}/people`, cookie)).body;
    expect(people.invitations.map((i: any) => i.email)).toEqual(['new@acme.test']);

    expect((await call('DELETE', `${PEOPLE}/invitations/${invited.body.invitation.id}`, cookie)).status).toBe(204);
    expect((await call('GET', `${PEOPLE}/people`, cookie)).body.invitations).toEqual([]);
  });

  /** There is one kind of account at a company, whatever the request asks for. */
  it('invites everybody as a member', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const invited = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'boss@acme.test', role: 'admin' });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation.role).toBe('member');
    const vendorish = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'sly@acme.test', role: 'vendor' });
    expect(vendorish.body.invitation.role).toBe('member');
  });

  it('will not invite an address that already has an account', async () => {
    const registry = tempRegistry();
    const { user } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const again = await call('POST', `${PEOPLE}/invitations`, cookie, { email: user.email });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already has an account/);
  });

  it('turns somebody off, and back on', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const theirs = await signIn(base, user.email, password);

    expect((await call('POST', `${PEOPLE}/people/${user.id}/disable`, cookie)).body.status).toBe('disabled');
    // Turning somebody off reaches the browser they are already in.
    expect((await call('GET', '/api/dashboard', theirs)).status).toBe(401);
    expect((await call('POST', `${PEOPLE}/people/${user.id}/enable`, cookie)).body.status).toBe('active');
  });

  /**
   * An invitation sent to the wrong address and followed: the account has the
   * wrong person's name on it, and turning it off still leaves it holding the
   * address. Deleting it gives the address back.
   */
  it('deletes somebody for good, and the address can be invited again', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const theirs = await signIn(base, user.email, password);
    // A new-password link left waiting should not outlive the account.
    await call('POST', `${PEOPLE}/people/${user.id}/reset`, cookie);
    expect(registry.listInvitations(user.tenantId)).toHaveLength(1);

    expect((await call('DELETE', `${PEOPLE}/people/${user.id}`, cookie)).status).toBe(204);
    expect(registry.user(user.id)).toBeUndefined();
    expect(registry.listInvitations(user.tenantId)).toEqual([]);
    // The browser they were already in is shut out, and so is the door.
    expect((await call('GET', '/api/dashboard', theirs)).status).toBe(401);
    await expect(signIn(base, user.email, password)).rejects.toThrow();
    expect((await call('GET', `${PEOPLE}/people`, cookie)).body.users).toEqual([]);

    const again = await call('POST', `${PEOPLE}/invitations`, cookie, { email: user.email });
    expect(again.status).toBe(201);
    expect((await call('DELETE', `${PEOPLE}/people/${user.id}`, cookie)).status).toBe(404);
  });

  it('points at deleting when an address is already taken', async () => {
    const registry = tempRegistry();
    const { user } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const again = await call('POST', `${PEOPLE}/invitations`, cookie, { email: user.email });
    expect(again.body.error).toMatch(/delete it/);
  });

  it('hands out a way back in for somebody who has lost their password', async () => {
    const registry = tempRegistry();
    const { user } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const reset = await call('POST', `${PEOPLE}/people/${user.id}/reset`, cookie);
    expect(reset.status).toBe(200);
    expect(reset.body.link).toContain('/#/invitation/');
  });

  it('has no roles to hand out', async () => {
    const registry = tempRegistry();
    const { user } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    expect((await call('POST', `${PEOPLE}/people/${user.id}/role`, cookie, { role: 'admin' })).status).toBe(404);
    expect(registry.user(user.id)?.role).toBe('member');
  });
});

describe('the vendor and a company\'s brand', () => {
  it('starts with no brand file, and the sheet the program ships with', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const brand = await call('GET', '/api/vendor/companies/acme/admin/brand', cookie);
    expect(brand.status).toBe(200);
    expect(brand.body.file).toBeNull();
    expect(brand.body.from).toBe('built-in');
    expect(brand.body.logo).toBeNull();
  });

  it('writes the brand file, and the sheet changes without anything restarting', async () => {
    const registry = tempRegistry();
    const { tenant } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const saved = await call('PUT', '/api/vendor/companies/acme/admin/brand', cookie, {
      companyName: 'Acme Pallets Ltd',
      projectionNote: 'Third-angle projection, all dimensions in mm',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.file.companyName).toBe('Acme Pallets Ltd');

    const onDisk = JSON.parse(readFileSync(join(dataRoot, 'tenants', tenant.slug, 'brand.json'), 'utf8'));
    expect(onDisk.companyName).toBe('Acme Pallets Ltd');
    expect((await call('GET', '/api/vendor/companies/acme/admin/brand', cookie)).body.file.companyName).toBe('Acme Pallets Ltd');

    const preview = await call('GET', '/api/vendor/companies/acme/admin/preview', cookie);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('Acme Pallets Ltd');
    expect(preview.text).toContain('Third-angle projection');
  });

  it('takes a vector logo, puts it in the corner, and takes it away again', async () => {
    const registry = tempRegistry();
    const { tenant } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const put = await call('POST', '/api/vendor/companies/acme/admin/brand/logo', cookie, { name: 'mark.svg', data: b64(SVG) });
    expect(put.status).toBe(200);
    expect(put.body.logo).toBe('brand/logo.svg');
    expect(existsSync(join(dataRoot, 'tenants', tenant.slug, 'brand', 'logo.svg'))).toBe(true);
    expect((await call('GET', '/api/vendor/companies/acme/admin/preview', cookie)).text).toContain('fill="#123456"');

    expect((await call('DELETE', '/api/vendor/companies/acme/admin/brand/logo', cookie)).status).toBe(204);
    expect(existsSync(join(dataRoot, 'tenants', tenant.slug, 'brand', 'logo.svg'))).toBe(false);
    expect((await call('GET', '/api/vendor/companies/acme/admin/preview', cookie)).text).not.toContain('fill="#123456"');
  });

  it('refuses a logo that a sheet cannot carry, and says what to do', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>x()</script></svg>';
    const refused = await call('POST', '/api/vendor/companies/acme/admin/brand/logo', cookie, { name: 'bad.svg', data: b64(bad) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/cannot carry/);
    expect((await call('GET', '/api/vendor/companies/acme/admin/brand', cookie)).body.logo).toBeNull();

    const notAnImage = await call('POST', '/api/vendor/companies/acme/admin/brand/logo', cookie, { name: 'x.txt', data: b64('hello') });
    expect(notAnImage.status).toBe(400);
  });

  it('takes a face, names it, and keeps the name when the rest of the brand is saved', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const fontBytes = readFileSync(join(__dirname, '..', 'config', 'brand', 'font.otf'));
    const put = await call('POST', '/api/vendor/companies/acme/admin/brand/font', cookie, {
      name: 'Anything.otf', data: b64(fontBytes), family: 'Acme Face', advanceEm: 0.4,
    });
    expect(put.status).toBe(200);
    expect(put.body.font).toMatchObject({ family: 'Acme Face', file: 'brand/font.otf', advanceEm: 0.4 });

    await call('PUT', '/api/vendor/companies/acme/admin/brand', cookie, { companyName: 'Acme' });
    const brand = (await call('GET', '/api/vendor/companies/acme/admin/brand', cookie)).body;
    expect(brand.file.font).toMatchObject({ family: 'Acme Face', file: 'brand/font.otf' });
    expect((await call('GET', '/api/vendor/companies/acme/admin/preview', cookie)).text).toContain("font-family: 'Acme Face'");

    expect((await call('DELETE', '/api/vendor/companies/acme/admin/brand/font', cookie)).status).toBe(204);
    expect((await call('GET', '/api/vendor/companies/acme/admin/brand', cookie)).body.file.font).toBeNull();
  });

  it('refuses a file that is not a font', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);
    const refused = await call('POST', '/api/vendor/companies/acme/admin/brand/font', cookie, { name: 'x.exe', data: b64('x'.repeat(2000)) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/\.otf, \.ttf/);
  });
});


describe('a company\'s own people and its brand', () => {
  /**
   * No screen offers branding to a company, but a screen is not a lock: what
   * stops a company renaming its own sheets is there being no route on its
   * side at all.
   */
  it('cannot read or write the branding from their side', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry);
    const cookie = await signIn(base, user.email, password);

    for (const [method, path] of [
      ['GET', '/api/admin/brand'],
      ['PUT', '/api/admin/brand'],
      ['POST', '/api/admin/brand/logo'],
      ['DELETE', '/api/admin/brand/logo'],
      ['POST', '/api/admin/brand/font'],
      ['DELETE', '/api/admin/brand/font'],
      ['GET', '/api/admin/preview'],
    ] as Array<['GET' | 'PUT' | 'POST' | 'DELETE', string]>) {
      const refused = await call(method, path, cookie, method === 'GET' ? undefined : { companyName: 'Not Theirs' });
      expect(refused.status, `${method} ${path}`).toBe(404);
    }
  });

  it('leaves the sheet printing under the name the vendor set', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry);

    const asVendor = await signIn(base, vendor.user.email, vendor.password);
    await call('PUT', '/api/vendor/companies/acme/admin/brand', asVendor, { companyName: 'Acme Pallets Ltd' });

    // The company reads what it prints with; it simply cannot change it.
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/brand', cookie)).body.companyName).toBe('Acme Pallets Ltd');
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

  it('makes a company, its folder, and the link for its first person', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    await serve(registry);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const made = await call('POST', '/api/vendor/companies', cookie, {
      slug: 'northgate', name: 'Northgate Pallets', timezone: 'Europe/London', firstEmail: 'boss@northgate.test',
    });
    expect(made.status).toBe(201);
    expect(made.body.company.slug).toBe('northgate');
    expect(made.body.link).toContain('/#/invitation/');
    expect(existsSync(join(dataRoot, 'tenants', 'northgate', 'designs'))).toBe(true);
    expect(registry.listInvitations(made.body.company.id).map((i) => i.role)).toEqual(['member']);
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
