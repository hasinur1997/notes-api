/**
 * Zod schemas for the /api/users endpoints.
 */
import { z } from 'zod';
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
