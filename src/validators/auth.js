/**
 * Zod schemas for the auth endpoints, plus field rules shared with user and admin validators.
 */
import { z } from 'zod';

/** Display name: trimmed, 1–100 characters. */
export const nameField = z.string().trim().min(1, 'Name is required').max(100);

/** Email: trimmed and lowercased first, then format-checked. */
export const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email('Invalid email'));

/** Password: 8–72 characters (bcrypt only uses the first 72 bytes). */
export const passwordField = z.string().min(8, 'Password must be at least 8 characters').max(72);

/** Interests: up to 20 entries of 1–50 characters. The model normalizes case and duplicates. */
export const interestsField = z.array(z.string().trim().min(1).max(50)).max(20);

/** Body for POST /api/auth/register. `role` is deliberately not accepted. */
export const registerBody = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    interests: interestsField.optional(),
  })
  .strict();

/** Body for POST /api/auth/login. Password strength is not checked here, only presence. */
export const loginBody = z
  .object({
    email: emailField,
    password: z.string().min(1, 'Password is required').max(72),
  })
  .strict();

/** Body for POST /api/auth/forgot-password. */
export const forgotPasswordBody = z.object({ email: emailField }).strict();

/** Body for POST /api/auth/reset-password. The token is the 64-character hex value from the emailed link. */
export const resetPasswordBody = z
  .object({
    email: emailField,
    token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid reset link'),
    password: passwordField,
  })
  .strict();
