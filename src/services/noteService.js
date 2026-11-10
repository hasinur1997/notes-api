/**
 * Notes business logic. Every query filters by owner first, so all of them use the
 * { owner: 1, _id: -1 } index; lists sort by { _id: -1 } on the same index.
 * Functions take plain values and return plain data (no req/res), so they are easy to test.
 */
import { Note } from '../models/Note.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { buildListResponse, getPagination } from '../utils/pagination.js';

/** Fields a client may set. Anything else (owner, _id, timestamps) is controlled by the server. */
const EDITABLE_FIELDS = ['title', 'content', 'labels', 'pinned'];

/** Upper bound on distinct labels returned by the summary, to keep the response small. */
export const MAX_SUMMARY_LABELS = 100;

/**
 * Builds the find filter for a user's notes.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - Whose notes.
 * @param {{ pinned?: boolean, label?: string, q?: string }} filters - Optional filters.
 * @returns {object} MongoDB filter. The search term is regex-escaped and matched case-insensitively.
 */
export function buildNotesFilter(ownerId, { pinned, label, q } = {}) {
  const filter = { owner: ownerId };
  if (pinned !== undefined) filter.pinned = pinned;
  if (label) filter.labels = label;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: pattern }, { content: pattern }];
  }
  return filter;
}

/** Copies only whitelisted fields that are present in `input`. */
function pickEditable(input) {
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

/**
 * Returns one page of a user's notes, newest first.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - Whose notes.
 * @param {{ page: number, limit: number, pinned?: boolean, label?: string, q?: string }} query - Validated query.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response.
 */
export async function listNotes(ownerId, { page, limit, ...filters }) {
  const filter = buildNotesFilter(ownerId, filters);
  const { skip } = getPagination({ page, limit });

  const [data, total] = await Promise.all([
    Note.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    Note.countDocuments(filter),
  ]);

  return buildListResponse(data, { page, limit, total });
}

/**
 * Builds the sidebar summary pipeline: total note count and each label with its note count.
 * The first stage matches on owner, so the pipeline uses the { owner: 1, _id: -1 } index.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - Whose notes.
 * @returns {object[]} Aggregation pipeline.
 */
export function buildSummaryPipeline(ownerId) {
  return [
    { $match: { owner: ownerId } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        labels: [
          { $project: { labels: 1 } },
          { $unwind: '$labels' },
          { $group: { _id: '$labels', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $limit: MAX_SUMMARY_LABELS },
          { $project: { _id: 0, name: '$_id', count: 1 } },
        ],
      },
    },
  ];
}

/**
 * Returns the sidebar summary for a user in one aggregate call, labels sorted by name.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - Whose notes.
 * @returns {Promise<{ totalNotes: number, labels: { name: string, count: number }[] }>}
 */
export async function getNotesSummary(ownerId) {
  const [result] = await Note.aggregate(buildSummaryPipeline(ownerId));
  return { totalNotes: result.total[0]?.count ?? 0, labels: result.labels };
}

/**
 * Finds one note. Regular users only see their own; admins may read any note.
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {{ _id: unknown, role: string }} user - The requesting user.
 * @returns {Promise<object | null>} The note, or null if missing or not visible to this user.
 */
export function findNote(noteId, user) {
  const filter = user.role === 'admin' ? { _id: noteId } : { _id: noteId, owner: user._id };
  return Note.findOne(filter).lean();
}

/**
 * Creates a note owned by the given user.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @param {{ title: string, content?: string, labels?: string[], pinned?: boolean }} input - Validated body.
 * @returns {Promise<object>} The created note.
 */
export async function createNote(ownerId, input) {
  const note = await Note.create({ ...pickEditable(input), owner: ownerId });
  return note.toJSON();
}

/**
 * Updates a note only if it belongs to the user (ownership is part of the query).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @param {object} input - Validated body with at least one editable field.
 * @returns {Promise<object | null>} The updated note, or null if missing or not owned.
 */
export function updateNote(noteId, ownerId, input) {
  return Note.findOneAndUpdate(
    { _id: noteId, owner: ownerId },
    { $set: pickEditable(input) },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

/**
 * Deletes a note only if it belongs to the user.
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @returns {Promise<boolean>} True if a note was deleted.
 */
export async function deleteNote(noteId, ownerId) {
  const { deletedCount } = await Note.deleteOne({ _id: noteId, owner: ownerId });
  return deletedCount === 1;
}

/**
 * Renames a label on all of a user's notes. If a note already has the new name, the two merge.
 * Adds the new name first, then removes the old one, so a failure never loses a label.
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @param {string} from - Existing label (exact match).
 * @param {string} to - New label.
 * @returns {Promise<number>} Number of notes that had the label.
 */
export async function renameLabel(ownerId, from, to) {
  if (from === to) return Note.countDocuments({ owner: ownerId, labels: from });
  await Note.updateMany({ owner: ownerId, labels: from }, { $addToSet: { labels: to } });
  // Every note that still has the old label is touched here, so this count is the number renamed.
  const { modifiedCount } = await Note.updateMany({ owner: ownerId, labels: from }, { $pull: { labels: from } });
  return modifiedCount;
}

/**
 * Removes a label from all of a user's notes (the notes themselves are kept).
 *
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @param {string} name - Label to remove (exact match).
 * @returns {Promise<number>} Number of notes updated.
 */
export async function deleteLabel(ownerId, name) {
  const { modifiedCount } = await Note.updateMany({ owner: ownerId, labels: name }, { $pull: { labels: name } });
  return modifiedCount;
}
