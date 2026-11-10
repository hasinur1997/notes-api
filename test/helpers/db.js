/**
 * Database helpers for integration tests.
 * Each test file gets its own database (TEST_MONGO_URI's database name + a suffix), because
 * node --test runs files in parallel and shared data would make them interfere.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../../src/config/db.js';

/** Base connection string for test databases; integration tests are skipped when it is unset. */
export const TEST_MONGO_URI = process.env.TEST_MONGO_URI;

/** Skip reason for `describe(..., { skip })`, or false when a test database is configured. */
export const skipWithoutDb = TEST_MONGO_URI ? false : 'set TEST_MONGO_URI to run database tests';

/**
 * Connects to this file's own test database and syncs the given models' indexes.
 * Refuses to run unless the database name contains "test", so real data can never be touched.
 *
 * @param {string} suffix - Unique per test file, e.g. "auth".
 * @param {import('mongoose').Model[]} models - Models whose indexes the tests rely on.
 * @returns {Promise<void>}
 * @throws {Error} If the database name does not contain "test".
 */
export async function connectTestDb(suffix, models) {
  const url = new URL(TEST_MONGO_URI);
  const base = url.pathname.replace(/^\//, '') || 'notes_test';
  url.pathname = `/${base}_${suffix}`;

  await connectDB(url.toString());
  if (!/test/i.test(mongoose.connection.name)) {
    await disconnectDB();
    throw new Error(`Refusing to run against "${mongoose.connection.name}": database name must contain "test"`);
  }
  await Promise.all(models.map((model) => model.syncIndexes()));
}

/**
 * Drops this file's test database (only if its name contains "test") and disconnects.
 *
 * @returns {Promise<void>}
 */
export async function dropTestDb() {
  if (mongoose.connection.readyState === 1 && /test/i.test(mongoose.connection.name)) {
    await mongoose.connection.dropDatabase();
  }
  await disconnectDB();
}
