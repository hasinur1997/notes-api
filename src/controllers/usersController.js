/**
 * Handlers for /api/users. Requests are already authenticated and validated by the route.
 */
import { ApiError } from '../utils/ApiError.js';
import { deleteImages, uploadImage } from '../utils/imageStorage.js';

/** Profile fields a user may change themselves. Everything else (email, role, password) is fixed here. */
const EDITABLE_PROFILE_FIELDS = ['name', 'interests'];
/** Settings a user may change (all of them; listed so nothing else can be written). */
const EDITABLE_SETTINGS = ['notesPagination', 'notesPerPage'];

/**
 * PATCH /api/users/me: updates the signed-in user's own name and/or interests.
 * Changes are applied to the user document loaded by `auth` and saved with save(), so the
 * schema setters (interests are trimmed, lowercased and de-duplicated) and validators run.
 *
 * @param {import('express').Request} req - Body: { name?, interests? }.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 */
export async function updateMe(req, res) {
  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (req.body[field] !== undefined) req.user[field] = req.body[field];
  }
  await req.user.save();
  res.json({ user: req.user });
}

/**
 * PATCH /api/users/me/settings: updates any of the signed-in user's settings. Only the listed
 * keys are copied (the body is already validated), then saved with save() so enums run again.
 *
 * @param {import('express').Request} req - Body: { notesPagination?, notesPerPage? }.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 */
export async function updateSettings(req, res) {
  for (const key of EDITABLE_SETTINGS) {
    if (req.body[key] !== undefined) req.user.settings[key] = req.body[key];
  }
  await req.user.save();
  res.json({ user: req.user });
}

/**
 * POST /api/users/me/avatar: sets the profile photo (multipart field `image`), replacing and
 * deleting the previous one. The file is verified as a real image by the storage layer.
 *
 * @param {import('express').Request} req - File: image.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 if no file or not a valid image.
 */
export async function uploadAvatar(req, res) {
  if (!req.file) throw ApiError.badRequest('Send one image in the "image" field', 'INVALID_UPLOAD');
  const previous = req.user.avatar?.publicId;
  req.user.avatar = await uploadImage(req.file.buffer, `avatars/${req.user._id}`);
  await req.user.save();
  if (previous) await deleteImages([previous]);
  res.json({ user: req.user });
}

/**
 * DELETE /api/users/me/avatar: removes the profile photo (initials are shown instead).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 */
export async function removeAvatar(req, res) {
  const previous = req.user.avatar?.publicId;
  req.user.avatar = null;
  await req.user.save();
  if (previous) await deleteImages([previous]);
  res.json({ user: req.user });
}
