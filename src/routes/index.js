/**
 * API router: mounts every resource router under /api.
 */
import { Router } from 'express';
import adminRoutes from './admin.js';
import authRoutes from './auth.js';
import healthRoutes from './health.js';
import notesRoutes from './notes.js';
import postsRoutes from './posts.js';
import usersRoutes from './users.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/notes', notesRoutes);
router.use('/posts', postsRoutes);
router.use('/users', usersRoutes);
router.use('/admin', adminRoutes);

export default router;
