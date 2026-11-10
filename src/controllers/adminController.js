/**
 * Handlers for /api/admin. Requests are authenticated, checked as admin and validated by the
 * router; these handlers call the admin service and send the response.
 */
import * as adminService from '../services/adminService.js';

/**
 * GET /api/admin/users: a page of users, or one user by exact email.
 *
 * @param {import('express').Request} req - Query: page, limit, email?.
 * @param {import('express').Response} res - 200 `{ data, meta }`.
 * @returns {Promise<void>}
 */
export async function listUsers(req, res) {
  res.json(await adminService.listUsers(req.query));
}

/**
 * POST /api/admin/users: creates an account with any role.
 *
 * @param {import('express').Request} req - Body: { name, email, password, role?, interests? }.
 * @param {import('express').Response} res - 201 `{ user }`; 409 if the email is taken.
 * @returns {Promise<void>}
 */
export async function createUser(req, res) {
  res.status(201).json({ user: await adminService.createUser(req.body) });
}

/**
 * GET /api/admin/users/:id: one user.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing.
 */
export async function getUser(req, res) {
  res.json({ user: await adminService.getUser(req.params.id) });
}

/**
 * PATCH /api/admin/users/:id: changes name, email, role, interests or password.
 *
 * @param {import('express').Request} req - Params: id. Body: any of { name, email, role, interests, password }.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 for an admin's own role; 404 if missing; 409 if the email is taken.
 */
export async function updateUser(req, res) {
  res.json({ user: await adminService.updateUser(req.user, req.params.id, req.body) });
}

/**
 * DELETE /api/admin/users/:id: deletes an account with its notes and images.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 204.
 * @returns {Promise<void>}
 * @throws {ApiError} 403 for the admin's own account; 404 if missing.
 */
export async function deleteUser(req, res) {
  await adminService.deleteUser(req.user, req.params.id);
  res.status(204).end();
}

/**
 * GET /api/admin/notes: every note, newest first, optionally one owner's (read-only).
 *
 * @param {import('express').Request} req - Query: page, limit, owner?.
 * @param {import('express').Response} res - 200 `{ data, meta }`.
 * @returns {Promise<void>}
 */
export async function listAllNotes(req, res) {
  res.json(await adminService.listAllNotes(req.user._id, req.query));
}
