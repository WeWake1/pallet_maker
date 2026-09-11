import { afterEach, describe, expect, it } from 'vitest';
import {
  EmailTakenError,
  Registry,
  RegistryError,
  SlugTakenError,
} from '../src/tenancy/registry.js';

/**
 * The few facts that decide which folder a request may see. Everything about
 * pallets is still files; this is who the companies are and who may sign in.
 */

const open: Registry[] = [];
function registry(): Registry {
  const held = new Registry(':memory:');
  open.push(held);
  return held;
}
afterEach(() => {
  for (const held of open.splice(0)) held.close();
});

const soon = (): string => new Date(Date.now() + 60_000).toISOString();
const past = (): string => new Date(Date.now() - 60_000).toISOString();

describe('companies', () => {
  it('are made with a short name a person can type', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'Ambica', name: 'Ambica Patterns India Pvt Ltd', timezone: 'Asia/Kolkata' });
    expect(tenant.slug).toBe('ambica');
    expect(tenant.status).toBe('active');
    expect(db.tenantBySlug('AMBICA')?.id).toBe(tenant.id);
    expect(db.tenant(tenant.id)?.timezone).toBe('Asia/Kolkata');
  });

  it('refuse a short name two companies could both have', () => {
    const db = registry();
    db.createTenant({ slug: 'acme', name: 'Acme' });
    expect(() => db.createTenant({ slug: 'acme', name: 'Acme Again' })).toThrow(SlugTakenError);
  });

  it.each([['', 'empty'], ['a', 'one character'], ['Has Spaces', 'spaces'], ['a'.repeat(40), 'too long']])(
    'refuse a short name that is %s',
    (slug) => {
      expect(() => registry().createTenant({ slug, name: 'Whoever' })).toThrow(RegistryError);
    },
  );

  it('are listed by name, whatever case it was typed in', () => {
    const db = registry();
    db.createTenant({ slug: 'zz', name: 'alpha packing' });
    db.createTenant({ slug: 'aa', name: 'Beta Crates' });
    expect(db.listTenants().map((t) => t.name)).toEqual(['alpha packing', 'Beta Crates']);
  });
});

describe('people', () => {
  it('are made without a password, which only they ever choose', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: ' Ann@Acme.test ', name: 'Ann', role: 'admin' });
    expect(user.email).toBe('Ann@Acme.test');
    expect(user.hasPassword).toBe(false);
    expect(db.passwordHash(user.id)).toBeNull();

    db.setPassword(user.id, 'scrypt$...');
    expect(db.user(user.id)?.hasPassword).toBe(true);
  });

  it('are found by their address however it is capitalised', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    db.createUser({ tenantId: tenant.id, email: 'Ann@Acme.test', role: 'member' });
    expect(db.userByEmail('ANN@acme.TEST')?.email).toBe('Ann@Acme.test');
  });

  it('may have an address only once, across every company', () => {
    const db = registry();
    const one = db.createTenant({ slug: 'one', name: 'One' });
    const two = db.createTenant({ slug: 'two', name: 'Two' });
    db.createUser({ tenantId: one.id, email: 'ann@example.test', role: 'admin' });
    expect(() => db.createUser({ tenantId: two.id, email: 'ann@example.test', role: 'member' })).toThrow(
      EmailTakenError,
    );
  });

  it('refuse an address that is not one', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    expect(() => db.createUser({ tenantId: tenant.id, email: 'not an address', role: 'member' })).toThrow(
      /does not look like an email/,
    );
  });

  /** A vendor looks after the service; the roles inside a company do not. */
  it('belong to a company unless they look after the service', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    expect(() => db.createUser({ tenantId: tenant.id, email: 'v@x.test', role: 'vendor' })).toThrow(
      /belongs to no one company/,
    );
    expect(() => db.createUser({ tenantId: null, email: 'a@x.test', role: 'admin' })).toThrow(
      /belongs to a company/,
    );
    expect(db.createUser({ tenantId: null, email: 'v@x.test', role: 'vendor' }).tenantId).toBeNull();
  });

  it('are listed per company, and the vendor\'s people on their own', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    db.createUser({ tenantId: tenant.id, email: 'b@acme.test', role: 'member' });
    db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createUser({ tenantId: null, email: 'owner@vendor.test', role: 'vendor' });

    expect(db.listUsers(tenant.id).map((u) => u.email)).toEqual(['a@acme.test', 'b@acme.test']);
    expect(db.listUsers(null).map((u) => u.email)).toEqual(['owner@vendor.test']);
  });
});

