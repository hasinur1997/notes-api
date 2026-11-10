/**
 * Express application: security middleware, body parsing, routes and error handling.
 * Exported without calling `listen()` so tests can mount it on an ephemeral port.
 */
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

const JSON_BODY_LIMIT = '100kb';

const app = express();

// Render (and most hosts) sit behind one reverse proxy; needed for correct client IPs in rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
