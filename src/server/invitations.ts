import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, MIN_PASSWORD_LENGTH } from './auth.js';
import { RegistryError } from '../tenancy/registry.js';
import type { Invitation, Registry, Role, Tenant } from '../tenancy/registry.js';

/**
 * How somebody gets an account, and how they get back in when they have lost
 * the password to one.
 *
 * The same mechanism for both, because they are the same thing: a link that
 * works once, for a while, for one address. Nobody types a password into a
 * form for somebody else, so no administrator ever knows a colleague's
 * password, and there is none to read out over the phone or leave in a chat.
 *
 * The link carries a long random token; the registry keeps only its hash. A
 * copy of the registry is therefore not a drawer full of working keys.
 */

/** Long enough that guessing one is not a thing anybody tries. */
const TOKEN_BYTES = 32;
export const INVITATION_DAYS = 7;

export interface NewInvitation {
  invitation: Invitation;
  /** Shown once, to whoever is sending it. Never stored. */
  token: string;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createInvitation(
  registry: Registry,
  input: {
    kind: 'invite' | 'reset';
    tenantId: string | null;
    email: string;
    role: Role;
    invitedBy: string | null;
  },
): NewInvitation {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const invitation = registry.createInvitation({
    ...input,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  return { invitation, token };
}

/** The web address to send. The person follows it and chooses a password. */
export function invitationLink(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/#/invitation/${token}`;
}

export interface InvitationOffer {
  email: string;
  kind: 'invite' | 'reset';
  /** The company they are being invited into, or null for the vendor's own. */
  companyName: string | null;
  /** Whether the person already has an account, so the form knows what to ask. */
  returning: boolean;
}

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

/** What a link is worth, without using it up. */
export function offerFor(registry: Registry, token: string): InvitationOffer {
  const invitation = registry.invitationByTokenHash(hashToken(token));
  // The same answer for a link that was never real, one that has been used and
  // one that has run out: a stranger learns nothing by trying.
  if (!invitation || invitation.acceptedAt !== null || Date.parse(invitation.expiresAt) < Date.now()) {
    throw new InvitationError('That link has been used already, or it has run out. Ask for another.');
  }

  let tenant: Tenant | null = null;
  if (invitation.tenantId !== null) {
    tenant = registry.tenant(invitation.tenantId) ?? null;
    if (!tenant) throw new InvitationError('The company this was for is no longer here.');
    if (tenant.status !== 'active') throw new InvitationError('That company is not active.');
  }

  return {
    email: invitation.email,
    kind: invitation.kind,
    companyName: tenant?.name ?? null,
    returning: registry.userByEmail(invitation.email) !== undefined,
  };
}

/**
 * Use the link: make the account if it is new, set the password, and mark the
 * link used — all of it or none of it.
 *
 * Marking it used comes first inside the transaction. Two browsers following
 * the same link at the same moment both reach this, and the second one has to
 * find it already used rather than both setting a password.
 */
export async function acceptInvitation(
  registry: Registry,
  input: { token: string; name: string; password: string },
): Promise<{ userId: string }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new InvitationError(`A password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const invitation = registry.invitationByTokenHash(hashToken(input.token));
  if (!invitation || invitation.acceptedAt !== null || Date.parse(invitation.expiresAt) < Date.now()) {
    throw new InvitationError('That link has been used already, or it has run out. Ask for another.');
  }

  // Hashing is deliberately slow, so it happens before the transaction is
  // opened rather than holding the registry for a tenth of a second.
  const hash = await hashPassword(input.password);

  return registry.transaction(() => {
    registry.markInvitationAccepted(invitation.id);

    const held = registry.userByEmail(invitation.email);
    if (held) {
      if (held.status !== 'active') throw new InvitationError('That account has been turned off.');
      registry.setPassword(held.id, hash);
      // Whoever had the old password no longer has a way in.
      registry.deleteUserSessions(held.id);
      return { userId: held.id };
    }

    if (invitation.kind === 'reset') {
      throw new InvitationError('There is no account for that address any more.');
    }
    try {
      const user = registry.createUser({
        tenantId: invitation.tenantId,
        email: invitation.email,
        name: input.name,
        role: invitation.role,
      });
      registry.setPassword(user.id, hash);
      return { userId: user.id };
    } catch (error) {
      if (error instanceof RegistryError) throw new InvitationError(error.message);
      throw error;
    }
  });
}
