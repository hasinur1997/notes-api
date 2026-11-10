/**
 * /api/users routes.
 */
import { Router } from 'express';
import { updateMe } from '../controllers/usersController.js';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateMeBody } from '../validators/users.js';

const router = Router();

router.patch('/me', auth, validate({ body: updateMeBody }), updateMe);

export default router;
