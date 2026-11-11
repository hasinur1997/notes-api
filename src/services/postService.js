/**
 * Posts business logic. Posts are public: anyone can read them, only the author can change them.
 * Author-only actions put `{ _id, author }` in the query, so a post that is missing and one that
 * belongs to someone else look the same (404).
 */
import mongoose from 'mongoose';
import { MAX_IMAGES_PER_POST, Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { buildListResponse, getPagination } from '../utils/pagination.js';

/** Fields the author may set. Author, images and timestamps are set by the server. */
const EDITABLE_FIELDS = ['title', 'content', 'color'];
const POST_NOT_FOUND = 'Post not found';

/** Copies only whitelisted fields that are present in `input`. */
function pickEditable(input) {
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

/**
 * The public face of a person: name and photo (no email, storage ids or anything private).
 *
 * @param {{ _id: unknown, name: string, avatar?: { url: string, width: number, height: number } | null }} [user]
 * @returns {{ _id: unknown, name: string, avatar: { url: string, width: number, height: number } | null }}
 */
export function toPublicAuthor(user) {
  if (!user) return { _id: null, name: 'Unknown user', avatar: null };
  const { avatar } = user;
  return { _id: user._id, name: user.name, avatar: avatar ? { url: avatar.url, width: avatar.width, height: avatar.height } : null };
}

/** Removes the storage id from each image (only the URL and size are public). */
function publicImages(images = []) {
  return images.map(({ _id, url, width, height }) => ({ _id, url, width, height }));
}

/**
 * Shapes a lean post for responses with its author attached.
 *
 * @param {object} post - Lean post (author may be an id or an already looked-up person).
 * @param {object} author - The author as a user document or lookup result.
 * @returns {object} Public post.
 */
export function toPublicPost(post, author) {
  return {
    _id: post._id,
    title: post.title,
    content: post.content ?? '',
    color: post.color ?? 'default',
    images: publicImages(post.images),
    author: toPublicAuthor(author),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

/** $lookup that attaches the author's public fields (served by the users _id index). */
const AUTHOR_LOOKUP = {
  $lookup: {
    from: 'users',
    localField: 'author',
    foreignField: '_id',
    pipeline: [{ $project: { name: 1, avatar: 1 } }],
    as: 'authorDoc',
  },
};

/**
 * Builds the public feed pipeline: newest first by _id (the _id index, no in-memory sort),
 * one page, each post with its author attached.
 *
 * @param {{ skip: number, limit: number }} paging - Values from getPagination.
 * @returns {object[]} Aggregation pipeline on posts.
 */
export function buildFeedPipeline({ skip, limit }) {
  return [{ $sort: { _id: -1 } }, { $skip: skip }, { $limit: limit }, AUTHOR_LOOKUP];
}

/**
 * The public feed: every post, newest first. The total comes from collection metadata (no scan).
 *
 * @param {{ page: number, limit: number }} query - Validated pagination.
 * @returns {Promise<{ data: object[], meta: object }>} Standard list response.
 */
export async function listPosts({ page, limit }) {
  const { skip } = getPagination({ page, limit });
  const [posts, total] = await Promise.all([
    Post.aggregate(buildFeedPipeline({ skip, limit })),
    Post.estimatedDocumentCount(),
  ]);
  return buildListResponse(
    posts.map((post) => toPublicPost(post, post.authorDoc[0])),
    { page, limit, total },
  );
}

/**
 * One post with its author, in one aggregate (_id index, then the users _id index).
 *
 * @param {string} postId - Validated ObjectId string.
 * @returns {Promise<object>} The public post.
 * @throws {ApiError} 404 if there is no such post.
 */
export async function getPost(postId) {
  const [post] = await Post.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(postId) } }, AUTHOR_LOOKUP]);
  if (!post) throw ApiError.notFound(POST_NOT_FOUND);
  return toPublicPost(post, post.authorDoc[0]);
}

/**
 * Scenario 2: one user's public profile and a page of their posts, in ONE pipeline on users.
 * $match on _id (the _id index), public fields only, then two $lookup stages into posts on
 * `author`: one page of posts newest first, and their count. Both lookups use the
 * { author: 1, _id: -1 } index, which also gives the order (no in-memory sort).
 *
 * @param {string} userId - Validated ObjectId string.
 * @param {{ skip: number, limit: number }} paging - Values from getPagination.
 * @returns {object[]} Aggregation pipeline on users.
 */
export function buildUserPostsPipeline(userId, { skip, limit }) {
  const byAuthor = { from: 'posts', localField: '_id', foreignField: 'author' };
  return [
    { $match: { _id: new mongoose.Types.ObjectId(userId) } },
    { $project: { name: 1, interests: 1, avatar: 1, createdAt: 1 } },
    { $lookup: { ...byAuthor, pipeline: [{ $sort: { _id: -1 } }, { $skip: skip }, { $limit: limit }], as: 'posts' } },
    { $lookup: { ...byAuthor, pipeline: [{ $count: 'total' }], as: 'postCount' } },
  ];
}

/**
 * Runs the Scenario 2 pipeline and shapes it into `{ user, data, meta }` (no extra DB call).
 *
 * @param {string} userId - Validated ObjectId string.
 * @param {{ page: number, limit: number }} query - Validated pagination.
 * @returns {Promise<{ user: object, data: object[], meta: object }>} The user and a standard list.
 * @throws {ApiError} 404 if there is no such user.
 */
