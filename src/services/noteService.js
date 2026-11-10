/**
 * Notes business logic.
 *
 * Access model: the owner can do everything; collaborators can read and edit a shared note
 * but cannot delete it or manage its collaborators. Every query that lists or finds notes uses
 * an $or of two branches, { owner } and { collaborators }, each served by its own index
 * ({ owner: 1, _id: -1 } and { collaborators: 1, _id: -1 }), merged in _id order without an
 * in-memory sort. Functions take plain values and return plain data, so they are easy to test.
 */
import { MAX_COLLABORATORS, MAX_IMAGES_PER_NOTE, Note } from '../models/Note.js';
import { User } from '../models/User.js';
import { compareLabels, MAX_USER_LABELS, normalizeLabels } from '../utils/labels.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { buildListResponse, getPagination } from '../utils/pagination.js';

/** Fields owners and collaborators may set. Owner, collaborators and images have their own endpoints. */
const EDITABLE_FIELDS = ['title', 'content', 'labels', 'pinned', 'color', 'reminderAt'];

/** Upper bound on distinct labels returned by the summary, to keep the response small. */
export const MAX_SUMMARY_LABELS = 100;

/** Public fields of a person shown on a note. */
const PERSON_FIELDS = { name: 1, email: 1, avatar: 1 };

/**
 * Wraps conditions so they apply to notes the user owns OR that are shared with them.
 * Each branch starts with an indexed equality, so MongoDB can use both indexes.
 *
 * @param {import('mongoose').Types.ObjectId} userId - The requesting user.
 * @param {object} [conditions={}] - Extra conditions applied in both branches.
 * @returns {object} MongoDB filter.
 */
export function accessibleBy(userId, conditions = {}) {
  return { $or: [{ owner: userId, ...conditions }, { collaborators: userId, ...conditions }] };
}

/** Most words a search uses; anything after is ignored (keeps the query small). */
export const MAX_SEARCH_WORDS = 8;

/**
 * Splits a search into distinct words (case-insensitive), in order, at most MAX_SEARCH_WORDS.
 *
 * @param {string} q - Validated search text.
 * @returns {string[]} Words to match.
 */
