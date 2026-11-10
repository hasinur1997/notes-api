/**
 * Profile updates against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_users"), which must contain "test" and is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { User } from '../../src/models/User.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';

describe('PATCH /api/users/me (integration)', { skip }, () => {
  let api;
  let ann;

  before(async () => {
    await connectTestDb('users', [User]);
    api = await startServer();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    const res = await request(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      body: { name: 'Ann', email: 'ann@example.com', password: 'correct-horse', interests: ['Music'] },
    });
    ann = { token: res.body.token, id: res.body.user._id };
  });

  after(async () => {
    await api?.close();
    await dropTestDb();
  });

  const patch = (body, token = ann.token) => request(`${api.baseUrl}/users/me`, { method: 'PATCH', body, token });

  it('updates name and normalized interests, and never returns the password', async () => {
    const res = await patch({ name: '  Ann Tester ', interests: [' Hiking', 'hiking', 'Books '] });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Ann Tester');
    assert.deepEqual(res.body.user.interests, ['hiking', 'books']);
    assert.equal('password' in res.body.user, false);
    const me = await request(`${api.baseUrl}/auth/me`, { token: ann.token });
    assert.equal(me.body.user.name, 'Ann Tester');
  });

  it('updates one field without touching the other', async () => {
    const res = await patch({ interests: [] });
    assert.equal(res.body.user.name, 'Ann');
    assert.deepEqual(res.body.user.interests, []);
  });

  it('rejects email, role, password and unknown fields (privilege escalation)', async () => {
    for (const body of [{ email: 'x@example.com' }, { role: 'admin' }, { password: 'new-password' }, { name: 'A', isAdmin: true }]) {
      assert.equal((await patch(body)).status, 400, JSON.stringify(body));
    }
    const stored = await User.findById(ann.id).lean();
    assert.equal(stored.role, 'user');
    assert.equal(stored.email, 'ann@example.com');
  });

  it('rejects an empty body, blank names and too many interests', async () => {
    assert.equal((await patch({})).status, 400);
    assert.equal((await patch({ name: '   ' })).status, 400);
    assert.equal((await patch({ interests: Array.from({ length: 21 }, (_, i) => `i${i}`) })).status, 400);
  });

  it('keeps the password working after a profile update', async () => {
    await patch({ name: 'Ann B' });
    const login = await request(`${api.baseUrl}/auth/login`, {
      method: 'POST',
      body: { email: 'ann@example.com', password: 'correct-horse' },
    });
    assert.equal(login.status, 200);
  });

  it('requires authentication', async () => {
    assert.equal((await patch({ name: 'X' }, null)).status, 401);
  });
});
