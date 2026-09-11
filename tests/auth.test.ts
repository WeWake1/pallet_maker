import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { AuthConfig } from '../src/server/app.js';
import { createInvitation } from '../src/server/invitations.js';
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
 * The door.
 *
 * Every route that reads or writes a design is behind it, and the only things
 * in front of it are the editor's own pages — the login screen is part of the
 * editor and has to load — and the three routes that let somebody in.
 */

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';

let server: Server | undefined;
let base = '';
let staticDir: string;

async function serve(registry: Registry, dataRoot: string, over?: Partial<AuthConfig>): Promise<void> {
  const tenants = new Tenants(dataRoot, registry);
  const app = createApp(tenants, {
    staticDir,
    auth: { registry, secret: SECRET, secure: false, publicUrl: base || 'http://127.0.0.1', ...over },
  });
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; header?: boolean } = {},
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.header !== false) Object.assign(headers, EDITOR_HEADER);

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, text, body };
}

beforeEach(() => {
  staticDir = mkdtempSync(join(tmpdir(), 'pallet-editor-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>editor</title>');
});

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  rmSync(staticDir, { recursive: true, force: true });
  cleanupStores();
  closeRegistries();
});

describe('what is in front of the door', () => {
  it('lets the editor load, because the sign-in screen is part of it', async () => {
    await serve(tempRegistry(), tempDataRoot());
    const page = await call('GET', '/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('editor');
  });

  it('answers the health check, which is asked before anybody signs in', async () => {
    await serve(tempRegistry(), tempDataRoot());
    const health = await call('GET', '/healthz');
    expect(health.status).toBe(200);
    expect(health.body.companies).toBe(0);
  });

  it('turns every other request away, whatever it asked for', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    await serve(registry, tempDataRoot());

    for (const path of ['/api/dashboard', '/api/clients', '/api/pallets', '/api/rates', '/api/brand', '/api/library.json']) {
      const response = await call('GET', path);
      expect(response.status, path).toBe(401);
      expect(response.body.unauthenticated, path).toBe(true);
    }
  });
});

describe('signing in', () => {
  it('works, and says who you are and which company', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry, { slug: 'acme', name: 'Acme Pallets' });
    await serve(registry, tempDataRoot());

    const response = await call('POST', '/api/auth/login', { body: { email: user.email, password } });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(user.email);
    expect(response.body.company).toEqual({ slug: 'acme', name: 'Acme Pallets', timezone: tenant.timezone });

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Not marked Secure here, because this test server answers on plain http
    // and a browser would throw a Secure cookie away.
    expect(cookie).not.toContain('Secure');
  });

  it('marks the cookie Secure wherever the address is https', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot(), { secure: true });
    const response = await call('POST', '/api/auth/login', { body: { email: user.email, password } });
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  /**
   * One answer for every way of being wrong. Telling a stranger which of "no
   * such account" and "wrong password" applies tells them who has an account
   * here, which is something about somebody else.
   */
  it('says the same thing to a wrong password and to an address nobody has', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());

    const wrong = await call('POST', '/api/auth/login', { body: { email: user.email, password: password + 'x' } });
    const nobody = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.test', password } });

    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(wrong.body.error).toBe(nobody.body.error);
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('stops answering after too many tries, and says when to come back', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());

    let blocked: Awaited<ReturnType<typeof call>> | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'wrong' } });
      if (response.status === 429) {
        blocked = response;
        break;
      }
    }
    expect(blocked, 'never started refusing').toBeDefined();
    expect(Number(blocked!.headers.get('retry-after'))).toBeGreaterThan(0);
    // And the right password is refused too while it is holding the door.
    expect((await call('POST', '/api/auth/login', { body: { email: user.email, password } })).status).toBe(429);
  }, 30_000);

  it('refuses a request that did not come from the editor', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());

    const response = await call('POST', '/api/auth/login', {
      body: { email: user.email, password },
      header: false,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('will not take a cookie this server did not sign', async () => {
    const registry = tempRegistry();
    await seedTenant(registry);
    await serve(registry, tempDataRoot());

    for (const forged of ['pallet_session=made-up', 'pallet_session=abc.def', 'pallet_session=']) {
      expect((await call('GET', '/api/dashboard', { cookie: forged })).status).toBe(401);
    }
  });
});

