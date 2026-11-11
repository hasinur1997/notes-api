/**
 * /api/auth routes: register, login, current user, and password reset (rate-limited where abuse is possible).
 */
import { Router } from 'express';
import { forgotPassword, login, me, register, resetPassword } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';
import { forgotPasswordLimiter, loginLimiter, registerLimiter, resetPasswordLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { forgotPasswordBody, loginBody, registerBody, resetPasswordBody } from '../validators/auth.js';

const router = Router();

router.post('/register', registerLimiter, validate({ body: registerBody }), register);
router.post('/login', loginLimiter, validate({ body: loginBody }), login);
router.get('/me', auth, me);
router.post('/forgot-password', forgotPasswordLimiter, validate({ body: forgotPasswordBody }), forgotPassword);
router.post('/reset-password', resetPasswordLimiter, validate({ body: resetPasswordBody }), resetPassword);

export default router;
