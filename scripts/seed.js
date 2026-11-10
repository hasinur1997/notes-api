/**
 * Creates the admin account from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env.
 * Safe to run more than once: an existing admin is left unchanged.
 *
 *   npm run seed
 */
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { ensureAdmin } from '../src/services/adminSeed.js';

/** Turns validation issues into readable lines that name the env variable to fix. */
function describeValidationError(err) {
  const variable = { name: 'ADMIN_NAME', email: 'ADMIN_EMAIL', password: 'ADMIN_PASSWORD' };
  return err.issues.map((issue) => `  - ${variable[issue.path[0]] ?? issue.path.join('.')}: ${issue.message}`).join('\n');
}

try {
  await connectDB();
  const result = await ensureAdmin({ name: env.ADMIN_NAME, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  console.log(
    result.status === 'created'
      ? `Admin created: ${result.email}`
      : `Admin already exists: ${result.email} (unchanged)`,
  );
} catch (err) {
  if (err instanceof ZodError) {
    console.error(`Cannot create the admin. Fix these values in .env:\n${describeValidationError(err)}`);
  } else {
    console.error(`Cannot create the admin: ${err.message}`);
  }
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await disconnectDB();
}
