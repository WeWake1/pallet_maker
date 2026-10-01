import { createHash, randomBytes } from 'node:crypto';
import { PRODUCT } from '../product.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './auth.js';
import { RegistryError, tenantOpen } from '../tenancy/registry.js';
import type { Invitation, Registry, Role, Tenant } from '../tenancy/registry.js';
import { mailFailure } from './mail.js';
import type { MailMessage, Mailer } from './mail.js';

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
    if (!tenantOpen(tenant)) throw new InvitationError('That company is not active.');
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

  if (invitation.tenantId !== null) {
    const tenant = registry.tenant(invitation.tenantId);
    if (!tenant || !tenantOpen(tenant)) throw new InvitationError('That company is not active.');
  }

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

/* ----------------------------------------------------------------- email */

/** What happened to an invitation once it was made. */
export interface SentInvitation {
  invitation: Invitation;
  /** Always handed back, so a link that never arrives can still be sent by hand. */
  link: string;
  /** Whether it went out by email. */
  emailed: boolean;
  /** Why it did not, where it was tried and failed. Null when it was not tried. */
  mailProblem: string | null;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The email itself: who it is from, what it is for, and the link.
 *
 * Written to be read by somebody who has never heard of this program — a new
 * person at a customer, getting it from an address they do not know — so it
 * says what the service is, who asked, and that ignoring it is safe.
 */
export function invitationMessage(input: {
  kind: 'invite' | 'reset';
  email: string;
  companyName: string | null;
  link: string;
  expiresAt: string;
}): MailMessage {
  const until = new Date(input.expiresAt).toUTCString().slice(0, 16);
  const into = input.companyName ? `${input.companyName} on Pallet Spec` : 'Pallet Spec';

  const subject =
    input.kind === 'reset' ? 'Choose a new password for Pallet Spec' : `You have been invited to ${into}`;
  const lead =
    input.kind === 'reset'
      ? `Here is a link to choose a new password for your Pallet Spec account (${input.email}).`
      : `You have been invited to join ${into}, where pallet specification sheets are drawn and printed. Follow the link to choose a password and set up your account (${input.email}).`;
  const action = input.kind === 'reset' ? 'Choose a new password' : 'Set up my account';
  const small =
    input.kind === 'reset'
      ? `The link works once, until ${until}. If you did not ask for this, ignore this email and your password stays as it is.`
      : `The link works once, until ${until}. If you were not expecting this, you can ignore this email.`;

  // Signed, so somebody who has never heard of the service can see whose
  // email this is and look it up before following anything in it.
  const signature = `${PRODUCT.name} · ${PRODUCT.site}`;

  const text = `Hello,

${lead}

${input.link}

${small}

--
${signature}
`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:28px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hello,</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escapeHtml(lead)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:10px 18px;border-radius:6px">${escapeHtml(action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#475569">Or paste this into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${escapeHtml(input.link)}" style="color:#1d4ed8">${escapeHtml(input.link)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#64748b">${escapeHtml(small)}</p>
</div>
<p style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;line-height:1.5;color:#94a3b8">${escapeHtml(PRODUCT.name)} · <a href="https://${PRODUCT.site}" style="color:#64748b;text-decoration:none">${escapeHtml(PRODUCT.site)}</a></p>
</body></html>
`;

  return { to: input.email, subject, text, html };
}

/**
 * Make an invitation, and email it where this server can send mail.
 *
 * The invitation stands whether or not the email goes: a mail server being
 * down is no reason to refuse somebody an account, and the link comes back
 * either way so that whoever asked can send it some other way.
 */
export async function sendInvitation(
  registry: Registry,
  delivery: { publicUrl: string; mailer?: Mailer | null },
  input: {
    kind: 'invite' | 'reset';
    tenantId: string | null;
    email: string;
    role: Role;
    invitedBy: string | null;
  },
): Promise<SentInvitation> {
  const { invitation, token } = createInvitation(registry, input);
  const link = invitationLink(delivery.publicUrl, token);
  if (!delivery.mailer) return { invitation, link, emailed: false, mailProblem: null };

  const companyName = input.tenantId === null ? null : (registry.tenant(input.tenantId)?.name ?? null);
  try {
    await delivery.mailer.send(
      invitationMessage({ kind: input.kind, email: invitation.email, companyName, link, expiresAt: invitation.expiresAt }),
    );
    return { invitation, link, emailed: true, mailProblem: null };
  } catch (error) {
    const problem = mailFailure(error);
    console.error(`could not email the ${input.kind} link to ${invitation.email}: ${problem}`);
    return { invitation, link, emailed: false, mailProblem: problem };
  }
}