describe('sessions', () => {
  it('are kept by the hash of the cookie, never the cookie itself', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createSession({ idHash: 'hash-1', userId: user.id, expiresAt: soon() });

    expect(db.session('hash-1')?.userId).toBe(user.id);
    expect(db.session('nothing')).toBeUndefined();
    db.deleteSession('hash-1');
    expect(db.session('hash-1')).toBeUndefined();
  });

  it('end the moment somebody is turned off', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createSession({ idHash: 'hash-1', userId: user.id, expiresAt: soon() });

    db.setUserStatus(user.id, 'disabled');
    expect(db.session('hash-1')).toBeUndefined();
  });

  /** Suspending a company has to reach the browsers its people already have open. */
  it('end when the company is suspended', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createSession({ idHash: 'hash-1', userId: user.id, expiresAt: soon() });

    db.setTenantStatus(tenant.id, 'suspended');
    expect(db.session('hash-1')).toBeUndefined();
    expect(db.tenant(tenant.id)?.status).toBe('suspended');
  });

  it('are swept once they have run out', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createSession({ idHash: 'old', userId: user.id, expiresAt: past() });
    db.createSession({ idHash: 'new', userId: user.id, expiresAt: soon() });

    expect(db.sweep().sessions).toBe(1);
    expect(db.session('old')).toBeUndefined();
    expect(db.session('new')).toBeDefined();
  });

  it('go with the person, and the person with the company', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const user = db.createUser({ tenantId: tenant.id, email: 'a@acme.test', role: 'admin' });
    db.createSession({ idHash: 'hash-1', userId: user.id, expiresAt: soon() });

    db.deleteTenant(tenant.id);
    expect(db.user(user.id)).toBeUndefined();
    expect(db.session('hash-1')).toBeUndefined();
  });
});

describe('invitations', () => {
  it('may be accepted exactly once', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    const invitation = db.createInvitation({
      kind: 'invite',
      tenantId: tenant.id,
      email: 'new@acme.test',
      role: 'member',
      tokenHash: 'token-hash',
      invitedBy: null,
      expiresAt: soon(),
    });

    expect(db.invitationByTokenHash('token-hash')?.id).toBe(invitation.id);
    db.markInvitationAccepted(invitation.id);
    expect(() => db.markInvitationAccepted(invitation.id)).toThrow(/already been used/);
  });

  it('are found by the hash of the token, never the token', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    db.createInvitation({
      kind: 'invite',
      tenantId: tenant.id,
      email: 'new@acme.test',
      role: 'member',
      tokenHash: 'the-hash',
      invitedBy: null,
      expiresAt: soon(),
    });
    expect(db.invitationByTokenHash('not-the-hash')).toBeUndefined();
  });

  it('are swept once nobody has followed them in time', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    db.createInvitation({
      kind: 'invite', tenantId: tenant.id, email: 'a@acme.test', role: 'member',
      tokenHash: 'stale', invitedBy: null, expiresAt: past(),
    });
    db.createInvitation({
      kind: 'invite', tenantId: tenant.id, email: 'b@acme.test', role: 'member',
      tokenHash: 'fresh', invitedBy: null, expiresAt: soon(),
    });
    expect(db.sweep().invitations).toBe(1);
    expect(db.listInvitations(tenant.id).map((i) => i.email)).toEqual(['b@acme.test']);
  });
});

describe('a batch of writes', () => {
  it('either all happens or none of it does', () => {
    const db = registry();
    const tenant = db.createTenant({ slug: 'acme', name: 'Acme' });
    expect(() =>
      db.transaction(() => {
        db.createUser({ tenantId: tenant.id, email: 'first@acme.test', role: 'member' });
        throw new Error('changed my mind');
      }),
    ).toThrow('changed my mind');
    expect(db.userByEmail('first@acme.test')).toBeUndefined();
  });
});
