/**
 * Zod schemas for the /api/posts endpoints and GET /api/users/:id/posts.
 */
import { z } from 'zod';
import { objectId } from '../middleware/validate.js';
import { NOTE_COLORS } from '../models/Note.js';
import { paginationQuery } from '../utils/pagination.js';

/** Post title: trimmed, 1–200 characters. */
const titleField = z.string().trim().min(1, 'Title is required').max(200);

/** Post text (Markdown): up to 20,000 characters (may be empty). */
const contentField = z.string().max(20000);

/** One of the palette colour keys (same palette as notes). */
const colorField = z.enum(NOTE_COLORS);

/** Query for list endpoints: pagination only. */
export const listPostsQuery = z.object(paginationQuery).strict();

/** Body for POST /api/posts. The author is always the authenticated user, never taken from the body. */
export const createPostBody = z
  .object({
    title: titleField,
    content: contentField.optional(),
    color: colorField.optional(),
  })
  .strict();

/** Body for PATCH /api/posts/:id. At least one field is required. */
export const updatePostBody = z
  .object({
    title: titleField.optional(),
    content: contentField.optional(),
    color: colorField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/** Params for /api/posts/:id/images/:imageId. */
export const postImageParams = z.object({ id: objectId, imageId: objectId }).strict();
