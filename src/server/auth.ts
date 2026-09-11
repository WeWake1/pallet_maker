import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Registry, Role, Tenant, User } from '../tenancy/registry.js';

/**
 * Who is asking.
 *
 * Small on purpose, and hand-written rather than assembled out of libraries.
 * What it has to do is narrow — a password, a cookie, a session row — and each
 * of those has one right answer that has not changed in years; what a library
 * would add is a configuration surface to get wrong and a dependency to keep
 * in step. Everything below is either a rule with a reason beside it or a call
 * into Node's own crypto.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * How hard a password is to try.
 *
 * These are the parameters scrypt's author gives for interactive logins. The
 * memory ceiling has to be stated: the default is 32 MiB, which is exactly
 * what N=2^15 asks for, and the call throws on the boundary.
 */
const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Long enough to be worth having. No rules about punctuation: they only
 *  produce one capital at the front and one digit at the end. */
export const MIN_PASSWORD_LENGTH = 10;

export const SESSION_COOKIE = 'pallet_session';
/** How long a session lasts without being used. */
const SLIDING_DAYS = 30;
/** And how long it may last however much it is used. */
const ABSOLUTE_DAYS = 90;
/** How often a session's clock is pushed forward, so a read is not a write. */
const TOUCH_AFTER_MS = 5 * 60 * 1000;

/**
 * The header a browser will not send across origins without being allowed to.
 *
 * `SameSite=Lax` already keeps the cookie off cross-site POSTs. This is the
 * second lock: a form on another site can post to this one, but it cannot add
 * a header of its own without a preflight, and nothing here answers one.
 */
export const REQUESTED_WITH = 'pallet-editor';

export interface Principal {
  user: User;
  /** Null only for the vendor's own people, who belong to no one company. */
  tenant: Tenant | null;
  sessionIdHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

/* ------------------------------------------------------------- passwords */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Whether the password matches, in a time that does not depend on how much of
 * it matched.
 */
export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;

  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Something to compare against when the address is not one we know.
 *
 * Answering a stranger faster than a customer is how a list of who has an
 * account here gets made, so an unknown address is checked against this and
 * takes the same time as a real one.
 */
let absent: Promise<string> | undefined;
export function absentPasswordHash(): Promise<string> {
  absent ??= hashPassword(randomBytes(24).toString('base64'));
  return absent;
}

/* -------------------------------------------------------------- sessions */

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The cookie, and what is kept.
 *
 * The browser holds a long random value; the database holds only its hash, so
 * a copy of the registry — a backup on a stick, a snapshot of the disk — is
 * not a drawer full of working keys. The signature is a cheap way to throw out
 * a cookie somebody made up without going to the database for it.
 */
export function newSessionToken(secret: string): { token: string; idHash: string } {
  const id = randomBytes(32).toString('base64url');
  return { token: `${id}.${sign(id, secret)}`, idHash: sha256(id) };
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 22);
}

/** The hash to look up, or nothing if the cookie was not one we wrote. */
export function readSessionToken(token: string, secret: string): string | null {
  const at = token.lastIndexOf('.');
  if (at <= 0) return null;
  const id = token.slice(0, at);
  const signature = token.slice(at + 1);
  const expected = sign(id, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return sha256(id);
}

export function cookieHeader(token: string, options: { secure: boolean; maxAgeSeconds: number }): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: a link to the tool in an email should land you
    // on your library rather than on a login screen, and every route that
    // changes anything is a POST, which Lax does not carry the cookie to.
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookieHeader(secure: boolean): string {
  return cookieHeader('', { secure, maxAgeSeconds: 0 });
}

/** Express does not parse cookies, and this needs exactly one of them. */
export function cookieFrom(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

export const days = (count: number): number => count * 24 * 60 * 60 * 1000;

/**
 * Start a session, and say what to put in the cookie.
 *
 * It runs out after a month unused, and after three months however much it is
 * used — the second is what stops a browser somebody forgot about from being
 * a way in for ever.
 */
export function beginSession(
  registry: Registry,
  userId: string,
  secret: string,
): { token: string; maxAgeSeconds: number } {
  const { token, idHash } = newSessionToken(secret);
  registry.createSession({
    idHash,
    userId,
    expiresAt: new Date(Date.now() + days(SLIDING_DAYS)).toISOString(),
  });
  registry.recordLogin(userId);
  return { token, maxAgeSeconds: Math.floor(days(SLIDING_DAYS) / 1000) };
}

export interface SessionCheck {
  principal: Principal | null;
  /** Why there is none, for the log rather than for the person. */
  reason?: string;
}

/**
 * Who this request belongs to, if anybody.
 *
 * Every reason to say no is the same answer to whoever asked — they are not
 * signed in — because telling a stranger which of "no such session", "that
 * account is turned off" and "that company is suspended" applies is telling
 * them something about somebody else.
 */
export function checkSession(registry: Registry, req: Request, secret: string): SessionCheck {
  const cookie = cookieFrom(req, SESSION_COOKIE);
  if (!cookie) return { principal: null, reason: 'no cookie' };

  const idHash = readSessionToken(cookie, secret);
  if (!idHash) return { principal: null, reason: 'cookie was not signed by this server' };

  const session = registry.session(idHash);
  if (!session) return { principal: null, reason: 'no such session' };
  if (Date.parse(session.expiresAt) < Date.now()) {
    registry.deleteSession(idHash);
    return { principal: null, reason: 'session ran out' };
  }
  if (Date.parse(session.createdAt) + days(ABSOLUTE_DAYS) < Date.now()) {
    registry.deleteSession(idHash);
    return { principal: null, reason: 'session reached its age limit' };
  }

  const user = registry.user(session.userId);
  if (!user || user.status !== 'active') {
    registry.deleteSession(idHash);
    return { principal: null, reason: 'the account is gone or turned off' };
  }

  let tenant: Tenant | null = null;
  if (user.tenantId !== null) {
    tenant = registry.tenant(user.tenantId) ?? null;
    if (!tenant) return { principal: null, reason: 'the company is gone' };
    if (tenant.status !== 'active') return { principal: null, reason: 'the company is suspended' };
  }

  // Pushed forward at most once every few minutes, so reading a page is not a
  // write to the registry.
  if (Date.now() - Date.parse(session.lastSeenAt) > TOUCH_AFTER_MS) {
    registry.touchSession(idHash, new Date(Date.now() + days(SLIDING_DAYS)).toISOString());
  }

  return { principal: { user, tenant, sessionIdHash: idHash } };
}

/* ------------------------------------------------------------ middleware */

export function unauthenticated(res: Response): void {
  res.status(401).json({ error: 'Sign in to go on', unauthenticated: true });
}

/**
 * The second lock against a form on another site.
 *
 * Anything that changes something has to carry a header no cross-origin form
 * can add without being allowed to first, and nothing here allows it.
 */
export function requireRequestedWith(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.get('x-requested-with') === REQUESTED_WITH) {
    next();
    return;
  }
  res.status(403).json({
    error: 'That request did not come from the editor.',
  });
}

/** What each role may do, beyond reading and drawing. */
export function may(role: Role, what: 'manageCompany' | 'manageService' | 'destroy'): boolean {
  if (role === 'vendor') return true;
  if (what === 'manageService') return false;
  return role === 'admin';
}

export function requireRole(what: 'manageCompany' | 'manageService' | 'destroy') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      unauthenticated(res);
      return;
    }
    if (!may(principal.user.role, what)) {
      res.status(403).json({ error: 'Your account does not have that.' });
      return;
    }
    next();
  };
}
