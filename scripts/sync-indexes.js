/**
 * Makes the database indexes match the schemas exactly (Model.syncIndexes() creates missing
 * indexes and drops ones not defined with schema.index()), then prints every index and fails
 * if anything other than _id and the allowed indexes exists.
 *
 *   npm run sync-indexes
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Note } from '../src/models/Note.js';
import { User } from '../src/models/User.js';

/** Allowed index names per collection (CLAUDE.md, Hard Rules), besides _id_. */
const ALLOWED = {
  users: ['email_1', 'interests_1'],
  notes: ['owner_1__id_-1', 'collaborators_1__id_-1'],
};

const MODELS = [User, Note];

/**
 * Syncs and checks every model's indexes.
 *
 * @returns {Promise<boolean>} True if every collection has only allowed indexes.
 */
async function syncAll() {
  let ok = true;
  for (const model of MODELS) {
    const dropped = await model.syncIndexes();
    const indexes = await model.collection.indexes();
    const name = model.collection.collectionName;
    const unexpected = indexes.map((i) => i.name).filter((n) => n !== '_id_' && !ALLOWED[name]?.includes(n));

    console.log(`\n${name}${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}`);
    for (const index of indexes) {
      console.log(`  ${index.name.padEnd(20)} ${JSON.stringify(index.key)}${index.unique ? ' unique' : ''}`);
    }
    if (unexpected.length) {
      ok = false;
      console.error(`  NOT ALLOWED: ${unexpected.join(', ')}`);
    }
  }
  return ok;
}

try {
  await connectDB();
  const ok = await syncAll();
  console.log(ok ? '\nOK: only _id and the allowed indexes exist.' : '\nFAILED: unexpected indexes found.');
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await disconnectDB();
}
