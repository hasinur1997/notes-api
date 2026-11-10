/**
 * Process entry point: connects to MongoDB, starts the HTTP server and shuts down gracefully.
 */
import app from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Connects to the database, then starts listening on `env.PORT`.
 * On SIGTERM/SIGINT it stops accepting connections, waits for in-flight requests,
 * closes the database and exits (forcing exit after a timeout).
 *
 * @returns {Promise<void>}
 */
async function start() {
  await connectDB();

  const server = app.listen(env.PORT, () => {
    console.log(`notes-api listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
