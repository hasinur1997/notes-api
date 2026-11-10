import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    return new ApiError(400, message, 'VALIDATION_ERROR');
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

  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue ?? err.keyPattern ?? {})[0] ?? 'field';
    return new ApiError(409, `A record with this ${field} already exists`, 'DUPLICATE_KEY');
  }

  // Errors raised by express.json() (body-parser)
  if (err?.type === 'entity.parse.failed') {
    return new ApiError(400, 'Malformed JSON body', 'INVALID_JSON');
  }
  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', 'PAYLOAD_TOO_LARGE');
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const known = normalize(err);
  const status = known?.status ?? 500;

  if (status >= 500) console.error(err);

  const error = {
    message: known?.message ?? 'Internal server error',
    code: known?.code ?? 'INTERNAL_ERROR',
  };

  if (!env.isProduction && !known && err?.stack) error.stack = err.stack;

  res.status(status).json({ error });
}
