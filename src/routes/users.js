/**
 * /api/users routes.
 */
import { Router } from 'express';
import { removeAvatar, updateMe, updateSettings, uploadAvatar } from '../controllers/usersController.js';
import { auth } from '../middleware/auth.js';
import { imageUpload, uploadLimiter } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { updateMeBody, updateSettingsBody } from '../validators/users.js';

const router = Router();

router.patch('/me', auth, validate({ body: updateMeBody }), updateMe);
router.patch('/me/settings', auth, validate({ body: updateSettingsBody }), updateSettings);
router.post('/me/avatar', auth, uploadLimiter, imageUpload, uploadAvatar);
router.delete('/me/avatar', auth, removeAvatar);

export default router;
