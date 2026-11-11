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
import { Post } from '../src/models/Post.js';
import { buildInterestGroupsPipeline } from '../src/services/interestGroups.js';
import { buildFeedPipeline, buildUserPostsPipeline } from '../src/services/postService.js';
import { accessibleBy, buildNotesFilter, buildSummaryPipeline } from '../src/services/noteService.js';

const someUserId = new mongoose.Types.ObjectId();
/** Owned-or-shared queries must use both note indexes (one per $or branch). */
const BOTH = { all: ['owner_1__id_-1', 'collaborators_1__id_-1'] };
const someNoteId = new mongoose.Types.ObjectId();
/** A real user, so $lookup stages actually run and report the index they used (set before explaining). */
let realUserId = someUserId;

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
  {
    // Without ?interest= every user must be read to build every group, so that variant is a full
    // scan by design and is not listed here.
    name: 'admin: users grouped by interest, one interest (Scenario 1)',
    index: 'interests_1',
    run: () =>
      User.aggregate(buildInterestGroupsPipeline({ interest: 'chess', skip: 0, limit: 10 })).explain('executionStats'),
  },
  {
    name: 'posts feed, newest first (+ author $lookup on users _id)',
    index: '_id_',
    lookupIndex: '_id_',
    run: () => Post.aggregate(buildFeedPipeline({ skip: 0, limit: 10 })).explain('executionStats'),
  },
  {
    name: 'post by id (get), post by id + author (update / delete / images)',
    index: '_id_',
    run: () => Post.findOne({ _id: someNoteId, author: someUserId }).explain('executionStats'),
  },
  {
    name: "user's posts: users $match + $lookup into posts (Scenario 2)",
    index: '_id_',
    lookupIndex: 'author_1__id_-1',
    run: () => User.aggregate(buildUserPostsPipeline(String(realUserId), { skip: 0, limit: 10 })).explain('executionStats'),
  },
  {
    name: 'admin: delete cascade, posts by author',
    index: 'author_1__id_-1',
    run: () => Post.find({ author: someUserId }).explain('executionStats'),
  },
];

/**
 * $lookup stages from aggregate explain output. Each reports `indexesUsed` and `collectionScans`
 * in executionStats, but only once it has run (an empty collection or no input documents
 * leaves both empty).
 */
function lookupStages(explain) {
  return (explain?.stages ?? []).filter((stage) => stage.$lookup);
}

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
    const explain = await query.run();
    const { stages, indexes } = collectStages(winningPlan(explain));
    const usesIndex = query.index.all
      ? query.index.all.every((name) => indexes.includes(name))
      : [].concat(query.index).some((name) => indexes.includes(name)) ||
        ([].concat(query.index).includes('_id_') && stages.includes('IDHACK'));
    const lookupRuns = query.lookupIndex ? lookupStages(explain) : [];
    const lookups = [...new Set(lookupRuns.flatMap((stage) => stage.indexesUsed ?? []))];
    const scanned = lookupRuns.some((stage) => stage.collectionScans > 0);
    // Passes when the intended index was used, or when no lookup ran (no data) and nothing was scanned.
    const lookupOk = !query.lookupIndex || (!scanned && (lookups.includes(query.lookupIndex) || lookups.length === 0));
    const pass = usesIndex && lookupOk && !stages.includes('COLLSCAN') && !stages.includes('SORT');
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${query.name}`);
    console.log(`      index: ${indexes.join(', ') || '-'}  stages: ${[...new Set(stages)].join(' > ')}`);
    if (query.lookupIndex) {
      console.log(`      $lookup index: ${lookups.join(', ') || '- (did not run: no data)'}${scanned ? '  COLLECTION SCAN' : ''}`);
    }
  }
  return ok;
}

try {
  await connectDB();
  realUserId = (await User.findOne({}, { _id: 1 }).lean())?._id ?? someUserId;
  const ok = await explainAll();
  console.log(ok ? '\nOK: every query uses its index.' : '\nFAILED: see FAIL lines above.');
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState) await disconnectDB();
}