export async function listUserPosts(userId, { page, limit }) {
  const { skip } = getPagination({ page, limit });
  const [result] = await User.aggregate(buildUserPostsPipeline(userId, { skip, limit }));
  if (!result) throw ApiError.notFound('User not found');
  const { posts, postCount, ...user } = result;
  const author = toPublicAuthor(user);
  const total = postCount[0]?.total ?? 0;
  return {
    user: { ...author, interests: user.interests ?? [], createdAt: user.createdAt },
    ...buildListResponse(posts.map((post) => toPublicPost(post, user)), { page, limit, total }),
  };
}

/**
 * Creates a post by the user.
 *
 * @param {object} user - The authenticated user (becomes the author).
 * @param {{ title: string, content?: string, color?: string }} input - Validated body.
 * @returns {Promise<object>} The public post.
 */
export async function createPost(user, input) {
  const post = await Post.create({ ...pickEditable(input), author: user._id });
  return toPublicPost(post.toObject(), user);
}

/**
 * Updates the user's own post.
 *
 * @param {string} postId - Validated ObjectId string.
 * @param {object} user - The authenticated user.
 * @param {object} input - Validated body with at least one editable field.
 * @returns {Promise<object>} The updated public post.
 * @throws {ApiError} 404 if missing or not the user's.
 */
export async function updatePost(postId, user, input) {
  const post = await Post.findOneAndUpdate(
    { _id: postId, author: user._id },
    { $set: pickEditable(input) },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!post) throw ApiError.notFound(POST_NOT_FOUND);
  return toPublicPost(post, user);
}

/**
 * Deletes the user's own post.
 *
 * @param {string} postId - Validated ObjectId string.
 * @param {object} user - The authenticated user.
 * @returns {Promise<object>} The deleted post (so its images can be removed).
 * @throws {ApiError} 404 if missing or not the user's.
 */
export async function deletePost(postId, user) {
  const post = await Post.findOneAndDelete({ _id: postId, author: user._id }).lean();
  if (!post) throw ApiError.notFound(POST_NOT_FOUND);
  return post;
}

/**
 * Adds an uploaded image to the user's own post.
 *
 * @param {string} postId - Validated ObjectId string.
 * @param {object} user - The authenticated user.
 * @param {() => Promise<{ url: string, publicId: string, width: number, height: number }>} upload - Stores the file, called only after access and limit checks pass.
 * @returns {Promise<object>} The updated public post.
 * @throws {ApiError} 404 if missing or not the user's; 400 if the post already has the maximum number of images.
 */
export async function addImage(postId, user, upload) {
  const filter = { _id: postId, author: user._id };
  const post = await Post.findOne(filter, { images: 1 }).lean();
  if (!post) throw ApiError.notFound(POST_NOT_FOUND);
  if ((post.images ?? []).length >= MAX_IMAGES_PER_POST) {
    throw ApiError.badRequest(`A post can have at most ${MAX_IMAGES_PER_POST} images`, 'LIMIT_REACHED');
  }
  const image = await upload();
  const updated = await Post.findOneAndUpdate(filter, { $push: { images: image } }, { returnDocument: 'after' }).lean();
  if (!updated) throw ApiError.notFound(POST_NOT_FOUND);
  return toPublicPost(updated, user);
}

/**
 * Removes one image from the user's own post.
 *
 * @param {string} postId - Validated ObjectId string.
 * @param {object} user - The authenticated user.
 * @param {string} imageId - Validated ObjectId string of the image.
 * @returns {Promise<{ post: object, removed: { publicId: string } }>} Updated post and the removed image (to delete).
 * @throws {ApiError} 404 if the post or image is missing or not the user's.
 */
export async function removeImage(postId, user, imageId) {
  const before = await Post.findOneAndUpdate(
    { _id: postId, author: user._id, 'images._id': imageId },
    { $pull: { images: { _id: imageId } } },
    { returnDocument: 'before' },
  ).lean();
  if (!before) throw ApiError.notFound('Image not found');
  const removed = before.images.find((image) => String(image._id) === imageId);
  const after = { ...before, images: before.images.filter((image) => String(image._id) !== imageId) };
  return { post: toPublicPost(after, user), removed };
}

/**
 * Replaces one image of the user's own post, keeping its position (used after cropping).
 *
 * @param {string} postId - Validated ObjectId string.
 * @param {object} user - The authenticated user.
 * @param {string} imageId - Validated ObjectId string of the image to replace.
 * @param {() => Promise<{ url: string, publicId: string, width: number, height: number }>} upload - Stores the new file, called only after access checks pass.
 * @returns {Promise<{ post: object, replaced: { publicId: string } }>} Updated post and the old image (to delete).
 * @throws {ApiError} 404 if the post or image is missing or not the user's.
 */
export async function replaceImage(postId, user, imageId, upload) {
  const filter = { _id: postId, author: user._id, 'images._id': imageId };
  const before = await Post.findOne(filter, { images: 1 }).lean();
  const replaced = (before?.images ?? []).find((image) => String(image._id) === imageId);
  if (!replaced) throw ApiError.notFound('Image not found');

  const image = await upload();
  const updated = await Post.findOneAndUpdate(filter, { $set: { 'images.$': image } }, { returnDocument: 'after' }).lean();
  if (!updated) throw ApiError.notFound('Image not found');
  return { post: toPublicPost(updated, user), replaced };
}
