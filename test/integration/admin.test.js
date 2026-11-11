/**
 * Admin API against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_admin"), which must contain "test" and is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Note } from '../../src/models/Note.js';
import { User } from '../../src/models/User.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';
import { signToken } from '../../src/utils/token.js';

const PASSWORD = 'correct-horse';

describe('admin (integration)', { skip }, () => {
  let api;
  let admin;
  let ann;
  let bob;

  before(async () => {
    await connectTestDb('admin', [User, Note]);
    api = await startServer();
  });

  const call = (user, method, path, body) => request(`${api.baseUrl}${path}`, { method, body, token: user?.token });
  const login = async (email, password = PASSWORD) =>
    request(`${api.baseUrl}/auth/login`, { method: 'POST', body: { email, password } });

  /** Registers a user (role user) and returns { token, id, email }. */
  async function signUp(name) {
    const email = `${name.toLowerCase()}@example.com`;
    const res = await request(`${api.baseUrl}/auth/register`, { method: 'POST', body: { name, email, password: PASSWORD } });
    return { token: res.body.token, id: res.body.user._id, email };
  }

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Note.deleteMany({})]);
    // Signed directly: the login endpoint is rate-limited, and only some tests are about signing in.
    const adminUser = await new User({ name: 'Admin', email: 'admin@example.com', password: PASSWORD, role: 'admin' }).save();
    admin = { token: signToken(adminUser), id: String(adminUser._id) };
    [ann, bob] = await Promise.all([signUp('Ann'), signUp('Bob')]);
  });

  after(async () => {
    await api?.close();
    await dropTestDb();
  });

  it('rejects missing tokens (401) and non-admins (403) on every route', async () => {
    const routes = [
      ['GET', '/admin/users'],
      ['POST', '/admin/users'],
      ['GET', `/admin/users/${ann.id}`],
      ['PATCH', `/admin/users/${ann.id}`],
      ['DELETE', `/admin/users/${bob.id}`],
      ['GET', '/admin/notes'],
      ['GET', '/admin/users/grouped-by-interest'],
    ];
    for (const [method, path] of routes) {
      const body = ['GET', 'DELETE'].includes(method) ? undefined : { name: 'X' };
      assert.equal((await call(null, method, path, body)).status, 401, `${method} ${path}`);
      assert.equal((await call(ann, method, path, body)).status, 403, `${method} ${path}`);
    }
    assert.ok(await User.findById(bob.id), 'nothing was deleted');
  });

  it('lists users newest first with pagination meta and no secrets', async () => {
    const res = await call(admin, 'GET', '/admin/users?limit=2');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.deepEqual(res.body.data.map((u) => u.email), ['bob@example.com', 'ann@example.com']);
    for (const user of res.body.data) {
      assert.equal('password' in user, false);
      assert.equal('tokenVersion' in user, false);
      assert.ok(user.createdAt);
    }
  });

  it('leaves out the signed-in admin with excludeSelf, with and without a search', async () => {
    const all = await call(admin, 'GET', '/admin/users?excludeSelf=true');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.data.map((u) => u.name), ['Bob', 'Ann']);
    assert.deepEqual(all.body.meta, { page: 1, limit: 10, total: 2, totalPages: 1 });
    const search = await call(admin, 'GET', '/admin/users?excludeSelf=true&q=example.com');
    assert.deepEqual(search.body.meta.total, 2);
    assert.equal(search.body.data.some((u) => u._id === admin.id), false);
    const off = await call(admin, 'GET', '/admin/users?excludeSelf=false');
    assert.equal(off.body.meta.total, 3);
    assert.equal((await call(admin, 'GET', '/admin/users?excludeSelf=yes')).status, 400);
  });

  it('searches users by any part of the name or email, case-insensitive and escaped', async () => {
    const byName = await call(admin, 'GET', '/admin/users?q=AN');
    assert.deepEqual(byName.body.data.map((u) => u.name), ['Ann']);
    const byEmail = await call(admin, 'GET', '/admin/users?q=example.com&limit=2');
    assert.deepEqual(byEmail.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.equal((await call(admin, 'GET', `/admin/users?q=${encodeURIComponent('.*')}`)).body.meta.total, 0);
    assert.equal((await call(admin, 'GET', '/admin/users?email=ann@example.com')).status, 400, 'unknown param');
  });

  it('lists a user’s notes as they see them (owned + shared), with a pinned filter, read-only', async () => {
    await call(ann, 'POST', '/notes', { title: 'ann pinned', pinned: true });
    await call(ann, 'POST', '/notes', { title: 'ann plain' });
    const shared = await call(bob, 'POST', '/notes', { title: 'bob shares' });
    await call(bob, 'POST', `/notes/${shared.body.note._id}/collaborators`, { email: ann.email });
    await call(bob, 'POST', '/notes', { title: 'bob private' });

    const all = await call(admin, 'GET', `/admin/users/${ann.id}/notes`);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.data.map((n) => n.title), ['bob shares', 'ann plain', 'ann pinned']);
    assert.equal(all.body.data[0].owner.name, 'Bob');
    assert.equal(all.body.data.every((n) => n.isOwner === false), true);
    const pinned = await call(admin, 'GET', `/admin/users/${ann.id}/notes?pinned=true`);
    assert.deepEqual(pinned.body.data.map((n) => n.title), ['ann pinned']);
    const others = await call(admin, 'GET', `/admin/users/${ann.id}/notes?pinned=false&limit=1`);
    assert.deepEqual(others.body.meta, { page: 1, limit: 1, total: 2, totalPages: 2 });

    assert.equal((await call(admin, 'GET', '/admin/users/0123456789abcdef01234567/notes')).status, 404);
    assert.equal((await call(admin, 'GET', `/admin/users/${ann.id}/notes?pinned=yes`)).status, 400);
    assert.equal((await call(ann, 'GET', `/admin/users/${bob.id}/notes`)).status, 403);
    assert.equal((await call(null, 'GET', `/admin/users/${bob.id}/notes`)).status, 401);
  });

  it('creates users with a role; the new account can sign in; duplicates are 409', async () => {
    const res = await call(admin, 'POST', '/admin/users', {
      name: 'Farhana',
      email: 'Farhana@Example.com',
      password: 'temporary-pass',
      role: 'admin',
      interests: ['Design', 'design', 'travel'],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'farhana@example.com');
    assert.equal(res.body.user.role, 'admin');
    assert.deepEqual(res.body.user.interests, ['design', 'travel']);
    assert.equal('password' in res.body.user, false);
    assert.equal((await login('farhana@example.com', 'temporary-pass')).status, 200);
    const dup = await call(admin, 'POST', '/admin/users', { name: 'X', email: 'ann@example.com', password: 'whatever-1' });
    assert.equal(dup.status, 409);
    for (const body of [{ name: 'X', email: 'x@example.com', password: 'short' }, { name: 'X', email: 'x@example.com', password: 'long-enough', role: 'root' }, { name: 'X', email: 'x@example.com', password: 'long-enough', isAdmin: true }]) {
      assert.equal((await call(admin, 'POST', '/admin/users', body)).status, 400, JSON.stringify(body));
    }
  });

  it('gets and updates a user; a new password signs them out and works for sign in', async () => {
    assert.equal((await call(admin, 'GET', `/admin/users/${ann.id}`)).body.user.name, 'Ann');
    const res = await call(admin, 'PATCH', `/admin/users/${ann.id}`, { name: 'Ann B', role: 'admin', interests: ['Chess'], password: 'brand-new-pass' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Ann B');
    assert.equal(res.body.user.role, 'admin');
    assert.deepEqual(res.body.user.interests, ['chess']);
    assert.equal((await call(ann, 'GET', '/auth/me')).status, 401, 'old session revoked');
    assert.equal((await login(ann.email)).status, 401);
    const relogin = await login(ann.email, 'brand-new-pass');
    assert.equal(relogin.status, 200);
    // The new role applies on the next request: Ann can now use admin routes.
    assert.equal((await call({ token: relogin.body.token }, 'GET', '/admin/users')).status, 200);
  });

  it('a role change without a new password keeps the session and applies at once', async () => {
    await call(admin, 'PATCH', `/admin/users/${bob.id}`, { role: 'admin' });
    assert.equal((await call(bob, 'GET', '/admin/users')).status, 200);
    await call(admin, 'PATCH', `/admin/users/${bob.id}`, { role: 'user' });
    assert.equal((await call(bob, 'GET', '/admin/users')).status, 403);
  });

  it('refuses to change the admin’s own role or delete their own account', async () => {
    const self = await call(admin, 'PATCH', `/admin/users/${admin.id}`, { role: 'user' });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'SELF_ROLE_CHANGE');
    assert.equal((await call(admin, 'PATCH', `/admin/users/${admin.id}`, { name: 'Head admin', role: 'admin' })).status, 200);
    const del = await call(admin, 'DELETE', `/admin/users/${admin.id}`);
    assert.equal(del.status, 403);
    assert.equal(del.body.error.code, 'SELF_DELETE');
    assert.equal((await User.findById(admin.id).lean()).role, 'admin');
  });

  it('rejects duplicate emails, unknown fields, empty bodies, bad ids and unknown users', async () => {
    assert.equal((await call(admin, 'PATCH', `/admin/users/${ann.id}`, { email: 'bob@example.com' })).status, 409);
    assert.equal((await call(admin, 'PATCH', `/admin/users/${ann.id}`, { tokenVersion: 5 })).status, 400);
    assert.equal((await call(admin, 'PATCH', `/admin/users/${ann.id}`, {})).status, 400);
    assert.equal((await call(admin, 'GET', '/admin/users/not-an-id')).status, 400);
    const ghost = '0123456789abcdef01234567';
    assert.equal((await call(admin, 'GET', `/admin/users/${ghost}`)).status, 404);
    assert.equal((await call(admin, 'PATCH', `/admin/users/${ghost}`, { name: 'X' })).status, 404);
    assert.equal((await call(admin, 'DELETE', `/admin/users/${ghost}`)).status, 404);
  });

  it('deleting a user removes their notes and their place on shared notes', async () => {
    const own = await call(bob, 'POST', '/notes', { title: 'Bob note' });
    const shared = await call(ann, 'POST', '/notes', { title: 'Ann shares' });
    await call(ann, 'POST', `/notes/${shared.body.note._id}/collaborators`, { email: bob.email });
    const res = await call(admin, 'DELETE', `/admin/users/${bob.id}`);
    assert.equal(res.status, 204);
    assert.equal(await User.findById(bob.id), null);
    assert.equal(await Note.findById(own.body.note._id), null);
    assert.deepEqual((await Note.findById(shared.body.note._id).lean()).collaborators, []);
    assert.equal((await call(bob, 'GET', '/auth/me')).status, 401);
  });

  it('lists every note newest first, filtered by owner, with owners attached', async () => {
    await call(ann, 'POST', '/notes', { title: 'a1' });
    await call(bob, 'POST', '/notes', { title: 'b1' });
    await call(ann, 'POST', '/notes', { title: 'a2' });
    const all = await call(admin, 'GET', '/admin/notes?limit=2');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.data.map((n) => n.title), ['a2', 'b1']);
    assert.deepEqual(all.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.equal(all.body.data[1].owner.name, 'Bob');
    const anns = await call(admin, 'GET', `/admin/notes?owner=${ann.id}`);
    assert.deepEqual(anns.body.data.map((n) => n.title), ['a2', 'a1']);
    assert.equal(anns.body.meta.total, 2);
    assert.equal((await call(admin, 'GET', '/admin/notes?owner=nope')).status, 400);
    // Admins can open any single note but cannot edit or delete someone else's.
    const note = anns.body.data[0];
    assert.equal((await call(admin, 'GET', `/notes/${note._id}`)).status, 200);
    assert.equal((await call(admin, 'PATCH', `/notes/${note._id}`, { title: 'hacked' })).status, 404);
    assert.equal((await call(admin, 'DELETE', `/notes/${note._id}`)).status, 404);
  });

  it('groups users by interest, largest group first, paginated in one aggregate', async () => {
    await call(admin, 'PATCH', `/admin/users/${ann.id}`, { interests: ['Chess', 'reading'] });
    await call(admin, 'PATCH', `/admin/users/${bob.id}`, { interests: ['chess', 'music'] });

    const all = await call(admin, 'GET', '/admin/users/grouped-by-interest?limit=2');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.deepEqual(all.body.data.map((g) => [g.interest, g.count]), [['chess', 2], ['music', 1]]);
    assert.deepEqual(all.body.data[0].users.map((u) => u.name).sort(), ['Ann', 'Bob']);
    for (const user of all.body.data[0].users) assert.deepEqual(Object.keys(user).sort(), ['_id', 'email', 'name']);

    const page2 = await call(admin, 'GET', '/admin/users/grouped-by-interest?limit=2&page=2');
    assert.deepEqual(page2.body.data.map((g) => g.interest), ['reading']);

    // Only the requested group, even though its users have other interests too; case-insensitive.
    const chess = await call(admin, 'GET', '/admin/users/grouped-by-interest?interest=CHESS');
    assert.deepEqual(chess.body.data.map((g) => [g.interest, g.count]), [['chess', 2]]);
    assert.equal(chess.body.meta.total, 1);

    const none = await call(admin, 'GET', '/admin/users/grouped-by-interest?interest=golf');
    assert.deepEqual(none.body, { data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } });

    assert.equal((await call(admin, 'GET', '/admin/users/grouped-by-interest?limit=51')).status, 400);
    assert.equal((await call(admin, 'GET', '/admin/users/grouped-by-interest?foo=1')).status, 400);
  });
});
