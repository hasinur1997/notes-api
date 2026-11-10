/**
 * Handlers for /api/notes. Requests are already authenticated and validated by the route;
 * these handlers only call the note service and shape the response.
 */
import * as noteService from '../services/noteService.js';
import { ApiError } from '../utils/ApiError.js';

const NOTE_NOT_FOUND = 'Note not found';

/**
 * GET /api/notes: a page of the user's notes, newest first, optionally filtered.
 *
 * @param {import('express').Request} req - Query: page, limit, pinned?, label?, q?.
 * @param {import('express').Response} res - 200 `{ data, meta }`.
 * @returns {Promise<void>}
 */
export async function listNotes(req, res) {
  res.json(await noteService.listNotes(req.user._id, req.query));
}

/**
 * GET /api/notes/summary: total note count and label counts for the sidebar.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res - 200 `{ totalNotes, labels: [{ name, count }] }`.
 * @returns {Promise<void>}
 */
export async function getSummary(req, res) {
  res.json(await noteService.getNotesSummary(req.user._id));
}

/**
 * GET /api/notes/:id: one note (owner, or any note for admins).
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
 * POST /api/notes: creates a note for the user.
 *
 * @param {import('express').Request} req - Body: title, content?, labels?, pinned?.
 * @param {import('express').Response} res - 201 `{ note }`.
 * @returns {Promise<void>}
 */
export async function createNote(req, res) {
  const note = await noteService.createNote(req.user._id, req.body);
  res.status(201).json({ note });
}

/**
 * PATCH /api/notes/:id: updates the user's own note.
 *
 * @param {import('express').Request} req - Params: id. Body: any of title, content, labels, pinned.
 * @param {import('express').Response} res - 200 `{ note }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not owned.
 */
export async function updateNote(req, res) {
  const note = await noteService.updateNote(req.params.id, req.user._id, req.body);
  if (!note) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.json({ note });
}

/**
 * DELETE /api/notes/:id: deletes the user's own note.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 204 with no body.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not owned.
 */
export async function deleteNote(req, res) {
  const deleted = await noteService.deleteNote(req.params.id, req.user._id);
  if (!deleted) throw ApiError.notFound(NOTE_NOT_FOUND);
  res.status(204).end();
}

/**
 * PATCH /api/notes/labels/:name: renames a label on all of the user's notes.
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
 * DELETE /api/notes/labels/:name: removes a label from all of the user's notes.
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
