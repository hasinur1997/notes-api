/**
 * Notes API against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * The database name must contain "test"; it is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../../src/config/db.js';
import { Note } from '../../src/models/Note.js';
import { User } from '../../src/models/User.js';
import { request, startServer } from '../helpers/http.js';

const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
const skip = TEST_MONGO_URI ? false : 'set TEST_MONGO_URI to run database tests';

describe('notes (integration)', { skip }, () => {
  let api;
  let ann;
  let bob;

  before(async () => {
    await connectDB(TEST_MONGO_URI);
    if (!/test/i.test(mongoose.connection.name)) {
      await disconnectDB();
      throw new Error(`Refusing to run against "${mongoose.connection.name}": database name must contain "test"`);
    }
    await Promise.all([User.syncIndexes(), Note.syncIndexes()]);
    api = await startServer();
  });

  /** Registers a user and returns { token, id }. */
  async function signUp(name) {
    const res = await request(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      body: { name, email: `${name.toLowerCase()}@example.com`, password: 'correct-horse' },
    });
    return { token: res.body.token, id: res.body.user._id };
  }

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Note.deleteMany({})]);
    [ann, bob] = await Promise.all([signUp('Ann'), signUp('Bob')]);
  });

  after(async () => {
    await api?.close();
    if (mongoose.connection.readyState === 1 && /test/i.test(mongoose.connection.name)) {
      await mongoose.connection.dropDatabase();
    }
    await disconnectDB();
  });

  const call = (user, method, path, body) => request(`${api.baseUrl}${path}`, { method, body, token: user?.token });
  const create = (user, body) => call(user, 'POST', '/notes', body);

  it('creates a note owned by the caller with normalized labels', async () => {
    const res = await create(ann, { title: ' Groceries ', content: 'Rice', labels: ['Personal', 'personal'], pinned: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.note.title, 'Groceries');
    assert.deepEqual(res.body.note.labels, ['Personal']);
    assert.equal(res.body.note.pinned, true);
    assert.equal(res.body.note.owner, ann.id);
  });

  it('lists only the caller’s notes, newest first, with pagination meta', async () => {
    for (const title of ['one', 'two', 'three']) await create(ann, { title });
    await create(bob, { title: 'bob only' });
    const res = await call(ann, 'GET', '/notes?limit=2');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((n) => n.title), ['three', 'two']);
    assert.deepEqual(res.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('filters by pinned, label and search', async () => {
    await create(ann, { title: 'Index strategy', labels: ['Work'], pinned: true });
    await create(ann, { title: 'Books', content: 'Clean Architecture', labels: ['Reading'] });
    await create(ann, { title: 'Weekend plan', labels: ['Personal'] });

    const pinned = await call(ann, 'GET', '/notes?pinned=true');
    assert.deepEqual(pinned.body.data.map((n) => n.title), ['Index strategy']);
    const others = await call(ann, 'GET', '/notes?pinned=false');
    assert.equal(others.body.meta.total, 2);
    const reading = await call(ann, 'GET', '/notes?label=Reading');
    assert.deepEqual(reading.body.data.map((n) => n.title), ['Books']);
    const search = await call(ann, 'GET', '/notes?q=ARCHITECTURE');
    assert.deepEqual(search.body.data.map((n) => n.title), ['Books']);
    const regexChars = await call(ann, 'GET', `/notes?q=${encodeURIComponent('.*')}`);
    assert.equal(regexChars.body.meta.total, 0);
  });

  it('returns the sidebar summary in one call', async () => {
    await create(ann, { title: 'a', labels: ['Work', 'Ideas'] });
    await create(ann, { title: 'b', labels: ['Work'] });
    await create(ann, { title: 'c' });
    await create(bob, { title: 'd', labels: ['Work'] });
    const res = await call(ann, 'GET', '/notes/summary');
    assert.deepEqual(res.body, {
      totalNotes: 3,
      labels: [
        { name: 'Ideas', count: 1 },
        { name: 'Work', count: 2 },
      ],
    });
  });

  it('get / update / delete: 404 for another user’s note, never revealing it exists', async () => {
    const { body } = await create(ann, { title: 'private' });
    const id = body.note._id;
    assert.equal((await call(bob, 'GET', `/notes/${id}`)).status, 404);
    assert.equal((await call(bob, 'PATCH', `/notes/${id}`, { title: 'hacked' })).status, 404);
    assert.equal((await call(bob, 'DELETE', `/notes/${id}`)).status, 404);
    const still = await call(ann, 'GET', `/notes/${id}`);
    assert.equal(still.body.note.title, 'private');
  });

  it('admins may read any note but not edit it', async () => {
    const { body } = await create(ann, { title: 'private' });
    await User.updateOne({ _id: bob.id }, { role: 'admin' });
    assert.equal((await call(bob, 'GET', `/notes/${body.note._id}`)).status, 200);
    assert.equal((await call(bob, 'PATCH', `/notes/${body.note._id}`, { title: 'x' })).status, 404);
  });

  it('updates only whitelisted fields and normalizes labels', async () => {
    const { body } = await create(ann, { title: 'draft' });
    const res = await call(ann, 'PATCH', `/notes/${body.note._id}`, { title: 'final', labels: [' Work', 'WORK'], pinned: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.note.title, 'final');
    assert.deepEqual(res.body.note.labels, ['Work']);
    assert.equal(res.body.note.pinned, true);
  });

  it('deletes the caller’s note with 204', async () => {
    const { body } = await create(ann, { title: 'temp' });
    assert.equal((await call(ann, 'DELETE', `/notes/${body.note._id}`)).status, 204);
    assert.equal((await call(ann, 'GET', `/notes/${body.note._id}`)).status, 404);
  });

  it('renames a label across the caller’s notes only, merging duplicates', async () => {
    await create(ann, { title: 'a', labels: ['Work'] });
    await create(ann, { title: 'b', labels: ['Work', 'Projects'] });
    await create(bob, { title: 'c', labels: ['Work'] });
    const res = await call(ann, 'PATCH', '/notes/labels/Work', { name: 'Projects' });
    assert.deepEqual(res.body, { label: 'Projects', notesUpdated: 2 });
    const summary = await call(ann, 'GET', '/notes/summary');
    assert.deepEqual(summary.body.labels, [{ name: 'Projects', count: 2 }]);
    const bobSummary = await call(bob, 'GET', '/notes/summary');
    assert.deepEqual(bobSummary.body.labels, [{ name: 'Work', count: 1 }]);
  });

  it('deletes a label but keeps the notes; 404 for an unknown label', async () => {
    await create(ann, { title: 'a', labels: ['Work', 'Ideas'] });
    assert.equal((await call(ann, 'DELETE', '/notes/labels/Work')).status, 204);
    const summary = await call(ann, 'GET', '/notes/summary');
    assert.deepEqual(summary.body, { totalNotes: 1, labels: [{ name: 'Ideas', count: 1 }] });
    assert.equal((await call(ann, 'DELETE', '/notes/labels/Nope')).status, 404);
  });
});
