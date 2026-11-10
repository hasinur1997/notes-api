/**
 * Image storage on Cloudinary. Uploads are optional: without the CLOUDINARY_* variables the
 * image endpoints answer 503 and the rest of the API works normally.
 */
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

const configured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

if (configured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * Whether image uploads are available.
 *
 * @returns {boolean} True when all Cloudinary credentials are set.
 */
export function isImageStorageConfigured() {
  return configured;
}

/**
 * Uploads an image buffer. Cloudinary re-validates that the file really is an image
 * (resource_type "image"), so a renamed non-image file is rejected even if its MIME type lied.
 *
 * @param {Buffer} buffer - File contents from the upload middleware.
 * @param {string} folder - Destination folder, e.g. `notes/<userId>`.
 * @returns {Promise<{ url: string, publicId: string, width: number, height: number }>} Stored image details.
 * @throws {ApiError} 503 if storage is not configured; 400 if Cloudinary rejects the file.
 */
export function uploadImage(buffer, folder) {
  if (!configured) throw new ApiError(503, 'Image uploads are not configured on the server', 'UPLOADS_DISABLED');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', overwrite: false },
      (error, result) => {
        if (error) return reject(ApiError.badRequest('The file could not be stored as an image', 'INVALID_IMAGE'));
        return resolve({ url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height });
      },
    );
    stream.end(buffer);
  });
}

/**
 * Deletes stored images. Best effort: failures are logged, never thrown, so removing a note
 * or an image from a note always succeeds even if the storage service is briefly unavailable.
 *
 * @param {string[]} publicIds - Cloudinary public ids.
 * @returns {Promise<void>}
 */
export async function deleteImages(publicIds) {
  if (!configured || !publicIds.length) return;
  const results = await Promise.allSettled(publicIds.map((id) => cloudinary.uploader.destroy(id)));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) console.error(`Could not delete ${failed} image(s) from storage`);
}
