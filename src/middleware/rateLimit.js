/**
 * Rate limiters for sensitive endpoints.
 */
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
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

const RESET_WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits password reset requests (5) and reset attempts (10) per IP per 15 minutes,
 * to prevent email flooding and token guessing.
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: RESET_WINDOW_MS,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many reset requests, please try again later', 'RATE_LIMITED')),
});

/** See forgotPasswordLimiter. */
export const resetPasswordLimiter = rateLimit({
  windowMs: RESET_WINDOW_MS,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many attempts, please try again later', 'RATE_LIMITED')),
});

const REGISTER_WINDOW_MS = 60 * 60 * 1000;
/** Sign-ups allowed per IP per hour: plenty for a household or office, too few for a bot. */
export const REGISTER_MAX_PER_WINDOW = 10;

/**
 * Builds the limiter for POST /api/auth/register. Every sign-up hashes a password with bcrypt
 * (cost 12) and creates an account, so unlimited sign-ups could flood the users collection or
 * tie up the CPU. Exceeding the limit returns a 429 in the standard error shape.
 *
 * @param {{ skip?: (req: import('express').Request) => boolean }} [options] - `skip` turns the limit off for a request.
 * @returns {import('express').RequestHandler} Rate-limit middleware.
 */
export function createRegisterLimiter({ skip } = {}) {
  return rateLimit({
    windowMs: REGISTER_WINDOW_MS,
    limit: REGISTER_MAX_PER_WINDOW,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip,
    handler: (req, res, next) =>
      next(ApiError.tooManyRequests('Too many accounts created from this network, please try again later', 'RATE_LIMITED')),
  });
}

/**
 * Limits POST /api/auth/register to 10 sign-ups per IP per hour. Off in the test environment,
 * where the integration tests register many users from one address.
 *
 * @type {import('express').RequestHandler}
 */
export const registerLimiter = createRegisterLimiter({ skip: () => env.NODE_ENV === 'test' });
