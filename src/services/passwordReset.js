/**
 * Password reset by email.
 *
 * Security:
 * - The emailed token is 32 random bytes; only its SHA-256 hash is stored, so a database leak
 *   cannot be used to reset passwords. It expires after 30 minutes and works once.
 * - The user is looked up by email (indexed); the token is compared in constant time.
 * - Requesting a reset never reveals whether an account exists.
 * - A successful reset increments tokenVersion, which invalidates every token issued earlier
 *   (see middleware/auth.js), and sends a "password changed" notice.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeHtml, sendMail } from '../utils/mailer.js';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_TOKEN_BYTES = 32;

/** SHA-256 of a token, as hex. */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Builds the reset link for the web app. */
export function resetLink(email, token) {
  const url = new URL('/reset-password', env.APP_URL);
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Creates a reset token for the account (if it exists) and emails the link.
 * Callers must respond the same way whether or not an account exists.
 *
 * @param {string} email - Validated, lowercased email.
 * @returns {Promise<boolean>} True if an email was sent (for logging/tests only, never for the response).
 */
export async function requestPasswordReset(email) {
  const user = await User.findOne({ email }, { name: 1, email: 1 }).lean();
  if (!user) return false;

  const token = randomBytes(RESET_TOKEN_BYTES).toString('hex');
  await User.updateOne(
    { _id: user._id },
    { $set: { resetPasswordTokenHash: hashToken(token), resetPasswordExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) } },
  );

  const link = resetLink(user.email, token);
  const name = escapeHtml(user.name);
  await sendMail({
    to: user.email,
    subject: 'Reset your Notes password',
    text:
      `Hi ${user.name},\n\nWe received a request to reset your Notes password.\n` +
      `Open this link within 30 minutes to choose a new one:\n\n${link}\n\n` +
      `If you didn't ask for this, you can ignore this email. Your password won't change.`,
    html:
      `<p>Hi ${name},</p><p>We received a request to reset your Notes password.</p>` +
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#f2a93b;color:#2b211a;border-radius:10px;text-decoration:none;font-weight:bold">Choose a new password</a></p>` +
      `<p>This link works once and expires in 30 minutes.</p>` +
      `<p>If you didn't ask for this, you can ignore this email. Your password won't change.</p>`,
  });
  return true;
}

/**
 * Sets a new password using a valid, unexpired reset token, then clears the token.
 *
 * @param {{ email: string, token: string, password: string }} input - Validated input.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 INVALID_RESET_TOKEN if the link is wrong, used or expired.
 */
export async function resetPassword({ email, token, password }) {
  const user = await User.findOne({ email }).select('+password +resetPasswordTokenHash +resetPasswordExpiresAt +tokenVersion');
  const stored = user?.resetPasswordTokenHash;
  const valid =
    stored &&
    user.resetPasswordExpiresAt?.getTime() > Date.now() &&
    timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(stored, 'hex'));
  if (!valid) {
    throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.', 'INVALID_RESET_TOKEN');
  }

  user.password = password; // hashed by the pre('save') hook
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;
  // Revokes every access token issued before this reset (see middleware/auth.js).
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  sendMail({
    to: user.email,
    subject: 'Your Notes password was changed',
    text: `Hi ${user.name},\n\nYour Notes password was just changed and you were signed out on other devices.\nIf this wasn't you, reset your password again right away.`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Your Notes password was just changed and you were signed out on other devices.</p><p>If this wasn't you, reset your password again right away.</p>`,
  }).catch((err) => console.error('Could not send password-changed email:', err.message));
}
