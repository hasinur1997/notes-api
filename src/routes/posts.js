/**
 * /api/posts routes. Reading is public; writing requires authentication and only the author
 * may change a post (enforced inside each query).
 */
import { Router } from 'express';
import * as posts from '../controllers/postsController.js';
import { auth } from '../middleware/auth.js';
import { imageUpload, uploadLimiter } from '../middleware/upload.js';
import { idParams, validate } from '../middleware/validate.js';
import { createPostBody, listPostsQuery, postImageParams, updatePostBody } from '../validators/posts.js';

const router = Router();

router.get('/', validate({ query: listPostsQuery }), posts.listPosts);
router.post('/', auth, validate({ body: createPostBody }), posts.createPost);
router.get('/:id', validate({ params: idParams }), posts.getPost);
router.patch('/:id', auth, validate({ params: idParams, body: updatePostBody }), posts.updatePost);
router.delete('/:id', auth, validate({ params: idParams }), posts.deletePost);

// Params are validated before the upload is read, so invalid requests never buffer a file.
router.post('/:id/images', auth, uploadLimiter, validate({ params: idParams }), imageUpload, posts.addImage);
router.put('/:id/images/:imageId', auth, uploadLimiter, validate({ params: postImageParams }), imageUpload, posts.replaceImage);
router.delete('/:id/images/:imageId', auth, validate({ params: postImageParams }), posts.removeImage);

export default router;
