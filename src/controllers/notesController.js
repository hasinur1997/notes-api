/**
 * Handlers for /api/notes. Requests are already authenticated and validated by the route;
 * these handlers only call the note service and shape the response.
 */
import * as noteService from '../services/noteService.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteImages, uploadImage } from '../utils/imageStorage.js';

const NOTE_NOT_FOUND = 'Note not found';

/**
 * GET /api/notes: a page of notes the user owns or collaborates on, newest first, optionally filtered.
 *
 * @param {import('express').Request} req - Query: page, limit, pinned?, label?, q?, reminder?.
 * @param {import('express').Response} res - 200 `{ data, meta }`.
 * @returns {Promise<void>}
 */
export async function listNotes(req, res) {
  res.json(await noteService.listNotes(req.user._id, req.query));
}

/**
 * GET /api/notes/summary: totals and label counts for the sidebar.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res - 200 `{ totalNotes, reminders, labels: [{ name, count }] }`.
 * @returns {Promise<void>}
 */
export async function getSummary(req, res) {
  res.json(await noteService.getNotesSummary(req.user._id));
}

/**
 * GET /api/notes/:id: one note (owner or collaborator; any note for admins).
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 200 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not visible to the user.
 */
export async function getNote(req, res) {
  const note = await noteService.findNote(req.params.id, req.user);
  if (!note) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.json({ note });
}

/**
 * POST /api/notes: creates a note owned by the user.
 *
 * @param {import('express').Request} req - Body: title, content?, labels?, pinned?, color?, reminderAt?.
 * @param {import('express').Response} res - 201 `{ note }`.
 * @returns {Promise<void>}
 */
export async function createNote(req, res) {
  const note = await noteService.createNote(req.user._id, req.body);
  res.status(201).json({ note });
}

/**
 * POST /api/notes/:id/copy: copies a visible note into a new note owned by the user.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 201 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if the original is not visible.
 */
export async function copyNote(req, res) {
  const note = await noteService.copyNote(req.params.id, req.user._id);
  if (!note) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.status(201).json({ note });
}

/**
 * PATCH /api/notes/:id: updates a note the user owns or collaborates on.
 *
 * @param {import('express').Request} req - Params: id. Body: any editable field.
 * @param {import('express').Response} res - 200 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not accessible.
 */
export async function updateNote(req, res) {
  const note = await noteService.updateNote(req.params.id, req.user._id, req.body);
  if (!note) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.json({ note });
}

/**
 * DELETE /api/notes/:id: deletes the user's own note and its stored images.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 204 with no body.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not owned (collaborators cannot delete).
 */
export async function deleteNote(req, res) {
  const deleted = await noteService.deleteNote(req.params.id, req.user._id);
  if (!deleted) throw ApiError.notFound(NOTE_NOT_FOUND);
  await deleteImages(deleted.images.map((image) => image.publicId));
  res.status(204).end();
}

/**
 * PATCH /api/notes/labels/:name: renames a label on every note the user can see.
 *
 * @param {import('express').Request} req - Params: name. Body: { name } (the new name).
 * @param {import('express').Response} res - 200 `{ label, notesUpdated }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if no note has the label.
 */
export async function renameLabel(req, res) {
  const notesUpdated = await noteService.renameLabel(req.user._id, req.params.name, req.body.name);
  if (!notesUpdated) throw ApiError.notFound('Label not found');
  res.json({ label: req.body.name, notesUpdated });
}

/**
 * DELETE /api/notes/labels/:name: removes a label from every note the user can see.
 *
 * @param {import('express').Request} req - Params: name.
 * @param {import('express').Response} res - 204 with no body.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if no note has the label.
 */
export async function deleteLabel(req, res) {
  const notesUpdated = await noteService.deleteLabel(req.user._id, req.params.name);
  if (!notesUpdated) throw ApiError.notFound('Label not found');
  res.status(204).end();
}

/**
 * POST /api/notes/:id/collaborators: shares the user's own note with another account by email.
 *
 * @param {import('express').Request} req - Params: id. Body: { email }.
 * @param {import('express').Response} res - 200 `{ note }`.
 * @returns {Promise<void>}
 */
export async function addCollaborator(req, res) {
  res.json({ note: await noteService.addCollaborator(req.params.id, req.user._id, req.body.email) });
}

/**
 * DELETE /api/notes/:id/collaborators/:userId: the owner removes someone, or a collaborator leaves.
 *
 * @param {import('express').Request} req - Params: id, userId.
 * @param {import('express').Response} res - 204 with no body.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if the note is not found or the user may not remove that person.
 */
export async function removeCollaborator(req, res) {
  const removed = await noteService.removeCollaborator(req.params.id, req.user._id, req.params.userId);
  if (!removed) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.status(204).end();
}

/**
 * POST /api/notes/:id/images: attaches one uploaded image (multipart field `image`).
 *
 * @param {import('express').Request} req - Params: id. File: image (validated by the upload middleware).
 * @param {import('express').Response} res - 201 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 if no file was sent or the limit is reached; 404 if not accessible; 503 if uploads are disabled.
 */
export async function addImage(req, res) {
  if (!req.file) throw ApiError.badRequest('Send one image in the "image" field', 'INVALID_UPLOAD');
  const note = await noteService.addImage(req.params.id, req.user._id, () =>
    uploadImage(req.file.buffer, `notes/${req.user._id}`),
  );
  res.status(201).json({ note });
}

/**
 * DELETE /api/notes/:id/images/:imageId: removes an image from the note and from storage.
 *
 * @param {import('express').Request} req - Params: id, imageId.
 * @param {import('express').Response} res - 200 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if the note or image is not found.
 */
export async function removeImage(req, res) {
  const result = await noteService.removeImage(req.params.id, req.user._id, req.params.imageId);
  if (!result) throw ApiError.notFound('Image not found');
  await deleteImages([result.removed.publicId]);
  res.json({ note: result.note });
}
