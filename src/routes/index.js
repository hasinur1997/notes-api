/**
 * API router: mounts every resource router under /api.
 */
import { Router } from 'express';
import authRoutes from './auth.js';
import healthRoutes from './health.js';
import notesRoutes from './notes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/notes', notesRoutes);

export default router;
