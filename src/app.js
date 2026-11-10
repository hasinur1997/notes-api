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
import { UPLOAD_DIR, UPLOADS_ROUTE } from './utils/imageStorage.js';

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

// Locally stored note images (used when Cloudinary is not configured). File names are random
// and unguessable; files are served as inert images only.
app.use(
  UPLOADS_ROUTE,
  express.static(UPLOAD_DIR, {
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    immutable: true,
    maxAge: '30d',
    setHeaders: (res) => {
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // The web app runs on another origin, so it must be allowed to embed these images.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    },
  }),
);

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