export function searchWords(q) {
  const seen = new Set();
  return q
    .split(/\s+/)
    .filter((word) => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
    .slice(0, MAX_SEARCH_WORDS);
}

/** Condition matching one word in the title or the content (escaped, case-insensitive). */
function wordCondition(word) {
  const pattern = new RegExp(escapeRegex(word), 'i');
  return { $or: [{ title: pattern }, { content: pattern }] };
}

/**
 * Builds the list filter for the notes a user can see.
 *
 * @param {import('mongoose').Types.ObjectId} userId - The requesting user.
 * @param {{ pinned?: boolean, label?: string, q?: string, reminder?: boolean }} filters - Optional filters.
 * @returns {object} MongoDB filter. Every search word must appear in the title or the content, in
 *   any order (each regex-escaped, case-insensitive).
 */
export function buildNotesFilter(userId, { pinned, label, q, reminder } = {}) {
  const conditions = {};
  if (pinned !== undefined) conditions.pinned = pinned;
  if (label) conditions.labels = label;
  if (reminder) conditions.reminderAt = { $ne: null };
  const words = q ? searchWords(q) : [];
  if (words.length === 1) Object.assign(conditions, wordCondition(words[0]));
  if (words.length > 1) conditions.$and = words.map(wordCondition);
  return accessibleBy(userId, conditions);
}

/** Copies only whitelisted fields that are present in `input`. */
function pickEditable(input) {
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

/**
 * Fills in defaults for fields that notes created before they existed may lack.
 * Lean reads skip schema defaults, so every note leaving the service goes through this.
 *
 * @param {object} note - Lean note.
 * @returns {object} The note with every current field present.
 */
export function withDefaults(note) {
  return {
    content: '',
    labels: [],
    pinned: false,
    color: 'default',
    reminderAt: null,
    collaborators: [],
    images: [],
    ...note,
  };
}

/**
 * Replaces owner and collaborator ids with { _id, name, email } using ONE extra query on
 * users (by _id, always indexed) for the whole page. Adds `isOwner` for the requesting user.
 *
 * @param {object[]} notes - Lean notes.
 * @param {import('mongoose').Types.ObjectId} userId - The requesting user.
 * @returns {Promise<object[]>} Notes with people attached.
 */
export async function attachPeople(rawNotes, userId) {
  const notes = rawNotes.map(withDefaults);
  const ids = new Set();
  for (const note of notes) {
    ids.add(String(note.owner));
    note.collaborators.forEach((id) => ids.add(String(id)));
  }
  if (!ids.size) return notes;

  const people = await User.find({ _id: { $in: [...ids] } }, PERSON_FIELDS).lean();
  // Only the public parts of a person: never the photo's storage id.
  const toPublic = ({ _id, name, email, avatar }) => ({
    _id,
    name,
    email,
    avatar: avatar ? { url: avatar.url, width: avatar.width, height: avatar.height } : null,
  });
  const byId = new Map(people.map((person) => [String(person._id), toPublic(person)]));
  // A deleted account is shown as unknown rather than breaking the note.
  const lookup = (id) => byId.get(String(id)) ?? { _id: id, name: 'Unknown user', email: '', avatar: null };

  return notes.map((note) => ({
    ...note,
    isOwner: String(note.owner) === String(userId),
    owner: lookup(note.owner),
    collaborators: note.collaborators.map(lookup),
  }));
}

/**
 * Returns one page of notes the user can see, newest first.
 *
 * @param {import('mongoose').Types.ObjectId} userId - The requesting user.
 * @param {{ page: number, limit: number, pinned?: boolean, label?: string, q?: string, reminder?: boolean }} query - Validated query.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response.
 */
export async function listNotes(userId, { page, limit, ...filters }) {
  const filter = buildNotesFilter(userId, filters);
  const { skip } = getPagination({ page, limit });

  const [notes, total] = await Promise.all([
    Note.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    Note.countDocuments(filter),
  ]);

  return buildListResponse(await attachPeople(notes, userId), { page, limit, total });
}

/**
 * Builds the sidebar summary pipeline: total notes, notes with reminders, and each label
 * with its note count. The $match uses the same two-branch filter as lists, so both indexes apply.
 *
 * @param {import('mongoose').Types.ObjectId} userId - The requesting user.
 * @returns {object[]} Aggregation pipeline.
 */
export function buildSummaryPipeline(userId) {
  return [
    { $match: accessibleBy(userId) },
    {
      $facet: {
        total: [{ $count: 'count' }],
        reminders: [{ $match: { reminderAt: { $ne: null } } }, { $count: 'count' }],
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
 * Combines labels used on notes (with counts) and labels the user created in "Edit labels"
 * (count 0 until a note uses them). A created label is skipped if a note label already has
 * the same name ignoring case. Sorted by name, ignoring case.
 *
 * @param {{ name: string, count: number }[]} noteLabels - From the summary aggregate.
 * @param {string[]} userLabels - The user's created labels.
 * @returns {{ name: string, count: number }[]} Merged, sorted labels.
 */
export function mergeLabels(noteLabels, userLabels) {
  const known = new Set(noteLabels.map((label) => label.name.toLowerCase()));
  const created = userLabels.filter((name) => !known.has(name.toLowerCase())).map((name) => ({ name, count: 0 }));
  return [...noteLabels, ...created].sort((a, b) => compareLabels(a.name, b.name));
}

/**
 * Returns the sidebar summary: one aggregate call on notes, merged with the user's created labels
 * (already loaded with the user by the auth middleware, so no extra query).
 *
 * @param {{ _id: import('mongoose').Types.ObjectId, labels?: string[] }} user - The requesting user.
 * @returns {Promise<{ totalNotes: number, reminders: number, labels: { name: string, count: number }[] }>}
 */
export async function getNotesSummary(user) {
  const [result] = await Note.aggregate(buildSummaryPipeline(user._id));
  return {
    totalNotes: result.total[0]?.count ?? 0,
    reminders: result.reminders[0]?.count ?? 0,
    labels: mergeLabels(result.labels, user.labels ?? []),
  };
}

/**
 * Creates a label without attaching it to a note ("Create new label" in Edit labels).
 *
 * @param {{ _id: import('mongoose').Types.ObjectId, labels?: string[] }} user - The requesting user.
 * @param {string} name - Validated label name.
 * @returns {Promise<{ name: string, count: number }>} The new label.
 * @throws {ApiError} 409 if a label with that name exists (ignoring case); 400 if the limit is reached.
 */
export async function createLabel(user, name) {
  const { labels } = await getNotesSummary(user);
  if (labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
    throw ApiError.conflict('A label with this name already exists', 'LABEL_EXISTS');
  }
  if ((user.labels ?? []).length >= MAX_USER_LABELS) {
    throw ApiError.badRequest(`You can create at most ${MAX_USER_LABELS} labels`, 'LIMIT_REACHED');
  }
  await User.updateOne({ _id: user._id }, { $addToSet: { labels: name } });
  return { name, count: 0 };
}

/** Writes the user's created labels after a rename or delete, only if they changed. */
async function updateUserLabels(user, change) {
  const current = user.labels ?? [];
  const next = normalizeLabels(change(current));
  const changed = next.length !== current.length || next.some((label, i) => label !== current[i]);
  if (changed) await User.updateOne({ _id: user._id }, { $set: { labels: next } });
}

/**
 * Finds one note the user can see (owner or collaborator; admins may read any note).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user - The requesting user.
 * @returns {Promise<object | null>} The note with people attached, or null if missing or not visible.
 */
export async function findNote(noteId, user) {
  const filter = user.role === 'admin' ? { _id: noteId } : { _id: noteId, ...accessibleBy(user._id) };
  const note = await Note.findOne(filter).lean();
  return note ? (await attachPeople([note], user._id))[0] : null;
}

/**
 * Creates a note owned by the user.
 *
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @param {object} input - Validated body.
 * @returns {Promise<object>} The created note with people attached.
 */
export async function createNote(userId, input) {
  const note = await Note.create({ ...pickEditable(input), owner: userId });
  return (await attachPeople([note.toObject()], userId))[0];
}

/**
 * Updates a note the user owns or collaborates on (access is part of the query).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @param {object} input - Validated body with at least one editable field.
 * @returns {Promise<object | null>} The updated note, or null if missing or not accessible.
 */
export async function updateNote(noteId, userId, input) {
  const note = await Note.findOneAndUpdate(
    { _id: noteId, ...accessibleBy(userId) },
    { $set: pickEditable(input) },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  return note ? (await attachPeople([note], userId))[0] : null;
}

/**
 * Deletes a note. Only the owner may delete; collaborators get "not found".
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user.
 * @returns {Promise<object | null>} The deleted note (so its images can be removed), or null.
 */
export function deleteNote(noteId, ownerId) {
  return Note.findOneAndDelete({ _id: noteId, owner: ownerId }).lean();
}

/**
 * Creates a copy of a note the user can see. The copy belongs to the user, is unpinned,
 * and is not shared. Images are not copied (they belong to the original note).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @returns {Promise<object | null>} The new note, or null if the original is not accessible.
 */
export async function copyNote(noteId, userId) {
  const original = await Note.findOne({ _id: noteId, ...accessibleBy(userId) }).lean();
  if (!original) return null;
  const { title, content, labels, color, reminderAt } = original;
  return createNote(userId, { title, content, labels, color, reminderAt });
}

/**
 * Renames a label on every note the user can see, and in the user's created labels.
 * If a note already has the new name, they merge. Adds the new name first, then removes the
 * old one, so a failure never loses a label.
 *
 * @param {{ _id: import('mongoose').Types.ObjectId, labels?: string[] }} user - The requesting user.
 * @param {string} from - Existing label (exact match).
 * @param {string} to - New label.
 * @returns {Promise<{ found: boolean, notesUpdated: number }>} Whether the label existed, and notes changed.
 */
export async function renameLabel(user, from, to) {
  const filter = accessibleBy(user._id, { labels: from });
  const inUserLabels = (user.labels ?? []).includes(from);
  if (inUserLabels) await updateUserLabels(user, (labels) => labels.map((label) => (label === from ? to : label)));

  if (from === to) {
    const count = await Note.countDocuments(filter);
    return { found: inUserLabels || count > 0, notesUpdated: 0 };
  }
  await Note.updateMany(filter, { $addToSet: { labels: to } });
  // Every note that still has the old label is touched here, so this count is the number renamed.
  const { modifiedCount } = await Note.updateMany(filter, { $pull: { labels: from } });
  return { found: inUserLabels || modifiedCount > 0, notesUpdated: modifiedCount };
}

/**
 * Removes a label from every note the user can see and from the user's created labels
 * (the notes themselves are kept).
 *
 * @param {{ _id: import('mongoose').Types.ObjectId, labels?: string[] }} user - The requesting user.
 * @param {string} name - Label to remove (exact match).
 * @returns {Promise<{ found: boolean, notesUpdated: number }>} Whether the label existed, and notes changed.
 */
export async function deleteLabel(user, name) {
  const inUserLabels = (user.labels ?? []).includes(name);
  if (inUserLabels) await updateUserLabels(user, (labels) => labels.filter((label) => label !== name));
  const { modifiedCount } = await Note.updateMany(accessibleBy(user._id, { labels: name }), { $pull: { labels: name } });
  return { found: inUserLabels || modifiedCount > 0, notesUpdated: modifiedCount };
}

/**
 * Shares a note with another registered user, found by email. Owner only.
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} ownerId - The authenticated user (must own the note).
 * @param {string} email - Validated, lowercased email of the person to add.
 * @returns {Promise<object>} The updated note with people attached.
 * @throws {ApiError} 404 if the note is not owned or no account uses the email; 400 for self or limit reached.
 */
export async function addCollaborator(noteId, ownerId, email) {
  const [note, person] = await Promise.all([
    Note.findOne({ _id: noteId, owner: ownerId }, { collaborators: 1 }).lean(),
    User.findOne({ email }, { _id: 1 }).lean(),
  ]);
  if (!note) throw ApiError.notFound('Note not found');
  if (!person) throw ApiError.notFound('No account uses that email', 'USER_NOT_FOUND');
  if (String(person._id) === String(ownerId)) throw ApiError.badRequest('You already own this note', 'IS_OWNER');
  const current = note.collaborators ?? [];
  if (current.length >= MAX_COLLABORATORS && !current.some((id) => String(id) === String(person._id))) {
    throw ApiError.badRequest(`A note can be shared with at most ${MAX_COLLABORATORS} people`, 'LIMIT_REACHED');
  }

  const updated = await Note.findOneAndUpdate(
    { _id: noteId, owner: ownerId },
    { $addToSet: { collaborators: person._id } },
    { returnDocument: 'after' },
  ).lean();
  return (await attachPeople([updated], ownerId))[0];
}

/**
 * Removes a collaborator. The owner may remove anyone; a collaborator may remove only
 * themselves (leave the note).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} actorId - The authenticated user.
 * @param {string} collaboratorId - Validated ObjectId string of the person to remove.
 * @returns {Promise<boolean>} True if the note was found and the actor was allowed.
 */
export async function removeCollaborator(noteId, actorId, collaboratorId) {
  const leaving = String(actorId) === collaboratorId;
  const filter = leaving ? { _id: noteId, collaborators: actorId } : { _id: noteId, owner: actorId };
  const { matchedCount } = await Note.updateOne(filter, { $pull: { collaborators: collaboratorId } });
  return matchedCount === 1;
}

/**
 * Adds an uploaded image to a note the user can see.
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @param {(note: object) => Promise<{ url: string, publicId: string, width: number, height: number }>} upload - Stores the file, called only after access and limit checks pass.
 * @returns {Promise<object>} The updated note with people attached.
 * @throws {ApiError} 404 if not accessible; 400 if the note already has the maximum number of images.
 */
export async function addImage(noteId, userId, upload) {
  const note = await Note.findOne({ _id: noteId, ...accessibleBy(userId) }, { images: 1 }).lean();
  if (!note) throw ApiError.notFound('Note not found');
  if ((note.images ?? []).length >= MAX_IMAGES_PER_NOTE) {
    throw ApiError.badRequest(`A note can have at most ${MAX_IMAGES_PER_NOTE} images`, 'LIMIT_REACHED');
  }
  const image = await upload(note);
  const updated = await Note.findOneAndUpdate(
    { _id: noteId, ...accessibleBy(userId) },
    { $push: { images: image } },
    { returnDocument: 'after' },
  ).lean();
  return (await attachPeople([updated], userId))[0];
}

/**
 * Removes one image from a note the user can see.
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @param {string} imageId - Validated ObjectId string of the image.
 * @returns {Promise<{ note: object, removed: { publicId: string } } | null>} Updated note and the removed image, or null.
 */
export async function removeImage(noteId, userId, imageId) {
  const before = await Note.findOneAndUpdate(
    { _id: noteId, ...accessibleBy(userId), 'images._id': imageId },
    { $pull: { images: { _id: imageId } } },
    { returnDocument: 'before' },
  ).lean();
  if (!before) return null;
  const images = before.images ?? [];
  const removed = images.find((image) => String(image._id) === imageId);
  const after = { ...before, images: images.filter((image) => String(image._id) !== imageId) };
  return { note: (await attachPeople([after], userId))[0], removed };
}

/**
 * Replaces one image of a note the user can see with a newly uploaded one, keeping its position
 * (used after cropping an existing image).
 *
 * @param {string} noteId - Validated ObjectId string.
 * @param {import('mongoose').Types.ObjectId} userId - The authenticated user.
 * @param {string} imageId - Validated ObjectId string of the image to replace.
 * @param {() => Promise<{ url: string, publicId: string, width: number, height: number }>} upload - Stores the new file, called only after access checks pass.
 * @returns {Promise<{ note: object, replaced: { publicId: string } }>} Updated note and the old image (to delete).
 * @throws {ApiError} 404 if the note or image is not found or not accessible.
 */
export async function replaceImage(noteId, userId, imageId, upload) {
  const filter = { _id: noteId, ...accessibleBy(userId), 'images._id': imageId };
  const before = await Note.findOne(filter, { images: 1 }).lean();
  const replaced = (before?.images ?? []).find((image) => String(image._id) === imageId);
  if (!replaced) throw ApiError.notFound('Image not found');

  const image = await upload();
  const updated = await Note.findOneAndUpdate(filter, { $set: { 'images.$': image } }, { returnDocument: 'after' }).lean();
  if (!updated) throw ApiError.notFound('Image not found');
  return { note: (await attachPeople([updated], userId))[0], replaced };
}
