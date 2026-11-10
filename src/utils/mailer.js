/**
 * Sends email through SMTP when SMTP_HOST is configured. Without it:
 * - development: the email is printed to the console (so reset links can be tested locally);
 * - test: the email is kept in `outbox` for assertions;
 * - production: nothing is sent and an error is logged.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Emails "sent" while running tests without SMTP (newest last). */
export const outbox = [];

/**
 * Whether real email delivery is configured.
 *
 * @returns {boolean} True when SMTP_HOST is set.
 */
export function isEmailConfigured() {
  return Boolean(transport);
}

/**
 * Sends one email.
 *
 * @param {{ to: string, subject: string, text: string, html: string }} message - The email.
 * @returns {Promise<void>}
 * @throws {Error} If the SMTP server rejects the message.
 */
export async function sendMail({ to, subject, text, html }) {
  if (transport) {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
    return;
  }
  if (env.NODE_ENV === 'test') {
    outbox.push({ to, subject, text, html });
    return;
  }
  if (!env.isProduction) {
    console.log(`\n──── Email (SMTP not configured, printed instead) ────\nTo: ${to}\nSubject: ${subject}\n\n${text}\n─────────────────────────────────────────────────────\n`);
    return;
  }
  console.error(`Email to ${to} not sent: SMTP is not configured`);
}

/**
 * Escapes text for safe use inside HTML email bodies.
 *
 * @param {string} text - Untrusted text (e.g. a user's name).
 * @returns {string} HTML-escaped text.
 */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
