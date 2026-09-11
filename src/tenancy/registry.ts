import type { DatabaseSync as Database } from 'node:sqlite';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { newId } from '../ids.js';

/**
 * Node will only hand this module over under its prefixed name, and it is new
 * enough that the bundlers in this project take the prefix off, look for a
 * package called `sqlite`, and fail to find one. Asking for it at run time
 * steps around all of that: the types above are still checked, and nothing
 * that packages this program has to be taught about it.
 */
const load = createRequire(import.meta.url);
const { DatabaseSync } = load('node:sqlite') as {
  DatabaseSync: new (path: string) => Database;
};

/**
 * Who the companies are, and who may sign in to each.
 *
 * Everything about pallets stays as files: a design is a JSON document in a
 * folder, and a company's whole library is a folder that can be zipped and
 * handed back. This holds the other thing — the few facts that decide which
 * folder a request is allowed to see — and those want what files are bad at.
 * Two people signing in at once, an invitation that may be accepted exactly
 * once, an email address that may belong to one account: each of those is a
 * uniqueness rule or a transaction, and writing a JSON file by rename gives
 * neither.
 *
 * It is SQLite, through Node's own built-in module, so there is nothing to
 * compile on the server and nothing in `node_modules` to keep in step with the
 * machine's architecture. Everything the rest of the program does to it goes
 * through this class, so swapping the driver is one file.
 */

export type TenantStatus = 'active' | 'suspended';
/** What somebody may do. A vendor belongs to no company and may enter any. */
export type Role = 'vendor' | 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
/** An invitation to join, or a way back in for somebody who is already in. */
export type InvitationKind = 'invite' | 'reset';

export interface Tenant {
  id: string;
  /** Short, lowercase, for a person to type: `ambica`. */
  slug: string;
  name: string;
  /** Where the company is, which is the date a design is saved under. */
  timezone: string;
  status: TenantStatus;
  createdAt: string;
}

