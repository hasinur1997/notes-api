/**
 * Zod schemas for the /api/users endpoints.
 */
import { z } from 'zod';
import { NOTES_PAGINATION, NOTES_PER_PAGE } from '../models/User.js';
import { interestsField, nameField } from './auth.js';

/**
 * Body for PATCH /api/users/me. Only name and interests can change; email, role and password
 * are rejected as unknown fields. At least one field is required.
 */
export const updateMeBody = z
  .object({
    name: nameField.optional(),
    interests: interestsField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide a name or interests to update');

/**
 * Body for PATCH /api/users/me/settings. Any subset of the known settings; unknown keys and
 * values outside the allowed choices are rejected. At least one setting is required.
 */
export const updateSettingsBody = z
  .object({
    notesPagination: z.enum(NOTES_PAGINATION).optional(),
    notesPerPage: z
      .number()
      .int()
      .refine((value) => NOTES_PER_PAGE.includes(value), `Notes per page must be one of ${NOTES_PER_PAGE.join(', ')}`)
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one setting to update');
