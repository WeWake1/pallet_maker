import nodemailer from 'nodemailer';

/**
 * Sending an email: the invitation that lets somebody in, and the link that
 * lets them back in.
 *
 * Plain SMTP, because every service that sends mail for a domain speaks it —
 * Microsoft 365, Google Workspace, Zoho, and the sending services built for
 * this (Postmark, Resend, Brevo, Amazon SES, Azure Communication Services) —
 * so which one is used is a setting on the server rather than a rewrite here.
 *
 * Nothing is required: a server with no mail set up still makes the link and
 * shows it to whoever asked for it, exactly as before, and they send it on.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Who the mail says it is from, to show on the vendor's screen. */
  readonly from: string;
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailConfigError';
  }
}

/**
 * The SMTP settings in the environment, or null where there are none.
 *
 *   PALLET_SMTP_HOST   the server to hand mail to; unset means no mail
 *   PALLET_SMTP_PORT   587 (STARTTLS) unless said; 465 is TLS from the start
 *   PALLET_SMTP_USER   and
 *   PALLET_SMTP_PASS   what it wants to be signed in with, if anything
 *   PALLET_MAIL_FROM   "Pallet Spec <no-reply@example.com>"
 *
 * Half a configuration is refused rather than guessed at: a host with no
 * sender, or a user with no password, is a typing slip in the env file, and
 * the server should say so when it starts rather than when somebody is being
 * invited.
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.PALLET_SMTP_HOST?.trim() ?? '';
  if (host === '') return null;

  const port = Number(env.PALLET_SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailConfigError(`PALLET_SMTP_PORT is "${env.PALLET_SMTP_PORT}"; it has to be a port number, usually 587 or 465.`);
  }
  const from = env.PALLET_MAIL_FROM?.trim() ?? '';
  if (from === '') {
    throw new MailConfigError(
      'PALLET_SMTP_HOST is set but PALLET_MAIL_FROM is not. Say who the mail is from, e.g. "Pallet Spec <no-reply@example.com>".',
    );
  }
  const user = env.PALLET_SMTP_USER?.trim() || null;
  const pass = env.PALLET_SMTP_PASS || null;
  if ((user === null) !== (pass === null)) {
    throw new MailConfigError('PALLET_SMTP_USER and PALLET_SMTP_PASS go together: set both, or neither.');
  }
  return { host, port, user, pass, from };
}

export function smtpMailer(config: SmtpConfig): Mailer {
  const secure = config.port === 465;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    // A password is never sent over a connection that has not been made
    // private first. A relay on the same machine that asks for no password
    // may be spoken to in the clear.
    requireTLS: !secure && config.user !== null,
    auth: config.user !== null ? { user: config.user, pass: config.pass ?? '' } : undefined,
    // Somebody is waiting on the other end of the button. A mail server that
    // does not answer should be given up on in seconds, and the link shown to
    // send by hand, rather than holding the page for the default two minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    from: config.from,
    async send(message) {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

/** What a failed send said, in a line fit to show the vendor. */
export function mailFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0]!.slice(0, 200);
}
