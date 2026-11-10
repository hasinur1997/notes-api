/**
 * /api/auth routes: register, login (rate-limited) and current user.
 */
import { Router } from 'express';
import { login, me, register } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { loginBody, registerBody } from '../validators/auth.js';

const router = Router();

router.post('/register', validate({ body: registerBody }), register);
router.post('/login', loginLimiter, validate({ body: loginBody }), login);
router.get('/me', auth, me);

export default router;
