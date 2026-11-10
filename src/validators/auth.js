import { z } from 'zod';

// Shared field rules, reused by user and admin validators.
export const nameField = z.string().trim().min(1, 'Name is required').max(100);
// Trim and lowercase first, then validate the format.
export const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email('Invalid email'));
// bcrypt only uses the first 72 bytes of a password.
export const passwordField = z.string().min(8, 'Password must be at least 8 characters').max(72);
export const interestsField = z.array(z.string().trim().min(1).max(50)).max(20);

export const registerBody = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    interests: interestsField.optional(),
  })
  .strict();

export const loginBody = z
  .object({
    email: emailField,
    password: z.string().min(1, 'Password is required').max(72),
  })
  .strict();
