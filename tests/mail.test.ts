import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { invitationMessage } from '../src/server/invitations.js';
import { MailConfigError, smtpConfigFromEnv } from '../src/server/mail.js';
import type { MailMessage, Mailer } from '../src/server/mail.js';
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
 * Invitations by email.
 *
 * Where the server has mail set up, an invitation and a new-password link are
 * emailed to the person; the link comes back to whoever asked either way, and
 * a mail server that refuses leaves the invitation standing and says why.
 */

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';

let server: Server | undefined;
let base = '';
let staticDir: string;
let dataRoot: string;

/** A mailer that keeps what it was given, or refuses everything. */
function fakeMailer(fail?: string): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    from: 'Pallet Spec <no-reply@pallets.example.test>',
    sent,
    async send(message) {
      if (fail) throw new Error(fail);
      sent.push(message);
    },
  };
}

async function serve(registry: Registry, mailer: Mailer | null): Promise<void> {
  const tenants = new Tenants(dataRoot, registry);
  const app = createApp(tenants, {
    staticDir,
    auth: { registry, secret: SECRET, secure: false, publicUrl: 'https://pallets.example.test', mailer },
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
  vi.restoreAllMocks();
});

describe('the mail settings', () => {
  it('are none at all where no host is given', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ PALLET_SMTP_HOST: '  ' })).toBeNull();
  });

  it('read a host, a port, a login and a sender', () => {
    expect(
      smtpConfigFromEnv({
        PALLET_SMTP_HOST: 'smtp.example.test',
        PALLET_SMTP_PORT: '465',
        PALLET_SMTP_USER: 'apikey',
        PALLET_SMTP_PASS: 's3cret',
        PALLET_MAIL_FROM: 'Pallet Spec <no-reply@example.test>',
      }),
    ).toEqual({ host: 'smtp.example.test', port: 465, user: 'apikey', pass: 's3cret', from: 'Pallet Spec <no-reply@example.test>' });
  });

  it('default to the submission port', () => {
    expect(smtpConfigFromEnv({ PALLET_SMTP_HOST: 'relay', PALLET_MAIL_FROM: 'x@example.test' })?.port).toBe(587);
  });

  it('refuse half a configuration rather than guess at it', () => {
    expect(() => smtpConfigFromEnv({ PALLET_SMTP_HOST: 'smtp.example.test' })).toThrow(MailConfigError);
    expect(() =>
      smtpConfigFromEnv({ PALLET_SMTP_HOST: 'smtp.example.test', PALLET_MAIL_FROM: 'x@example.test', PALLET_SMTP_USER: 'me' }),
    ).toThrow(/go together/);
    expect(() =>
      smtpConfigFromEnv({ PALLET_SMTP_HOST: 'smtp.example.test', PALLET_MAIL_FROM: 'x@example.test', PALLET_SMTP_PORT: 'lots' }),
    ).toThrow(/port number/);
  });
});

