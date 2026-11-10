/**
 * Authentication middleware.
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyToken } from '../utils/token.js';

/**
 * Extracts the token from an `Authorization: Bearer <jwt>` header.
 *
 * @param {string | undefined} header - Raw Authorization header value.
 * @returns {string | null} The token, or null if the header is missing or not a Bearer header.
 */
export function getBearerToken(header) {
  const [scheme, token] = (header ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Requires a valid access token and attaches the current user as `req.user`.
 * The user is loaded from the database on every request (by `_id`, which is always indexed),
 * so deleted users and role changes take effect immediately: the role in the token is never trusted.
 * `req.user` is a full document (not lean) so its `toJSON` transform hides the password if it is returned.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 * @throws {ApiError} 401 with code NO_TOKEN, TOKEN_EXPIRED, INVALID_TOKEN, USER_NOT_FOUND or TOKEN_REVOKED.
 */
export async function auth(req, res, next) {
  const token = getBearerToken(req.get('authorization'));
  if (!token) {
    throw ApiError.unauthorized('Authentication required', 'NO_TOKEN');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Session expired, please sign in again', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }

  if (!mongoose.isValidObjectId(payload.sub)) {
    throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user) {
    throw ApiError.unauthorized('User no longer exists', 'USER_NOT_FOUND');
  }
  // A password reset increments tokenVersion, signing out every session that started before it.
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw ApiError.unauthorized('Your password was changed. Please sign in again.', 'TOKEN_REVOKED');
  }

  req.user = user;
  next();
}
