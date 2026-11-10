/**
 * Zod schemas for the /api/notes endpoints.
 */
import { z } from 'zod';
import { MAX_LABEL_LENGTH, MAX_LABELS_PER_NOTE } from '../models/Note.js';
import { paginationQuery } from '../utils/pagination.js';

/** Note title: trimmed, 1–200 characters. */
const titleField = z.string().trim().min(1, 'Title is required').max(200);

/** Note body: up to 20,000 characters (may be empty). */
const contentField = z.string().max(20000);

/** One label: trimmed, 1–30 characters. */
export const labelField = z.string().trim().min(1, 'Label is required').max(MAX_LABEL_LENGTH);

/** Labels on a note: up to 10. The model trims and removes duplicates. */
const labelsField = z.array(labelField).max(MAX_LABELS_PER_NOTE);

/** "true" / "false" query string to boolean. */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Query for GET /api/notes: pagination plus optional pinned, label and search filters. */
export const listNotesQuery = z
  .object({
    ...paginationQuery,
    pinned: booleanQuery.optional(),
    label: labelField.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Body for POST /api/notes. Owner is always the authenticated user, never taken from the body. */
export const createNoteBody = z
  .object({
    title: titleField,
    content: contentField.optional(),
    labels: labelsField.optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

/** Body for PATCH /api/notes/:id. At least one field is required. */
export const updateNoteBody = z
  .object({
    title: titleField.optional(),
    content: contentField.optional(),
    labels: labelsField.optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/** Params for /api/notes/labels/:name. */
export const labelParams = z.object({ name: labelField }).strict();

/** Body for PATCH /api/notes/labels/:name. */
export const renameLabelBody = z.object({ name: labelField }).strict();