describe('being signed in', () => {
  it('reaches the designs, and only afterwards', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());

    expect((await call('GET', '/api/dashboard')).status).toBe(401);
    const cookie = await signIn(base, user.email, password);
    const dashboard = await call('GET', '/api/dashboard', { cookie });
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toEqual([]);
  });

  it('says who is signed in, and stops saying after signing out', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());
    const cookie = await signIn(base, user.email, password);

    expect((await call('GET', '/api/session', { cookie })).body.user.email).toBe(user.email);
    expect((await call('POST', '/api/auth/logout', { cookie })).status).toBe(204);
    expect((await call('GET', '/api/session', { cookie })).status).toBe(401);
  });

  it('ends the moment the account is turned off', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/dashboard', { cookie })).status).toBe(200);

    registry.setUserStatus(user.id, 'disabled');
    expect((await call('GET', '/api/dashboard', { cookie })).status).toBe(401);
    await expect(signIn(base, user.email, password)).rejects.toThrow();
  });

  /** Suspending a company has to reach the browsers its people already have open. */
  it('ends the moment the company is suspended', async () => {
    const registry = tempRegistry();
    const { tenant, user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());
    const cookie = await signIn(base, user.email, password);
    expect((await call('GET', '/api/dashboard', { cookie })).status).toBe(200);

    registry.setTenantStatus(tenant.id, 'suspended');
    expect((await call('GET', '/api/dashboard', { cookie })).status).toBe(401);
    await expect(signIn(base, user.email, password)).rejects.toThrow();
  });

  /**
   * Somebody who looks after the service belongs to no company, so there is no
   * folder that is theirs. Said plainly rather than failing somewhere deeper.
   */
  it('tells somebody who looks after the service that they have no designs', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedVendor(registry);
    await serve(registry, tempDataRoot());
    const cookie = await signIn(base, user.email, password);

    expect((await call('GET', '/api/session', { cookie })).body.company).toBeNull();
    const dashboard = await call('GET', '/api/dashboard', { cookie });
    expect(dashboard.status).toBe(403);
    expect(dashboard.body.error).toMatch(/does not belong to a company/);
  });
});

describe('an invitation', () => {
  it('says who it is for without using itself up', async () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme Pallets' });
    const { token } = createInvitation(registry, {
      kind: 'invite', tenantId: tenant.id, email: 'new@acme.test', role: 'member', invitedBy: null,
    });
    await serve(registry, tempDataRoot());

    const offer = await call('GET', `/api/auth/invitation/${token}`);
    expect(offer.status).toBe(200);
    expect(offer.body).toMatchObject({ email: 'new@acme.test', companyName: 'Acme Pallets', returning: false });
    // Still good.
    expect((await call('GET', `/api/auth/invitation/${token}`)).status).toBe(200);
  });

  it('makes the account, sets the password and signs the person in', async () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme Pallets' });
    const { token } = createInvitation(registry, {
      kind: 'invite', tenantId: tenant.id, email: 'new@acme.test', role: 'member', invitedBy: null,
    });
    await serve(registry, tempDataRoot());

    const accepted = await call('POST', '/api/auth/accept', {
      body: { token, name: 'New Person', password: 'a long enough password' },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user.email).toBe('new@acme.test');
    expect(accepted.body.company.slug).toBe('acme');
    expect(accepted.headers.get('set-cookie')).toContain('pallet_session=');

    // And from then on it is an ordinary account.
    const cookie = await signIn(base, 'new@acme.test', 'a long enough password');
    expect((await call('GET', '/api/dashboard', { cookie })).status).toBe(200);
  }, 20_000);

  it('works once and then never again', async () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme Pallets' });
    const { token } = createInvitation(registry, {
      kind: 'invite', tenantId: tenant.id, email: 'new@acme.test', role: 'member', invitedBy: null,
    });
    await serve(registry, tempDataRoot());

    expect((await call('POST', '/api/auth/accept', { body: { token, name: 'A', password: 'a long enough password' } })).status).toBe(200);
    const again = await call('POST', '/api/auth/accept', { body: { token, name: 'B', password: 'another long password' } });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/used already|run out/);
  }, 20_000);

  it('refuses a password too short to be one', async () => {
    const registry = tempRegistry();
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme Pallets' });
    const { token } = createInvitation(registry, {
      kind: 'invite', tenantId: tenant.id, email: 'new@acme.test', role: 'member', invitedBy: null,
    });
    await serve(registry, tempDataRoot());

    const response = await call('POST', '/api/auth/accept', { body: { token, name: 'A', password: 'short' } });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least 10 characters/);
  });

  it('says nothing useful about a link that was never real', async () => {
    await serve(tempRegistry(), tempDataRoot());
    const response = await call('GET', '/api/auth/invitation/not-a-real-token');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/used already|run out/);
  });

  /** Somebody who has lost a password gets back in the same way. */
  it('lets somebody set a new password, and ends the sessions they had', async () => {
    const registry = tempRegistry();
    const { user, password } = await seedTenant(registry);
    await serve(registry, tempDataRoot());
    const old = await signIn(base, user.email, password);
    expect((await call('GET', '/api/dashboard', { cookie: old })).status).toBe(200);

    const { token } = createInvitation(registry, {
      kind: 'reset', tenantId: user.tenantId, email: user.email, role: user.role, invitedBy: null,
    });
    const accepted = await call('POST', '/api/auth/accept', {
      body: { token, name: '', password: 'a brand new long password' },
    });
    expect(accepted.status).toBe(200);

    // Whoever held the old cookie no longer has a way in.
    expect((await call('GET', '/api/dashboard', { cookie: old })).status).toBe(401);
    const fresh = await signIn(base, user.email, 'a brand new long password');
    expect((await call('GET', '/api/dashboard', { cookie: fresh })).status).toBe(200);
  }, 20_000);
});
