/**
 * Turns every error into the standard `{ error: { message, code } }` response.
 */
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Catch-all for requests that matched no route. Mount after all routers.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives a 404 ApiError.
 * @returns {void}
 */
export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

/** Joins zod issues into one readable message, e.g. "email: Invalid email; password: Too short". */
function formatZodIssues(issues) {
  return issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

/**
 * Maps known error types to an ApiError. Unknown errors return null and become a generic 500,
 * so internal details never reach the client.
 *
 * @param {unknown} err - Anything thrown or passed to `next()`.
 * @returns {ApiError | null} Client-safe error, or null if the error is unexpected.
 */
export function toApiError(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ApiError(400, formatZodIssues(err.issues), 'VALIDATION_ERROR');
  }

  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(400, `Invalid ${err.path}`, 'INVALID_ID');
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join('; ');
    return new ApiError(400, message, 'VALIDATION_ERROR');
  }

  if (err?.code === MONGO_DUPLICATE_KEY) {
    const field = Object.keys(err.keyValue ?? err.keyPattern ?? {})[0] ?? 'field';
    return new ApiError(409, `A record with this ${field} already exists`, 'DUPLICATE_KEY');
  }

  // Errors raised by multer while reading an upload.
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new ApiError(413, 'Images must be 5 MB or smaller', 'PAYLOAD_TOO_LARGE');
    return new ApiError(400, 'Send one image in the "image" field', 'INVALID_UPLOAD');
  }

  // Errors raised by express.json() (body-parser).
  if (err?.type === 'entity.parse.failed') {
    return new ApiError(400, 'Malformed JSON body', 'INVALID_JSON');
  }
  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', 'PAYLOAD_TOO_LARGE');
  }

  return null;
}

/**
 * Express error middleware. Logs only unexpected errors and sends the standard error body.
 * Stack traces are included only outside production, and only for unexpected errors.
 *
 * @param {unknown} err - The error.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Unused, but required so Express treats this as error middleware.
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const known = toApiError(err);
  const status = known?.status ?? 500;

  // Only unexpected errors are logged; expected ApiErrors (including 503s) are normal responses.
  if (!known) console.error(err);

  const error = {
    message: known?.message ?? 'Internal server error',
    code: known?.code ?? 'INTERNAL_ERROR',
  };

  if (!env.isProduction && !known && err?.stack) error.stack = err.stack;

  res.status(status).json({ error });
}
