import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AuthConfig } from './app.js';
import {
  absentPasswordHash,
  beginSession,
  checkSession,
  clearedCookieHeader,
  cookieHeader,
  passwordMatches,
  unauthenticated,
} from './auth.js';
import { acceptInvitation, InvitationError, offerFor } from './invitations.js';
import { RateLimiter } from './ratelimit.js';
import type { Principal } from './auth.js';

/**
 * Getting in, getting out, and the link that gives somebody an account.
 *
 * The only routes that answer before anybody is known, so each is written on
 * the assumption that whoever is calling it is a stranger: nothing here says
 * whether an address has an account, which of several reasons a sign-in
 * failed, or whether a link was ever real.
 */

/** Ten tries a quarter of an hour, counted per address and per account. */
const ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** What the editor is told about whoever is signed in. */
export interface SessionView {
  /**
   * Whether this server asks who you are at all.
   *
   * False in the desktop app and on the command line, where the machine has
   * already decided. The editor asks this first: it is the difference between
   * showing a library and showing a sign-in screen.
   */
  signInRequired: boolean;
  user: { id: string; email: string; name: string; role: string } | null;
  company: { slug: string; name: string; timezone: string } | null;
}

/** Nobody is asked here, so there is nobody to name. */
export const NO_SIGN_IN: SessionView = { signInRequired: false, user: null, company: null };

export function sessionView(principal: Principal): SessionView {
  return {
    signInRequired: true,
    user: {
      id: principal.user.id,
      email: principal.user.email,
      name: principal.user.name,
      role: principal.user.role,
    },
    company: principal.tenant
      ? {
          slug: principal.tenant.slug,
          name: principal.tenant.name,
          timezone: principal.tenant.timezone,
        }
      : null,
  };
}

export function authRoutes(auth: AuthConfig, logging: boolean): Router {
  const router = Router();
  const byAddress = new RateLimiter(ATTEMPTS, WINDOW_MS);
  const byAccount = new RateLimiter(ATTEMPTS, WINDOW_MS);

  const note = (message: string): void => {
    if (logging) console.error(message);
  };

  /** Who is signed in. The editor asks this first, every time it loads. */
  router.get('/api/session', (req: Request, res: Response) => {
    const { principal } = checkSession(auth.registry, req, auth.secret);
    if (!principal) {
      unauthenticated(res);
      return;
    }
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json(sessionView(principal));
  });

  router.post('/api/auth/login', (req: Request, res: Response, next) => {
    void (async () => {
      const body = req.body as { email?: unknown; password?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      const address = req.ip ?? 'unknown';
      const account = email.toLowerCase();
      const limits = [byAddress.take(address), byAccount.take(account)];
      const blocked = limits.find((limit) => !limit.allowed);
      if (blocked) {
        res.setHeader('Retry-After', String(blocked.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many attempts. Wait a few minutes and try again.',
        });
        return;
      }

      const user = email === '' ? undefined : auth.registry.userByEmail(email);
      // An address nobody has is checked against a hash of nothing, so that a
      // stranger cannot tell who has an account here by how fast the answer
      // comes back.
      const stored = user ? auth.registry.passwordHash(user.id) : await absentPasswordHash();
      const matched = await passwordMatches(password, stored);

      // One answer for every way of being wrong.
      const refuse = (why: string): void => {
        note(`login refused for ${account || '(no address)'}: ${why}`);
        res.status(401).json({ error: 'That email and password do not match an account.' });
      };
      if (!user || !matched) {
        refuse(!user ? 'no such account' : 'wrong password');
        return;
      }
      if (user.status !== 'active') {
        refuse('the account is turned off');
        return;
      }
      if (user.tenantId !== null) {
        const tenant = auth.registry.tenant(user.tenantId);
        if (!tenant || tenant.status !== 'active') {
          refuse('the company is not active');
          return;
        }
      }

      const { token, maxAgeSeconds } = beginSession(auth.registry, user.id, auth.secret);
      // Getting it right forgets the tries that did not, so somebody who
      // fumbles a password twice and then types it is not held back.
      byAddress.forget(address);
      byAccount.forget(account);
      res.setHeader('Set-Cookie', cookieHeader(token, { secure: auth.secure, maxAgeSeconds }));
      const tenant = user.tenantId ? (auth.registry.tenant(user.tenantId) ?? null) : null;
      res.json(sessionView({ user, tenant, sessionIdHash: '' }));
    })().catch(next);
  });

  router.post('/api/auth/logout', (req: Request, res: Response) => {
    const { principal } = checkSession(auth.registry, req, auth.secret);
    if (principal) auth.registry.deleteSession(principal.sessionIdHash);
    res.setHeader('Set-Cookie', clearedCookieHeader(auth.secure));
    res.status(204).end();
  });

  /** What a link is worth, without using it up, so the form can be filled in. */
  router.get('/api/auth/invitation/:token', (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.json(offerFor(auth.registry, String(req.params.token)));
    } catch (error) {
      if (error instanceof InvitationError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  /** Follow the link: choose a password, and be signed in. */
  router.post('/api/auth/accept', (req: Request, res: Response, next) => {
    void (async () => {
      const body = req.body as { token?: unknown; name?: unknown; password?: unknown };
      if (typeof body.token !== 'string' || typeof body.password !== 'string') {
        res.status(400).json({ error: 'A link and a password are both needed' });
        return;
      }
      try {
        const { userId } = await acceptInvitation(auth.registry, {
          token: body.token,
          name: typeof body.name === 'string' ? body.name : '',
          password: body.password,
        });
        const { token, maxAgeSeconds } = beginSession(auth.registry, userId, auth.secret);
        res.setHeader('Set-Cookie', cookieHeader(token, { secure: auth.secure, maxAgeSeconds }));
        const user = auth.registry.user(userId)!;
        const tenant = user.tenantId ? (auth.registry.tenant(user.tenantId) ?? null) : null;
        res.json(sessionView({ user, tenant, sessionIdHash: '' }));
      } catch (error) {
        if (error instanceof InvitationError) {
          res.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }
    })().catch(next);
  });

  return router;
}