describe('the email', () => {
  const link = 'https://pallets.example.test/#/invitation/abc';
  const expiresAt = '2026-10-04T12:00:00.000Z';

  it('says who is inviting them, and carries the link in both its forms', () => {
    const message = invitationMessage({ kind: 'invite', email: 'new@acme.test', companyName: 'Acme Pallets', link, expiresAt });
    expect(message.to).toBe('new@acme.test');
    expect(message.subject).toBe('You have been invited to Acme Pallets on Pallet Spec');
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);
    expect(message.text).toContain('Sun, 04 Oct 2026');
  });

  it('asks for a new password, and says ignoring it is safe', () => {
    const message = invitationMessage({ kind: 'reset', email: 'a@acme.test', companyName: 'Acme', link, expiresAt });
    expect(message.subject).toBe('Choose a new password for Pallet Spec');
    expect(message.text).toMatch(/password stays as it is/);
  });

  it('never lets a company name write into the page', () => {
    const message = invitationMessage({ kind: 'invite', email: 'x@y.test', companyName: '<script>alert(1)</script>', link, expiresAt });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});

describe('inviting, with mail set up', () => {
  const PEOPLE = '/api/vendor/companies/acme/admin';

  it('emails the invitation, and still hands the link back', async () => {
    const registry = tempRegistry();
    await seedTenant(registry, { name: 'Acme Pallets' });
    const vendor = await seedVendor(registry);
    const mailer = fakeMailer();
    await serve(registry, mailer);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const invited = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'new@acme.test' });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ emailed: true, mailProblem: null });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('new@acme.test');
    expect(mailer.sent[0]!.subject).toContain('Acme Pallets');
    expect(mailer.sent[0]!.text).toContain(invited.body.link);
  });

  it('keeps the invitation when the mail server refuses, and says why', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await serve(registry, fakeMailer('535 Authentication failed\nmore detail'));
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const invited = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'new@acme.test' });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ emailed: false, mailProblem: '535 Authentication failed' });
    expect(invited.body.link).toContain('/#/invitation/');
    expect((await call('GET', `${PEOPLE}/people`, cookie)).body.invitations).toHaveLength(1);
  });

  it('emails a new-password link', async () => {
    const registry = tempRegistry();
    const { user } = await seedTenant(registry);
    const vendor = await seedVendor(registry);
    const mailer = fakeMailer();
    await serve(registry, mailer);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const reset = await call('POST', `${PEOPLE}/people/${user.id}/reset`, cookie);
    expect(reset.body.emailed).toBe(true);
    expect(mailer.sent[0]!.to).toBe(user.email);
    expect(mailer.sent[0]!.subject).toMatch(/new password/);
  });

  it('sends an invitation again as a new link, and the old one stops working', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    const mailer = fakeMailer();
    await serve(registry, mailer);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const first = await call('POST', `${PEOPLE}/invitations`, cookie, { email: 'new@acme.test' });
    const again = await call('POST', `${PEOPLE}/invitations/${first.body.invitation.id}/resend`, cookie);
    expect(again.status).toBe(201);
    expect(again.body.link).not.toBe(first.body.link);
    expect(mailer.sent.map((m) => m.to)).toEqual(['new@acme.test', 'new@acme.test']);

    const pending = (await call('GET', `${PEOPLE}/people`, cookie)).body.invitations;
    expect(pending.map((i: any) => i.id)).toEqual([again.body.invitation.id]);
    const oldToken = first.body.link.split('/').pop();
    expect((await fetch(`${base}/api/auth/invitation/${oldToken}`)).status).toBe(404);
  });

  it('emails the first person when a company is made', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    const mailer = fakeMailer();
    await serve(registry, mailer);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const made = await call('POST', '/api/vendor/companies', cookie, {
      slug: 'northgate',
      name: 'Northgate Pallets',
      firstEmail: 'boss@northgate.test',
    });
    expect(made.body).toMatchObject({ emailed: true, mailProblem: null });
    expect(mailer.sent[0]!.subject).toContain('Northgate Pallets');
  });

  it('says whether mail is set up, and sends the vendor a test', async () => {
    const registry = tempRegistry();
    const vendor = await seedVendor(registry);
    const mailer = fakeMailer();
    await serve(registry, mailer);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    expect((await call('GET', '/api/vendor/mail', cookie)).body).toEqual({ configured: true, from: mailer.from });
    const test = await call('POST', '/api/vendor/mail/test', cookie);
    expect(test.body).toEqual({ to: vendor.user.email });
    expect(mailer.sent[0]!.to).toBe(vendor.user.email);
  });
});

describe('inviting, with no mail set up', () => {
  it('hands the link back to be sent by hand, as it always did', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    const vendor = await seedVendor(registry);
    await serve(registry, null);
    const cookie = await signIn(base, vendor.user.email, vendor.password);

    const invited = await call('POST', '/api/vendor/companies/acme/admin/invitations', cookie, { email: 'new@acme.test' });
    expect(invited.body).toMatchObject({ emailed: false, mailProblem: null });
    expect(invited.body.link).toContain('/#/invitation/');
    expect((await call('GET', '/api/vendor/mail', cookie)).body).toEqual({ configured: false, from: null });
    expect((await call('POST', '/api/vendor/mail/test', cookie)).status).toBe(409);
  });
});
