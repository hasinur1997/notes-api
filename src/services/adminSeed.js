/**
 * Creates the first admin account. Used by `npm run seed`.
 */
import { z } from 'zod';
import { User } from '../models/User.js';
import { emailField, nameField, passwordField } from '../validators/auth.js';

/** Same rules as registration, so the admin can sign in through the normal login form. */
const adminSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
});

/**
 * Ensures an admin account exists for the given email. Safe to run repeatedly:
 * an existing admin is left untouched (its password is never overwritten).
 * An existing non-admin account is NOT promoted, so a seed run can never silently
 * grant admin rights to someone else's account.
 *
 * @param {{ name?: string, email?: string, password?: string }} input - Usually ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD.
 * @returns {Promise<{ status: 'created' | 'exists', email: string }>} What happened.
 * @throws {z.ZodError} If the values are missing or invalid (e.g. password shorter than 8 characters).
 * @throws {Error} If a non-admin account already uses the email.
 */
export async function ensureAdmin(input) {
  const { name, email, password } = adminSchema.parse(input);

  const existing = await User.findOne({ email }).lean();
  if (existing?.role === 'admin') return { status: 'exists', email };
  if (existing) {
    throw new Error(
      `A non-admin account already uses ${email}. Choose another ADMIN_EMAIL; existing accounts are never promoted automatically.`,
    );
  }

  // create() runs the pre('save') hook, so the password is stored as a bcrypt hash.
  await User.create({ name, email, password, role: 'admin' });
  return { status: 'created', email };
}
