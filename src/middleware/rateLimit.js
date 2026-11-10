/**
 * Rate limiters for sensitive endpoints.
 */
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

/**
 * Limits POST /api/auth/login to 10 attempts per IP per 15 minutes to slow down
 * password guessing. Exceeding it returns a 429 in the standard error shape.
 *
 * @type {import('express').RequestHandler}
 */
export const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_ATTEMPTS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) =>
    next(ApiError.tooManyRequests('Too many login attempts, please try again later', 'RATE_LIMITED')),
});
