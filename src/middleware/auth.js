import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyToken } from '../utils/token.js';

/**
 * Requires a valid `Authorization: Bearer <jwt>` header.
 * Loads the user from the database on every request, so deleted users and role
 * changes take effect immediately (the role in the token is never trusted).
 */
export async function auth(req, res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
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

  const user = await User.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized('User no longer exists', 'USER_NOT_FOUND');
  }

  req.user = user;
  next();
}
