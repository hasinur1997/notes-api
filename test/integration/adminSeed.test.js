/**
 * ensureAdmin against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_seed"), which must contain "test" and is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ZodError } from 'zod';
import { User } from '../../src/models/User.js';
import { ensureAdmin } from '../../src/services/adminSeed.js';
import { Note } from '../../src/models/Note.js';
import { clearFakeData, FAKE_COLLABORATOR, seedFakeData } from '../../src/services/fakeSeed.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';

const admin = { name: 'Admin', email: ' Admin@Example.com ', password: 'correct-horse-battery' };

describe('ensureAdmin (integration)', { skip }, () => {
  before(async () => {
    await connectTestDb('seed', [User, Note]);
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Note.deleteMany({})]);
  });

  after(async () => {
    await dropTestDb();
  });

  it('creates an admin with a normalized email and a hashed password', async () => {
    assert.deepEqual(await ensureAdmin(admin), { status: 'created', email: 'admin@example.com' });
    const stored = await User.findOne({ email: 'admin@example.com' }).select('+password').lean();
    assert.equal(stored.role, 'admin');
    assert.match(stored.password, /^\$2[aby]\$12\$/);
  });

  it('is idempotent and never overwrites an existing admin password', async () => {
    await ensureAdmin(admin);
    const before = await User.findOne({ email: 'admin@example.com' }).select('+password').lean();
    assert.equal((await ensureAdmin({ ...admin, password: 'a-different-password' })).status, 'exists');
    const after = await User.findOne({ email: 'admin@example.com' }).select('+password').lean();
    assert.equal(after.password, before.password);
    assert.equal(await User.countDocuments(), 1);
  });

  it('refuses to promote an existing non-admin account', async () => {
    await User.create({ name: 'Ann', email: 'admin@example.com', password: 'correct-horse' });
    await assert.rejects(ensureAdmin(admin), /non-admin account already uses admin@example.com/);
    assert.equal((await User.findOne({ email: 'admin@example.com' }).lean()).role, 'user');
  });

  it('rejects missing or weak values without touching the database', async () => {
    await assert.rejects(ensureAdmin({ ...admin, password: undefined }), ZodError);
    await assert.rejects(ensureAdmin({ ...admin, password: 'short' }), ZodError);
    await assert.rejects(ensureAdmin({ ...admin, email: undefined }), ZodError);
    assert.equal(await User.countDocuments(), 0);
  });

  it('fake seed adds marked notes and clear removes exactly them, keeping real notes', async () => {
    const ann = await User.create({ name: 'Ann', email: 'ann@example.com', password: 'correct-horse' });
    const real = await Note.create({ owner: ann._id, title: 'My real note' });
    const result = await seedFakeData({ email: 'ann@example.com', count: 30 });
    assert.deepEqual(result, { own: 30, sharedWithUser: 3 });
    assert.equal(await Note.countDocuments({ owner: ann._id }), 31);
    assert.equal(await Note.countDocuments({ collaborators: ann._id }), 3);
    const collaborator = await User.findOne({ email: FAKE_COLLABORATOR.email }).lean();
    // A real note shared with the test account must survive clearing (only the share is removed).
    await Note.updateOne({ _id: real._id }, { $push: { collaborators: collaborator._id } });

    const cleared = await clearFakeData({ email: 'ann@example.com' });
    assert.deepEqual(cleared, { notes: 33, users: 1 });
    const left = await Note.find({}).lean();
    assert.deepEqual(left.map((n) => n.title), ['My real note']);
    assert.deepEqual(left[0].collaborators, []);
    assert.equal(await User.countDocuments({ email: FAKE_COLLABORATOR.email }), 0);
  });

  it('fake seed refuses an unknown account', async () => {
    await assert.rejects(seedFakeData({ email: 'nobody@example.com', count: 5 }), /No account uses/);
  });
});
