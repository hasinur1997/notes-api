/**
 * Writes and removes fake test data. Every document it creates carries the FAKE_SEED_FIELD
 * marker, so clearing removes exactly the fake data and never a user's real notes.
 */
import { randomBytes } from 'node:crypto';
import { Note } from '../models/Note.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { FAKE_SEED_FIELD, buildFakeNotes } from './fakeData.js';

/** A second account that owns notes shared with the target user. */
export const FAKE_COLLABORATOR = Object.freeze({ name: 'Sample Collaborator', email: 'sample.collaborator@example.com' });

/**
 * Validates fake notes through the Note model (normalized labels, enums, lengths), then inserts
 * them with the marker field and their spread-out timestamps.
 *
 * @param {object[]} notes - Output of buildFakeNotes.
 * @returns {Promise<number>} Number inserted.
 */
async function insertNotes(notes) {
  const docs = await Promise.all(
    notes.map(async ({ createdAt, updatedAt, ...fields }) => {
      const note = new Note(fields);
      await note.validate(); // throws a ValidationError for invalid fields
      return { ...note.toObject(), createdAt, updatedAt, [FAKE_SEED_FIELD]: true };
    }),
  );
  // insertMany on the collection keeps the chosen timestamps and the marker field.
  const { insertedCount } = await Note.collection.insertMany(docs, { ordered: true });
  return insertedCount;
}

/** Finds or creates the fake collaborator account (marked, with an unusable random password). */
async function ensureCollaborator() {
  const existing = await User.findOne({ email: FAKE_COLLABORATOR.email }, { _id: 1 }).lean();
  if (existing) return existing._id;
  const user = await User.create({ ...FAKE_COLLABORATOR, password: randomBytes(24).toString('hex') });
  await User.collection.updateOne({ _id: user._id }, { $set: { [FAKE_SEED_FIELD]: true } });
  return user._id;
}

/**
 * Adds fake notes for an existing user: `count` of their own (some shared with a sample
 * collaborator) plus a few notes the sample collaborator shares with them.
 *
 * @param {{ email: string, count: number, seed?: number }} options - Target account and amount.
 * @returns {Promise<{ own: number, sharedWithUser: number }>} What was inserted.
 * @throws {ApiError} 404 if no account uses the email.
 */
export async function seedFakeData({ email, count, seed = 42 }) {
  const user = await User.findOne({ email }, { _id: 1 }).lean();
  if (!user) throw ApiError.notFound(`No account uses ${email}`);
  const collaboratorId = await ensureCollaborator();

  const own = await insertNotes(
    buildFakeNotes({ ownerId: user._id, count, seed, collaboratorIds: [collaboratorId], shareEvery: 15 }),
  );
  const sharedWithUser = await insertNotes(
    buildFakeNotes({ ownerId: collaboratorId, count: Math.max(3, Math.round(count / 10)), seed: seed + 1, collaboratorIds: [user._id], shareEvery: 1 }),
  );
  return { own, sharedWithUser };
}

/**
 * Removes all fake data: marked notes of the user and of the sample collaborator, and the
 * sample collaborator account. Real notes are never matched (they have no marker).
 *
 * @param {{ email: string }} options - Account whose fake notes to remove.
 * @returns {Promise<{ notes: number, users: number }>} What was deleted.
 */
export async function clearFakeData({ email }) {
  const [user, collaborator] = await Promise.all([
    User.findOne({ email }, { _id: 1 }).lean(),
    // The marker is not in the schema, so marker queries go to the driver directly: Mongoose's
    // strictQuery could otherwise drop it from the filter and widen the match.
    User.collection.findOne({ email: FAKE_COLLABORATOR.email, [FAKE_SEED_FIELD]: true }, { projection: { _id: 1 } }),
  ]);
  const owners = [user?._id, collaborator?._id].filter(Boolean);

  let notes = 0;
  // One owner at a time, so each delete uses the { owner: 1, _id: -1 } index.
  for (const owner of owners) {
    notes += (await Note.collection.deleteMany({ owner, [FAKE_SEED_FIELD]: true })).deletedCount;
  }
  if (collaborator) {
    // Real notes the user shared with the sample collaborator must not keep pointing at a deleted account.
    await Note.updateMany({ collaborators: collaborator._id }, { $pull: { collaborators: collaborator._id } });
  }
  const users = collaborator ? (await User.deleteOne({ _id: collaborator._id })).deletedCount : 0;
  return { notes, users };
}
