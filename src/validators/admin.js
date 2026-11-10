/**
 * Zod schemas for the /api/admin endpoints.
 */
import { z } from 'zod';
import { objectId } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { paginationQuery } from '../utils/pagination.js';
import { emailField, interestsField, nameField, passwordField } from './auth.js';

const roleField = z.enum(ROLES);

/** GET /api/admin/users: a page of users, or the one user with an exact email. */
export const listUsersQuery = z.object({ ...paginationQuery, email: emailField.optional() }).strict();

/** POST /api/admin/users: create an account with any role. */
export const createUserBody = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    role: roleField.default('user'),
    interests: interestsField.optional(),
  })
  .strict();

/**
 * PATCH /api/admin/users/:id: change any of name, email, role, interests, or set a new password.
 * At least one field is required.
 */
export const updateUserBody = z
  .object({
    name: nameField.optional(),
    email: emailField.optional(),
    role: roleField.optional(),
    interests: interestsField.optional(),
    password: passwordField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/** GET /api/admin/notes: every note, newest first, optionally only one owner's. */
export const listAllNotesQuery = z.object({ ...paginationQuery, owner: objectId.optional() }).strict();
