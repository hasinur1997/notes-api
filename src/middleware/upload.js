/**
 * Multipart upload handling for note images. Files are kept in memory (never written to disk)
 * and streamed to image storage by the controller.
 */
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';
import { isImageStorageConfigured } from '../utils/imageStorage.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const UPLOADS_PER_WINDOW = 30;

/**
 * Accepts one file in the `image` field: JPEG, PNG, WebP or GIF, at most 5 MB.
 * Rejected files never reach the controller.
 *
 * @type {import('express').RequestHandler}
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  fileFilter: (req, file, done) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return done(null, true);
    return done(ApiError.badRequest('Only JPEG, PNG, WebP or GIF images are allowed', 'INVALID_IMAGE'));
  },
}).single('image');

/**
 * Limits image uploads to 30 per IP per 15 minutes, to protect storage quota.
 *
 * @type {import('express').RequestHandler}
 */
export const uploadLimiter = rateLimit({
  windowMs: UPLOAD_WINDOW_MS,
  limit: UPLOADS_PER_WINDOW,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many uploads, please try again later', 'RATE_LIMITED')),
});

/**
 * Answers 503 before the upload is read when image storage is not configured.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function requireImageStorage(req, res, next) {
  if (!isImageStorageConfigured()) {
    return next(new ApiError(503, 'Image uploads are not configured on the server', 'UPLOADS_DISABLED'));
  }
  return next();
}
