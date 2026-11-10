/**
 * Auth flow against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_auth"), which must contain "test" and is dropped after the run.
 *
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017/notes_test npm test
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { User } from '../../src/models/User.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';

const ann = { name: 'Ann', email: 'ann@example.com', password: 'correct-horse', interests: ['Music', 'music'] };

describe('auth (integration)', { skip }, () => {
  let api;

  before(async () => {
    await connectTestDb('auth', [User]);
    api = await startServer();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  after(async () => {
    await api?.close();
    await dropTestDb();
  });

  const register = (body) => request(`${api.baseUrl}/auth/register`, { method: 'POST', body });
  const login = (body) => request(`${api.baseUrl}/auth/login`, { method: 'POST', body });

  it('registers a user as role "user" and returns a token without the password', async () => {
    const res = await register(ann);
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'user');
    assert.deepEqual(res.body.user.interests, ['music']);
    assert.equal('password' in res.body.user, false);
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    await register(ann);
    const stored = await User.findOne({ email: ann.email }).select('+password').lean();
    assert.notEqual(stored.password, ann.password);
    assert.match(stored.password, /^\$2[aby]\$12\$/);
  });

  it('returns 409 for a duplicate email (case-insensitive)', async () => {
    await register(ann);
    const res = await register({ ...ann, email: 'ANN@example.com' });
    assert.equal(res.status, 409);
  });

  it('logs in with correct credentials', async () => {
    await register(ann);
    const res = await login({ email: ann.email, password: ann.password });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal('password' in res.body.user, false);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    await register(ann);
    const wrong = await login({ email: ann.email, password: 'wrong-password' });
    const unknown = await login({ email: 'nobody@example.com', password: ann.password });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  it('GET /me returns the current user', async () => {
    const { body } = await register(ann);
    const res = await request(`${api.baseUrl}/auth/me`, { token: body.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, ann.email);
    assert.equal('password' in res.body.user, false);
  });

  it('GET /me returns 401 once the user is deleted', async () => {
    const { body } = await register(ann);
    await User.deleteOne({ _id: body.user._id });
    const res = await request(`${api.baseUrl}/auth/me`, { token: body.token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'USER_NOT_FOUND');
  });

  it('GET /me uses the role from the database, not the token', async () => {
    const { body } = await register(ann);
    await User.updateOne({ _id: body.user._id }, { role: 'admin' });
    const res = await request(`${api.baseUrl}/auth/me`, { token: body.token });
    assert.equal(res.body.user.role, 'admin');
  });
});
