import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

// Applied to POST /api/auth/login: 10 attempts per IP per 15 minutes.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) =>
    next(ApiError.tooManyRequests('Too many login attempts, please try again later', 'RATE_LIMITED')),
});
