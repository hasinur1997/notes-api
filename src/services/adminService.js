/**
 * Administration: managing accounts and reading every note. Callers must already be checked
 * as admins (the /api/admin router uses requireRole('admin')).
 */
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteImages } from '../utils/imageStorage.js';
import { buildListResponse, getPagination } from '../utils/pagination.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { attachPeople, buildNotesFilter } from './noteService.js';

/** Fields an admin sees for each user (never the password, tokens or storage ids). */
const USER_FIELDS = { name: 1, email: 1, role: 1, interests: 1, avatar: 1, createdAt: 1, updatedAt: 1 };
/** Fields an admin may change on another account. */
const EDITABLE_FIELDS = ['name', 'email', 'role', 'interests'];

/** Shapes a lean user for the admin list (drops the photo's storage id). */
function toAdminUser({ avatar, ...user }) {
  return { ...user, avatar: avatar ? { url: avatar.url, width: avatar.width, height: avatar.height } : null };
}

/**
 * A page of users, newest first, in the order of the _id index. Without `q` the total comes from
 * collection metadata (no scan). With `q`, users whose name or email contains it (escaped,
 * case-insensitive) are returned: an approved exception to the index rule, because substring
 * search cannot use an index and reads every user (see CLAUDE.md). With `excludeSelf` the signed-in
 * admin is left out (an `_id` range on the same index); without `q` the total is then the metadata
 * count minus one, since the admin's own account always exists.
 *
 * @param {{ page: number, limit: number, q?: string, excludeSelf?: boolean }} query - Validated query.
 * @param {import('mongoose').Types.ObjectId} adminId - The signed-in admin.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response.
 */
export async function listUsers({ page, limit, q, excludeSelf }, adminId) {
  const pattern = q ? new RegExp(escapeRegex(q), 'i') : null;
  const filter = pattern ? { $or: [{ name: pattern }, { email: pattern }] } : {};
  if (excludeSelf) filter._id = { $ne: adminId };
  const { skip } = getPagination({ page, limit });
  const [users, total] = await Promise.all([
    User.find(filter, USER_FIELDS).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    pattern ? User.countDocuments(filter) : User.estimatedDocumentCount().then((count) => (excludeSelf ? count - 1 : count)),
  ]);
  return buildListResponse(users.map(toAdminUser), { page, limit, total });
}

/**
 * One user's notes exactly as that user sees them (owned + shared with them), newest first,
 * read-only for the admin. Same filter and indexes as the user's own list (SORT_MERGE over
 * { owner: 1, _id: -1 } and { collaborators: 1, _id: -1 }).
 *
 * @param {import('mongoose').Types.ObjectId} adminId - The admin reading (for `isOwner`, always false here).
 * @param {string} userId - Validated ObjectId string.
 * @param {{ page: number, limit: number, pinned?: boolean }} query - Validated query.
 * @returns {Promise<{ user: object, data: object[], meta: object }>} The user and a standard list.
 * @throws {ApiError} 404 if there is no such user.
 */
export async function listUserNotes(adminId, userId, { page, limit, pinned }) {
  const user = await User.findById(userId, { _id: 1 }).lean();
  if (!user) throw ApiError.notFound('User not found');
  const filter = buildNotesFilter(user._id, { pinned });
  const { skip } = getPagination({ page, limit });
  const [notes, total] = await Promise.all([
    Note.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    Note.countDocuments(filter),
  ]);
  return buildListResponse(await attachPeople(notes, adminId), { page, limit, total });
}

/**
 * One user by id.
 *
 * @param {string} id - Validated ObjectId string.
 * @returns {Promise<object>} The user.
 * @throws {ApiError} 404 if there is no such user.
 */
export async function getUser(id) {
  const user = await User.findById(id, USER_FIELDS).lean();
  if (!user) throw ApiError.notFound('User not found');
  return toAdminUser(user);
}

/**
 * Creates an account with the given role. The password is hashed by the model's save hook;
 * a duplicate email becomes 409 in the error handler.
 *
 * @param {{ name: string, email: string, password: string, role: string, interests?: string[] }} input - Validated body.
 * @returns {Promise<object>} The new user (serialized without secrets).
 */
export async function createUser({ name, email, password, role, interests = [] }) {
  const user = await new User({ name, email, password, role, interests }).save();
  return user.toJSON();
}

/**
 * Updates another account (or the admin's own, except its role). Setting a password signs the
 * user out everywhere (tokenVersion is bumped), so a leaked session cannot outlive the change.
 *
 * @param {{ _id: import('mongoose').Types.ObjectId }} actor - The admin making the change.
 * @param {string} id - Validated ObjectId string of the user to change.
 * @param {{ name?: string, email?: string, role?: string, interests?: string[], password?: string }} input - Validated body.
 * @returns {Promise<object>} The updated user.
 * @throws {ApiError} 403 when an admin changes their own role; 404 if the user does not exist.
 */
export async function updateUser(actor, id, input) {
  const user = await User.findById(id).select('+tokenVersion');
  if (!user) throw ApiError.notFound('User not found');
  const isSelf = user._id.equals(actor._id);
  if (isSelf && input.role !== undefined && input.role !== user.role) {
    throw ApiError.forbidden("You can't change your own role", 'SELF_ROLE_CHANGE');
  }
  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) user[field] = input[field];
  }
  if (input.password !== undefined) {
    user.password = input.password;
    user.tokenVersion += 1;
  }
  await user.save();
  return user.toJSON();
}

/**
 * Deletes an account and everything that belongs to it: its notes and posts (and their images),
 * its profile photo, and its place on other people's shared notes. Every query is on an indexed
 * field (_id, owner, collaborators, author).
 *
 * @param {{ _id: import('mongoose').Types.ObjectId }} actor - The admin deleting.
 * @param {string} id - Validated ObjectId string.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 when an admin deletes their own account; 404 if the user does not exist.
 */
export async function deleteUser(actor, id) {
  if (actor._id.equals(id)) throw ApiError.forbidden("You can't delete your own account", 'SELF_DELETE');
  const user = await User.findByIdAndDelete(id).lean();
  if (!user) throw ApiError.notFound('User not found');

  const [owned, posts] = await Promise.all([
    Note.find({ owner: user._id }, { images: 1 }).lean(),
    Post.find({ author: user._id }, { images: 1 }).lean(),
  ]);
  await Promise.all([
    Note.deleteMany({ owner: user._id }),
    Note.updateMany({ collaborators: user._id }, { $pull: { collaborators: user._id } }),
    Post.deleteMany({ author: user._id }),
  ]);
  const files = [...owned, ...posts].flatMap((doc) => (doc.images ?? []).map((image) => image.publicId));
  if (user.avatar?.publicId) files.push(user.avatar.publicId);
  await deleteImages(files);
}

/**
 * Every note (read-only for admins), newest first, optionally one owner's. Without an owner
 * the _id index gives the order and the total comes from collection metadata; with an owner
 * the { owner: 1, _id: -1 } index serves both.
 *
 * @param {import('mongoose').Types.ObjectId} adminId - The admin reading.
 * @param {{ page: number, limit: number, owner?: string }} query - Validated query.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response with people attached.
 */
export async function listAllNotes(adminId, { page, limit, owner }) {
  const filter = owner ? { owner } : {};
  const { skip } = getPagination({ page, limit });
  const [notes, total] = await Promise.all([
    Note.find(filter).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    owner ? Note.countDocuments(filter) : Note.estimatedDocumentCount(),
  ]);
  return buildListResponse(await attachPeople(notes, adminId), { page, limit, total });
}
