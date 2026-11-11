/**
 * Runs explain("executionStats") on every query the API makes and checks the winning plan:
 * each query must use its intended index (IXSCAN), with no COLLSCAN and no in-memory SORT.
 * Exits with code 1 if any query fails the check.
 *
 *   npm run explain
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Note } from '../src/models/Note.js';
import { User } from '../src/models/User.js';
import { accessibleBy, buildNotesFilter, buildSummaryPipeline } from '../src/services/noteService.js';

const someUserId = new mongoose.Types.ObjectId();
/** Owned-or-shared queries must use both note indexes (one per $or branch). */
const BOTH = { all: ['owner_1__id_-1', 'collaborators_1__id_-1'] };
const someNoteId = new mongoose.Types.ObjectId();

/** Every query in the index map: a name, the expected index, and a function returning its explain output. */
const QUERIES = [
  {
    name: 'login / register: user by email',
    index: 'email_1',
    run: () => User.findOne({ email: 'someone@example.com' }).explain('executionStats'),
  },
  {
    name: 'auth: user by id',
    index: '_id_',
    run: () => User.findById(someUserId).explain('executionStats'),
  },
  {
    name: 'notes list (owned + shared, newest first)',
    index: BOTH,
    run: () => Note.find(buildNotesFilter(someUserId)).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'notes list: pinned only',
    index: BOTH,
    run: () =>
      Note.find(buildNotesFilter(someUserId, { pinned: true })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'notes list: by label',
    index: BOTH,
    run: () =>
      Note.find(buildNotesFilter(someUserId, { label: 'Work' })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'notes list: search',
    index: BOTH,
    run: () =>
      Note.find(buildNotesFilter(someUserId, { q: 'index' })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'notes list: multi-word search',
    index: BOTH,
    run: () =>
      Note.find(buildNotesFilter(someUserId, { q: 'index strategy' })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'note by id, owner or collaborator (get / update)',
    index: ['_id_', 'owner_1__id_-1', 'collaborators_1__id_-1'],
    run: () => Note.findOne({ _id: someNoteId, ...accessibleBy(someUserId) }).explain('executionStats'),
  },
  {
    name: 'note by id + owner (delete / share)',
    index: ['_id_', 'owner_1__id_-1'],
    run: () => Note.findOne({ _id: someNoteId, owner: someUserId }).explain('executionStats'),
  },
  {
    name: 'notes with reminders',
    index: BOTH,
    run: () =>
      Note.find(buildNotesFilter(someUserId, { reminder: true })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'labels: rename / delete (updateMany filter)',
    index: BOTH,
    run: () => Note.find(accessibleBy(someUserId, { labels: 'Work' })).explain('executionStats'),
  },
  {
    name: 'notes summary aggregate',
    index: BOTH,
    run: () => Note.aggregate(buildSummaryPipeline(someUserId)).explain('executionStats'),
  },
  {
    name: 'admin: users list (newest first)',
    index: '_id_',
    run: () => User.find({}).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: "admin: users list without the signed-in admin (User's Notes)",
    index: '_id_',
    run: () => User.find({ _id: { $ne: someUserId } }).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    // Approved exception (2026-11-11): substring search on name/email cannot use an index; it
    // walks the _id index (keeping newest-first order, no in-memory sort) and filters every user.
    name: 'admin: user search by name or email (approved full read)',
    index: '_id_',
    run: () =>
      User.find({ $or: [{ name: /ahmed/i }, { email: /ahmed/i }] }).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: "admin: a user's notes as they see them",
    index: BOTH,
    run: () => Note.find(buildNotesFilter(someUserId, { pinned: false })).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'admin: all notes (newest first)',
    index: '_id_',
    run: () => Note.find({}).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'admin: notes by owner (list, count, delete cascade)',
    index: 'owner_1__id_-1',
    run: () => Note.find({ owner: someUserId }).sort({ _id: -1 }).limit(10).explain('executionStats'),
  },
  {
    name: 'admin: delete cascade, shared notes (updateMany filter)',
    index: 'collaborators_1__id_-1',
    run: () => Note.find({ collaborators: someUserId }).explain('executionStats'),
  },
];

/** Recursively collects stage names and index names from an explain plan tree. */
function collectStages(node, out = { stages: [], indexes: [] }) {
  if (!node || typeof node !== 'object') return out;
  if (node.stage) out.stages.push(node.stage);
  if (node.indexName) out.indexes.push(node.indexName);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((v) => collectStages(v, out));
    else if (value && typeof value === 'object') collectStages(value, out);
  }
  return out;
}

/** Finds the winning plan in find() and aggregate() explain output. */
function winningPlan(explain) {
  return (
    explain?.queryPlanner?.winningPlan ??
    explain?.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ??
    explain
  );
}

/**
 * Runs every query and prints PASS/FAIL with the stages used.
 *
 * @returns {Promise<boolean>} True if every query uses its intended index without COLLSCAN or SORT.
 */
async function explainAll() {
  let ok = true;
  for (const query of QUERIES) {
    const { stages, indexes } = collectStages(winningPlan(await query.run()));
    const usesIndex = query.index.all
      ? query.index.all.every((name) => indexes.includes(name))
      : [].concat(query.index).some((name) => indexes.includes(name)) ||
        ([].concat(query.index).includes('_id_') && stages.includes('IDHACK'));
    const pass = usesIndex && !stages.includes('COLLSCAN') && !stages.includes('SORT');
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${query.name}`);
    console.log(`      index: ${indexes.join(', ') || '-'}  stages: ${[...new Set(stages)].join(' > ')}`);
  }
  return ok;
}

try {
  await connectDB();
  const ok = await explainAll();
  console.log(ok ? '\nOK: every query uses its index.' : '\nFAILED: see FAIL lines above.');
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await disconnectDB();
}
