/**
 * Handlers for /api/auth. Request bodies are already validated by the route.
 */
import bcrypt from 'bcrypt';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/token.js';
import { requestPasswordReset, resetPassword as applyPasswordReset } from '../services/passwordReset.js';

// Compared against when the email is unknown, so login takes the same time either way
// and response timing does not reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder', 12);

/**
 * POST /api/auth/register: creates an account and signs the user in.
 * The role is never taken from the request; new accounts are always `user`.
 *
 * @param {import('express').Request} req - Body: `{ name, email, password, interests? }`.
 * @param {import('express').Response} res - 201 `{ token, user }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 (via the error handler) if the email is already registered.
 */
export async function register(req, res) {
  const { name, email, password, interests } = req.body;

  const user = await User.create({ name, email, password, interests, role: 'user' });

  res.status(201).json({ token: signToken(user), user });
}

/**
 * POST /api/auth/login: exchanges email and password for an access token.
 * Unknown email and wrong password return the same 401 so accounts cannot be enumerated.
 *
 * @param {import('express').Request} req - Body: `{ email, password }`.
 * @param {import('express').Response} res - 200 `{ token, user }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 INVALID_CREDENTIALS.
 */
export async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +tokenVersion');
  const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

  if (!user || !valid) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  res.json({ token: signToken(user), user });
}

/**
 * GET /api/auth/me: returns the authenticated user (set by the `auth` middleware).
 *
 * @param {import('express').Request} req - `req.user` is the current user.
 * @param {import('express').Response} res - 200 `{ user }`.
 * @returns {void}
 */
export function me(req, res) {
  res.json({ user: req.user });
}

/** Response for every forgot-password request, so it never reveals whether an account exists. */
const RESET_REQUESTED_MESSAGE = "If an account exists for that email, we've sent a link to reset the password.";

/**
 * POST /api/auth/forgot-password: emails a reset link if the account exists.
 * The work runs in the background and the response is always the same, so neither the
 * message nor the response time reveals whether the email is registered.
 *
 * @param {import('express').Request} req - Body: { email }.
 * @param {import('express').Response} res - 200 `{ message }`.
 * @returns {void}
 */
export function forgotPassword(req, res) {
  requestPasswordReset(req.body.email).catch((err) => console.error('Password reset email failed:', err.message));
  res.json({ message: RESET_REQUESTED_MESSAGE });
}

/**
 * POST /api/auth/reset-password: sets a new password with the token from the emailed link.
 *
 * @param {import('express').Request} req - Body: { email, token, password }.
 * @param {import('express').Response} res - 200 `{ message }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 INVALID_RESET_TOKEN if the link is wrong, used or expired.
 */
export async function resetPassword(req, res) {
  await applyPasswordReset(req.body);
  res.json({ message: 'Your password has been changed. You can sign in now.' });
}
