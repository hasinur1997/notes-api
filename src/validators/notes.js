/**
 * Zod schemas for the /api/notes endpoints.
 */
import { z } from 'zod';
import { objectId } from '../middleware/validate.js';
import { MAX_LABEL_LENGTH, MAX_LABELS_PER_NOTE, NOTE_COLORS } from '../models/Note.js';
import { emailField } from './auth.js';
import { paginationQuery } from '../utils/pagination.js';

/** Note title: trimmed, 1–200 characters. */
const titleField = z.string().trim().min(1, 'Title is required').max(200);

/** Note body: up to 20,000 characters (may be empty). */
const contentField = z.string().max(20000);

/** One label: trimmed, 1–30 characters. */
export const labelField = z.string().trim().min(1, 'Label is required').max(MAX_LABEL_LENGTH);

/** Labels on a note: up to 10. The model trims and removes duplicates. */
const labelsField = z.array(labelField).max(MAX_LABELS_PER_NOTE);

/** One of the palette colour keys. */
const colorField = z.enum(NOTE_COLORS);

/** Furthest a reminder may be set in the future. */
const MAX_REMINDER_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/** Reminder time as an ISO 8601 string (converted to a Date), or null to clear it. */
const reminderField = z
  .union([z.iso.datetime({ offset: true }), z.null()])
  .transform((value) => (value === null ? null : new Date(value)))
  .refine((date) => date === null || date.getTime() - Date.now() < MAX_REMINDER_MS, 'Reminder is too far in the future');

/** "true" / "false" query string to boolean. */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Query for GET /api/notes: pagination plus optional pinned, label and search filters. */
export const listNotesQuery = z
  .object({
    ...paginationQuery,
    pinned: booleanQuery.optional(),
    label: labelField.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    reminder: booleanQuery.optional(),
  })
  .strict();

/** Body for POST /api/notes. Owner is always the authenticated user, never taken from the body. */
export const createNoteBody = z
  .object({
    title: titleField,
    content: contentField.optional(),
    labels: labelsField.optional(),
    pinned: z.boolean().optional(),
    color: colorField.optional(),
    reminderAt: reminderField.optional(),
  })
  .strict();

/** Body for PATCH /api/notes/:id. At least one field is required. */
export const updateNoteBody = z
  .object({
    title: titleField.optional(),
    content: contentField.optional(),
    labels: labelsField.optional(),
    pinned: z.boolean().optional(),
    color: colorField.optional(),
    reminderAt: reminderField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/** Params for /api/notes/labels/:name. */
export const labelParams = z.object({ name: labelField }).strict();

/** Body for POST /api/notes/labels and PATCH /api/notes/labels/:name. */
export const renameLabelBody = z.object({ name: labelField }).strict();

/** Body for POST /api/notes/:id/collaborators. */
export const addCollaboratorBody = z.object({ email: emailField }).strict();

/** Params for DELETE /api/notes/:id/collaborators/:userId. */
export const collaboratorParams = z.object({ id: objectId, userId: objectId }).strict();

/** Params for DELETE /api/notes/:id/images/:imageId. */
export const imageParams = z.object({ id: objectId, imageId: objectId }).strict();
