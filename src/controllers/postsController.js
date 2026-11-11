/**
 * Handlers for /api/posts and GET /api/users/:id/posts. Requests are validated (and, where
 * needed, authenticated) by the router; these handlers call the post service and respond.
 */
import * as postService from '../services/postService.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteImages, uploadImage } from '../utils/imageStorage.js';

const NO_FILE = 'Send one image in the "image" field';

/** Storage folder for a user's post images. */
const postFolder = (user) => `posts/${user._id}`;

/**
 * GET /api/posts: the public feed, newest first.
 *
 * @param {import('express').Request} req - Query: page, limit.
 * @param {import('express').Response} res - 200 `{ data, meta }`.
 * @returns {Promise<void>}
 */
export async function listPosts(req, res) {
  res.json(await postService.listPosts(req.query));
}

/**
 * GET /api/posts/:id: one public post.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 200 `{ post }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing.
 */
export async function getPost(req, res) {
  res.json({ post: await postService.getPost(req.params.id) });
}

/**
 * GET /api/users/:id/posts: a user's public profile and posts (Scenario 2, one pipeline).
 *
 * @param {import('express').Request} req - Params: id. Query: page, limit.
 * @param {import('express').Response} res - 200 `{ user, data, meta }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if the user does not exist.
 */
export async function listUserPosts(req, res) {
  res.json(await postService.listUserPosts(req.params.id, req.query));
}

/**
 * POST /api/posts: publishes a post by the signed-in user.
 *
 * @param {import('express').Request} req - Body: { title, content?, color? }.
 * @param {import('express').Response} res - 201 `{ post }`.
 * @returns {Promise<void>}
 */
export async function createPost(req, res) {
  res.status(201).json({ post: await postService.createPost(req.user, req.body) });
}

/**
 * PATCH /api/posts/:id: edits the signed-in user's own post.
 *
 * @param {import('express').Request} req - Params: id. Body: any of { title, content, color }.
 * @param {import('express').Response} res - 200 `{ post }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not the user's.
 */
export async function updatePost(req, res) {
  res.json({ post: await postService.updatePost(req.params.id, req.user, req.body) });
}

/**
 * DELETE /api/posts/:id: deletes the signed-in user's own post and its images.
 *
 * @param {import('express').Request} req - Params: id.
 * @param {import('express').Response} res - 204.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if missing or not the user's.
 */
export async function deletePost(req, res) {
  const deleted = await postService.deletePost(req.params.id, req.user);
  await deleteImages((deleted.images ?? []).map((image) => image.publicId));
  res.status(204).end();
}

/**
 * POST /api/posts/:id/images: adds an image to the user's own post.
 *
 * @param {import('express').Request} req - Params: id. Multipart field `image`.
 * @param {import('express').Response} res - 201 `{ post }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 without a file or at the image limit; 404 if not the user's.
 */
export async function addImage(req, res) {
  if (!req.file) throw ApiError.badRequest(NO_FILE, 'INVALID_UPLOAD');
  const post = await postService.addImage(req.params.id, req.user, () => uploadImage(req.file.buffer, postFolder(req.user)));
  res.status(201).json({ post });
}

/**
 * PUT /api/posts/:id/images/:imageId: replaces an image in place (after cropping).
 *
 * @param {import('express').Request} req - Params: id, imageId. Multipart field `image`.
 * @param {import('express').Response} res - 200 `{ post }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 without a file; 404 if the post or image is not the user's.
 */
export async function replaceImage(req, res) {
  if (!req.file) throw ApiError.badRequest(NO_FILE, 'INVALID_UPLOAD');
  const { post, replaced } = await postService.replaceImage(req.params.id, req.user, req.params.imageId, () =>
    uploadImage(req.file.buffer, postFolder(req.user)),
  );
  await deleteImages([replaced.publicId]);
  res.json({ post });
}

/**
 * DELETE /api/posts/:id/images/:imageId: removes an image from the user's own post.
 *
 * @param {import('express').Request} req - Params: id, imageId.
 * @param {import('express').Response} res - 200 `{ post }`.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 if the post or image is not the user's.
 */
export async function removeImage(req, res) {
  const { post, removed } = await postService.removeImage(req.params.id, req.user, req.params.imageId);
  await deleteImages([removed.publicId]);
  res.json({ post });
}
