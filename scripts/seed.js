/**
 * Seeds the database.
 *
 *   npm run seed                                   # create the admin from ADMIN_* in .env (idempotent)
 *   npm run seed -- --fake --email you@x.com       # add ~120 marked test notes (+ shared ones) for that account
 *   npm run seed -- --fake --email you@x.com --count 200
 *   npm run seed -- --clear-fake --email you@x.com # remove exactly the marked test data
 *   npm run seed -- --sample-posts                 # add sample authors and public posts (replaces earlier samples)
 *   npm run seed -- --clear-sample-posts           # remove the sample posts and authors
 *
 * Fake data is always marked, so --clear-fake and --clear-sample-posts never touch real data.
 */
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { z, ZodError } from 'zod';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { ensureAdmin } from '../src/services/adminSeed.js';
import { clearFakeData, FAKE_COLLABORATOR, seedFakeData } from '../src/services/fakeSeed.js';
import { clearSamplePosts, seedSamplePosts } from '../src/services/samplePosts.js';
import { emailField } from '../src/validators/auth.js';

const DEFAULT_FAKE_COUNT = 120;
const MAX_FAKE_COUNT = 2000;

/** Turns validation issues into readable lines that name the env variable to fix. */
function describeValidationError(err) {
  const variable = { name: 'ADMIN_NAME', email: 'ADMIN_EMAIL', password: 'ADMIN_PASSWORD' };
  return err.issues.map((issue) => `  - ${variable[issue.path[0]] ?? issue.path.join('.')}: ${issue.message}`).join('\n');
}

/** Reads and validates the command-line options. */
function readOptions() {
  const { values } = parseArgs({
    options: {
      fake: { type: 'boolean', default: false },
      'clear-fake': { type: 'boolean', default: false },
      'sample-posts': { type: 'boolean', default: false },
      'clear-sample-posts': { type: 'boolean', default: false },
      email: { type: 'string' },
      count: { type: 'string' },
    },
    strict: true,
  });
  const schema = z.object({
    fake: z.boolean(),
    clearFake: z.boolean(),
    samplePosts: z.boolean(),
    clearSamplePosts: z.boolean(),
    email: emailField.optional(),
    count: z.coerce.number().int().min(1).max(MAX_FAKE_COUNT).default(DEFAULT_FAKE_COUNT),
  });
  const options = schema.parse({
    fake: values.fake,
    clearFake: values['clear-fake'],
    samplePosts: values['sample-posts'],
    clearSamplePosts: values['clear-sample-posts'],
    email: values.email,
    count: values.count,
  });
  if ((options.fake || options.clearFake) && !options.email) {
    throw new Error('--fake and --clear-fake need --email <the account to use>');
  }
  return options;
}

/** Creates the admin from .env. */
async function seedAdmin() {
  const result = await ensureAdmin({ name: env.ADMIN_NAME, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  console.log(result.status === 'created' ? `Admin created: ${result.email}` : `Admin already exists: ${result.email} (unchanged)`);
}

try {
  const options = readOptions();
  await connectDB();
  if (options.clearSamplePosts) {
    const { posts, users } = await clearSamplePosts();
    console.log(`Removed ${posts} sample posts and ${users} sample authors.`);
  } else if (options.samplePosts) {
    const { posts, authors } = await seedSamplePosts();
    console.log(`Added ${posts} sample posts by ${authors} sample authors.\nRemove them with: npm run seed -- --clear-sample-posts`);
  } else if (options.clearFake) {
    const { notes, users } = await clearFakeData(options);
    console.log(`Removed ${notes} test notes${users ? ` and the ${FAKE_COLLABORATOR.email} test account` : ''}.`);
  } else if (options.fake) {
    const { own, sharedWithUser } = await seedFakeData(options);
    console.log(
      `Added ${own} test notes for ${options.email} and ${sharedWithUser} notes shared with it by ${FAKE_COLLABORATOR.email}.\n` +
        `Remove them with: npm run seed -- --clear-fake --email ${options.email}`,
    );
  } else {
    await seedAdmin();
  }
} catch (err) {
  if (err instanceof ZodError) {
    console.error(`Invalid values:\n${describeValidationError(err)}`);
  } else {
    console.error(`Seed failed: ${err.message}`);
  }
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await disconnectDB();
}