export interface User {
  id: string;
  /** Null for the vendor's own people, who belong to no one company. */
  tenantId: string | null;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  /** Null until an invitation has been accepted and a password set. */
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Invitation {
  id: string;
  kind: InvitationKind;
  tenantId: string | null;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface Session {
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Somebody has this email already. Said as its own thing, so it can be shown. */
export class EmailTakenError extends RegistryError {
  constructor(readonly email: string) {
    super(`${email} already has an account`);
    this.name = 'EmailTakenError';
  }
}

export class SlugTakenError extends RegistryError {
  constructor(readonly slug: string) {
    super(`There is already a company called "${slug}"`);
    this.name = 'SlugTakenError';
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  email_lc      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL CHECK (role IN ('vendor','admin','member')),
  password_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS users_by_tenant ON users (tenant_id);

CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  email_lc    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('vendor','admin','member')),
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invitations_by_email ON invitations (email_lc);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
`;

const now = (): string => new Date().toISOString();

/** node:sqlite hands back null-prototype rows; this makes them ordinary. */
function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : ({ ...(value as object) } as T);
}

export class Registry {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // A reader never blocks the writer, which is what a web server does all
    // day. Foreign keys are off by default in SQLite and the cascades below
    // depend on them.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** A copy of the whole registry, taken without stopping anything. */
  snapshot(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    this.db.prepare('VACUUM INTO ?').run(path);
  }

  /** Several writes that must all happen or none of them. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // -- companies ----------------------------------------------------------

  createTenant(input: { slug: string; name: string; timezone?: string }): Tenant {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) {
      throw new RegistryError(
        'A company\'s short name is 2 to 39 characters of lowercase letters, digits and hyphens.',
      );
    }
    if (input.name.trim() === '') throw new RegistryError('A company needs a name');
    if (this.tenantBySlug(slug)) throw new SlugTakenError(slug);

    const tenant: Tenant = {
      id: newId(),
      slug,
      name: input.name.trim(),
      timezone: input.timezone ?? 'UTC',
      status: 'active',
      createdAt: now(),
    };
    this.db
      .prepare('INSERT INTO tenants (id, slug, name, timezone, status, created_at) VALUES (?,?,?,?,?,?)')
      .run(tenant.id, tenant.slug, tenant.name, tenant.timezone, tenant.status, tenant.createdAt);
    return tenant;
  }

  tenant(id: string): Tenant | undefined {
    return row<Tenant>(this.mapTenant(this.db.prepare(TENANT_SELECT + ' WHERE id = ?').get(id)));
  }

  tenantBySlug(slug: string): Tenant | undefined {
    return row<Tenant>(this.mapTenant(this.db.prepare(TENANT_SELECT + ' WHERE slug = ?').get(slug.toLowerCase())));
  }

  listTenants(): Tenant[] {
    return this.db
      .prepare(TENANT_SELECT + ' ORDER BY name COLLATE NOCASE')
      .all()
      .map((held) => this.mapTenant(held) as Tenant);
  }

  setTenantStatus(id: string, status: TenantStatus): void {
    const changed = this.db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(status, id);
    if (changed.changes === 0) throw new RegistryError(`No company ${id}`);
    // A suspended company's people are turned away at the door, and the
    // sessions they already hold go with it rather than lasting the month.
    if (status === 'suspended') {
      this.db
        .prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)')
        .run(id);
    }
  }

  deleteTenant(id: string): void {
    this.db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  }

  private mapTenant(held: unknown): Tenant | undefined {
    if (!held) return undefined;
    const r = held as Record<string, string>;
    return {
      id: r.id!,
      slug: r.slug!,
      name: r.name!,
      timezone: r.timezone!,
      status: r.status as TenantStatus,
      createdAt: r.created_at!,
    };
  }

  // -- people -------------------------------------------------------------

  /**
   * Somebody who may sign in, once they have accepted an invitation.
   *
   * No password is set here. An account is made by inviting, and the password
   * is chosen by the person it belongs to when they follow the link — so it is
   * never something an administrator knows, types into a form, or reads out.
   */
  createUser(input: { tenantId: string | null; email: string; name?: string; role: Role }): User {
    const email = input.email.trim();
    const lower = email.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower)) {
      throw new RegistryError(`"${email}" does not look like an email address`);
    }
    if (this.userByEmail(lower)) throw new EmailTakenError(email);
    if (input.role === 'vendor' && input.tenantId !== null) {
      throw new RegistryError('Somebody who looks after the service belongs to no one company');
    }
    if (input.role !== 'vendor' && input.tenantId === null) {
      throw new RegistryError('Somebody who is not looking after the service belongs to a company');
    }

    const user: User = {
      id: newId(),
      tenantId: input.tenantId,
      email,
      name: input.name?.trim() ?? '',
      role: input.role,
      status: 'active',
      hasPassword: false,
      createdAt: now(),
      lastLoginAt: null,
    };
    this.db
      .prepare(
        'INSERT INTO users (id, tenant_id, email, email_lc, name, role, password_hash, status, created_at) ' +
          'VALUES (?,?,?,?,?,?,NULL,?,?)',
      )
      .run(user.id, user.tenantId, user.email, lower, user.name, user.role, user.status, user.createdAt);
    return user;
  }

  user(id: string): User | undefined {
    return this.mapUser(this.db.prepare(USER_SELECT + ' WHERE id = ?').get(id));
  }

  userByEmail(email: string): User | undefined {
    return this.mapUser(this.db.prepare(USER_SELECT + ' WHERE email_lc = ?').get(email.trim().toLowerCase()));
  }

  /** The stored hash, which only the sign-in path has any use for. */
  passwordHash(id: string): string | null {
    const held = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as
      | { password_hash: string | null }
      | undefined;
    return held?.password_hash ?? null;
  }

  setPassword(id: string, hash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  listUsers(tenantId: string | null): User[] {
    const statement =
      tenantId === null
        ? this.db.prepare(USER_SELECT + ' WHERE tenant_id IS NULL ORDER BY email_lc')
        : this.db.prepare(USER_SELECT + ' WHERE tenant_id = ? ORDER BY email_lc');
    const rows = tenantId === null ? statement.all() : statement.all(tenantId);
    return rows.map((held) => this.mapUser(held) as User);
  }

  setUserStatus(id: string, status: UserStatus): void {
    const changed = this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
    if (changed.changes === 0) throw new RegistryError(`No user ${id}`);
    // Turning somebody off has to reach the browser they are already in.
    if (status === 'disabled') this.deleteUserSessions(id);
  }

  recordLogin(id: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);
  }

  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  private mapUser(held: unknown): User | undefined {
    if (!held) return undefined;
    const r = held as Record<string, string | null>;
    return {
      id: r.id as string,
      tenantId: r.tenant_id ?? null,
      email: r.email as string,
      name: (r.name ?? '') as string,
      role: r.role as Role,
      status: r.status as UserStatus,
      hasPassword: r.password_hash !== null,
      createdAt: r.created_at as string,
      lastLoginAt: r.last_login_at ?? null,
    };
  }

  // -- invitations --------------------------------------------------------

  /**
   * A way in, good once and not for long.
   *
   * Only the hash of the token is kept. Somebody who reads this file — a
   * backup on a memory stick, a copy of the disk — cannot turn what is in it
   * back into a working link.
   */
  createInvitation(input: {
    kind: InvitationKind;
    tenantId: string | null;
    email: string;
    role: Role;
    tokenHash: string;
    invitedBy: string | null;
    expiresAt: string;
  }): Invitation {
    const invitation: Invitation = {
      id: newId(),
      kind: input.kind,
      tenantId: input.tenantId,
      email: input.email.trim(),
      role: input.role,
      expiresAt: input.expiresAt,
      acceptedAt: null,
    };
    this.db
      .prepare(
        'INSERT INTO invitations (id, kind, tenant_id, email, email_lc, role, token_hash, invited_by, expires_at, accepted_at, created_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,NULL,?)',
      )
      .run(
        invitation.id,
        invitation.kind,
        invitation.tenantId,
        invitation.email,
        invitation.email.toLowerCase(),
        invitation.role,
        input.tokenHash,
        input.invitedBy,
        invitation.expiresAt,
        now(),
      );
    return invitation;
  }

  invitationByTokenHash(tokenHash: string): Invitation | undefined {
    const held = this.db.prepare(INVITATION_SELECT + ' WHERE token_hash = ?').get(tokenHash);
    if (!held) return undefined;
    const r = held as Record<string, string | null>;
    return {
      id: r.id as string,
      kind: r.kind as InvitationKind,
      tenantId: r.tenant_id ?? null,
      email: r.email as string,
      role: r.role as Role,
      expiresAt: r.expires_at as string,
      acceptedAt: r.accepted_at ?? null,
    };
  }

  /**
   * Mark an invitation used, and refuse if it already is.
   *
   * The refusal is the point: two browsers following the same link at once
   * must not both set a password, and a link that has been used is not a way
   * back in a month later.
   */
  markInvitationAccepted(id: string): void {
    const changed = this.db
      .prepare('UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL')
      .run(now(), id);
    if (changed.changes === 0) throw new RegistryError('That link has already been used');
  }

  listInvitations(tenantId: string | null): Invitation[] {
    const statement =
      tenantId === null
        ? this.db.prepare(INVITATION_SELECT + ' WHERE tenant_id IS NULL AND accepted_at IS NULL ORDER BY created_at DESC')
        : this.db.prepare(INVITATION_SELECT + ' WHERE tenant_id = ? AND accepted_at IS NULL ORDER BY created_at DESC');
    const rows = tenantId === null ? statement.all() : statement.all(tenantId);
    return rows.map((held) => {
      const r = held as Record<string, string | null>;
      return {
        id: r.id as string,
        kind: r.kind as InvitationKind,
        tenantId: r.tenant_id ?? null,
        email: r.email as string,
        role: r.role as Role,
        expiresAt: r.expires_at as string,
        acceptedAt: r.accepted_at ?? null,
      };
    });
  }

  deleteInvitation(id: string): void {
    this.db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
  }

  // -- sessions -----------------------------------------------------------

  /** Only the hash of the cookie's value is kept, for the same reason. */
  createSession(input: { idHash: string; userId: string; expiresAt: string }): void {
    const at = now();
    this.db
      .prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)')
      .run(input.idHash, input.userId, at, at, input.expiresAt);
  }

  session(idHash: string): Session | undefined {
    const held = this.db
      .prepare('SELECT user_id, created_at, last_seen_at, expires_at FROM sessions WHERE id_hash = ?')
      .get(idHash);
    if (!held) return undefined;
    const r = held as Record<string, string>;
    return {
      userId: r.user_id!,
      createdAt: r.created_at!,
      lastSeenAt: r.last_seen_at!,
      expiresAt: r.expires_at!,
    };
  }

  touchSession(idHash: string, expiresAt: string): void {
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?')
      .run(now(), expiresAt, idHash);
  }

  deleteSession(idHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Sessions that have run out, and invitations nobody followed. */
  sweep(): { sessions: number; invitations: number } {
    const at = now();
    const sessions = this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(at);
    const invitations = this.db
      .prepare('DELETE FROM invitations WHERE accepted_at IS NULL AND expires_at < ?')
      .run(at);
    return { sessions: Number(sessions.changes), invitations: Number(invitations.changes) };
  }
}

const TENANT_SELECT = 'SELECT id, slug, name, timezone, status, created_at FROM tenants';
const USER_SELECT =
  'SELECT id, tenant_id, email, name, role, password_hash, status, created_at, last_login_at FROM users';
const INVITATION_SELECT =
  'SELECT id, kind, tenant_id, email, role, expires_at, accepted_at, created_at FROM invitations';
