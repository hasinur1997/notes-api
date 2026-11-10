/**
 * MongoDB connection lifecycle.
 */
import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * Opens the Mongoose connection.
 *
 * @param {string} [uri=env.MONGO_URI] - Connection string. Overridable so scripts and tests can target another database.
 * @returns {Promise<void>} Resolves once connected.
 * @throws {Error} If the database cannot be reached.
 */
export async function connectDB(uri = env.MONGO_URI) {
  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

/**
 * Closes the Mongoose connection.
 *
 * @returns {Promise<void>} Resolves once disconnected.
 */
export async function disconnectDB() {
  await mongoose.disconnect();
}
