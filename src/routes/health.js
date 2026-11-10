/**
 * /api/health: liveness and database status for uptime checks.
 */
import { Router } from 'express';
import mongoose from 'mongoose';

const CONNECTED = 1;

const router = Router();

/**
 * GET /api/health: 200 when the database is connected, 503 otherwise.
 * Responds with `{ status, db, uptime }` (uptime in seconds).
 */
router.get('/', (req, res) => {
  const dbConnected = mongoose.connection.readyState === CONNECTED;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    db: dbConnected ? 'connected' : 'disconnected',
    uptime: Math.round(process.uptime()),
  });
});

export default router;
