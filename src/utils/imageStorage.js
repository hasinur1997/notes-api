/**
 * Image storage for note images. Two interchangeable backends:
 *
 * - Cloudinary, when CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET are set (recommended in
 *   production: a CDN, and files survive redeploys).
 * - The API server's own disk otherwise (UPLOAD_DIR, default ./uploads), served at /uploads.
 *   Note: on hosts with an ephemeral disk (e.g. Render free), these files are lost on redeploy.
 *
 * Every upload is first checked with detectImage(), so only real PNG, JPEG, GIF or WebP files
 * are stored, whatever name or MIME type the client sent.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { detectImage } from './imageInfo.js';

/** URL path where locally stored images are served (see app.js). */
export const UPLOADS_ROUTE = '/uploads';
/** Prefix marking a publicId as a local file rather than a Cloudinary id. */
const LOCAL_PREFIX = 'local:';

const useCloudinary = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

/** Absolute directory for locally stored images. */
export const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * Which backend stores new images.
 *
 * @returns {'cloudinary' | 'local'} Storage backend in use.
 */
export function imageStorageKind() {
  return useCloudinary ? 'cloudinary' : 'local';
}

/** Uploads to Cloudinary and returns the stored image. */
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', overwrite: false },
      (error, result) => {
        if (error) return reject(new ApiError(502, 'The image could not be stored. Please try again.', 'STORAGE_FAILED'));
        return resolve({ url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height });
      },
    );
    stream.end(buffer);
  });
}

/**
 * Resolves a stored relative path inside UPLOAD_DIR, refusing anything that escapes it.
 *
 * @param {string} relativePath - e.g. "notes/<userId>/<file>.png".
 * @returns {string} Absolute path inside UPLOAD_DIR.
 * @throws {Error} If the path would leave UPLOAD_DIR.
 */
function safeLocalPath(relativePath) {
  const absolute = path.resolve(UPLOAD_DIR, relativePath);
  if (!absolute.startsWith(UPLOAD_DIR + path.sep)) throw new Error('Invalid image path');
  return absolute;
}

/** Writes the file under UPLOAD_DIR with a random name and returns the stored image. */
async function uploadToDisk(buffer, folder, image) {
  const fileName = `${randomBytes(16).toString('hex')}.${image.ext}`;
  const relativePath = path.posix.join(folder, fileName);
  const absolute = safeLocalPath(relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer, { flag: 'wx' });
  return {
    // Relative URL: the client prefixes the API origin, so stored notes survive a domain change.
    url: `${UPLOADS_ROUTE}/${relativePath}`,
    publicId: `${LOCAL_PREFIX}${relativePath}`,
    width: image.width,
    height: image.height,
  };
}

/**
 * Validates and stores an image.
 *
 * @param {Buffer} buffer - File contents from the upload middleware.
 * @param {string} folder - Destination folder, e.g. `notes/<userId>`.
 * @returns {Promise<{ url: string, publicId: string, width: number, height: number }>} Stored image details.
 * @throws {ApiError} 400 if the bytes are not a supported image; 502 if Cloudinary fails.
 */
export async function uploadImage(buffer, folder) {
  const image = detectImage(buffer);
  if (!image) throw ApiError.badRequest('This file is not a valid JPEG, PNG, WebP or GIF image', 'INVALID_IMAGE');
  return useCloudinary ? uploadToCloudinary(buffer, folder) : uploadToDisk(buffer, folder, image);
}

/** Deletes one stored image from whichever backend holds it. */
function deleteOne(publicId) {
  if (publicId.startsWith(LOCAL_PREFIX)) {
    return unlink(safeLocalPath(publicId.slice(LOCAL_PREFIX.length))).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
  // Images uploaded to Cloudinary earlier can only be removed while Cloudinary is configured.
  return useCloudinary ? cloudinary.uploader.destroy(publicId) : Promise.resolve();
}

/**
 * Deletes stored images. Best effort: failures are logged, never thrown, so removing a note
 * or an image from a note always succeeds even if storage is briefly unavailable.
 *
 * @param {string[]} publicIds - Ids returned by uploadImage.
 * @returns {Promise<void>}
 */
export async function deleteImages(publicIds) {
  if (!publicIds.length) return;
  const results = await Promise.allSettled(publicIds.map(deleteOne));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) console.error(`Could not delete ${failed} image(s) from storage`);
}
