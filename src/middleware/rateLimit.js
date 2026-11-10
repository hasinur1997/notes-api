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
