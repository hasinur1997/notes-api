/**
 * /api/users routes: the signed-in user's account, and public profiles with posts.
 */
import { Router } from 'express';
import { removeAvatar, updateMe, updateSettings, uploadAvatar } from '../controllers/usersController.js';
import { auth } from '../middleware/auth.js';
import { imageUpload, uploadLimiter } from '../middleware/upload.js';
import { idParams, validate } from '../middleware/validate.js';
import { listUserPosts } from '../controllers/postsController.js';
import { updateMeBody, updateSettingsBody } from '../validators/users.js';
import { listPostsQuery } from '../validators/posts.js';

const router = Router();

router.patch('/me', auth, validate({ body: updateMeBody }), updateMe);
router.patch('/me/settings', auth, validate({ body: updateSettingsBody }), updateSettings);
router.post('/me/avatar', auth, uploadLimiter, imageUpload, uploadAvatar);
router.delete('/me/avatar', auth, removeAvatar);
// Public profile with posts (Scenario 2). "me" never matches: idParams only accepts ObjectIds.
router.get('/:id/posts', validate({ params: idParams, query: listPostsQuery }), listUserPosts);

export default router;
