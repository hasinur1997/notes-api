/**
 * Zod schemas for the /api/admin endpoints.
 */
import { z } from 'zod';
import { objectId } from '../middleware/validate.js';
import { ROLES } from '../models/User.js';
import { paginationQuery } from '../utils/pagination.js';
import { emailField, interestsField, nameField, passwordField } from './auth.js';
import { booleanQuery } from './notes.js';

const roleField = z.enum(ROLES);

/**
 * GET /api/admin/users: a page of users, optionally only those whose name or email contains `q`,
 * and optionally without the signed-in admin (`excludeSelf=true`).
 */
export const listUsersQuery = z
  .object({
    ...paginationQuery,
    q: z.string().trim().min(1).max(100).optional(),
    excludeSelf: booleanQuery.optional(),
  })
  .strict();

/**
 * GET /api/admin/users/grouped-by-interest: a page of interest groups, optionally only one interest.
 * The interest is trimmed and lowercased the same way stored interests are, so `Chess` matches `chess`.
 */
export const interestGroupsQuery = z
  .object({
    ...paginationQuery,
    interest: z.string().trim().toLowerCase().min(1).max(50).optional(),
  })
  .strict();

/** GET /api/admin/users/:id/notes: that user's notes as they see them, optionally pinned only / unpinned only. */
export const userNotesQuery = z
  .object({
    ...paginationQuery,
    pinned: booleanQuery.optional(),
  })
  .strict();

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
