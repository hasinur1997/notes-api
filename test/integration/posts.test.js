/**
 * Posts API (public feed, author-only edits, Scenario 2) against a real MongoDB.
 * Skipped unless TEST_MONGO_URI is set. Uses its own database (TEST_MONGO_URI name + "_posts").
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Post } from '../../src/models/Post.js';
import { User } from '../../src/models/User.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';
import { PNG_1X1 } from '../helpers/images.js';

describe('posts (integration)', { skip }, () => {
  let api;
  let ann;
  let bob;

  before(async () => {
    await connectTestDb('posts', [User, Post]);
    api = await startServer();
  });

  /** Registers a user and returns { token, id }. */
  async function signUp(name, interests = []) {
    const res = await request(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      body: { name, email: `${name.toLowerCase()}@example.com`, password: 'correct-horse', interests },
    });
    return { token: res.body.token, id: res.body.user._id };
  }

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Post.deleteMany({})]);
    [ann, bob] = await Promise.all([signUp('Ann', ['Chess']), signUp('Bob')]);
  });

  after(async () => {
    await api?.close();
    await dropTestDb();
  });

  const call = (user, method, path, body) => request(`${api.baseUrl}${path}`, { method, body, token: user?.token });
  const publish = (user, body) => call(user, 'POST', '/posts', body);

  it('publishes a post by the caller; the author comes from the token, never the body', async () => {
    assert.equal((await publish(null, { title: 'Hi' })).status, 401);
    assert.equal((await publish(ann, { title: 'Hi', author: bob.id })).status, 400);
    const res = await publish(ann, { title: ' Hello ', content: '**Bold** start', color: 'mint' });
    assert.equal(res.status, 201);
    assert.equal(res.body.post.title, 'Hello');
    assert.equal(res.body.post.color, 'mint');
    assert.deepEqual(res.body.post.author, { _id: ann.id, name: 'Ann', avatar: null });
    assert.equal((await publish(ann, { title: '' })).status, 400);
    assert.equal((await publish(ann, { title: 'x', color: 'neon' })).status, 400);
  });

  it('serves a public feed newest first with authors and pagination, without a token', async () => {
    await publish(ann, { title: 'a1' });
    await publish(bob, { title: 'b1' });
    await publish(ann, { title: 'a2' });
    const res = await call(null, 'GET', '/posts?limit=2');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((p) => p.title), ['a2', 'b1']);
    assert.deepEqual(res.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.equal(res.body.data[1].author.name, 'Bob');
    for (const post of res.body.data) assert.equal('email' in post.author, false);
    assert.equal((await call(null, 'GET', '/posts?limit=51')).status, 400);
  });

  it('reads one post publicly; 404 for a missing post and 400 for a bad id', async () => {
    const { body } = await publish(ann, { title: 'Open', content: 'Text' });
    const res = await call(null, 'GET', `/posts/${body.post._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.post.content, 'Text');
    assert.equal(res.body.post.author.name, 'Ann');
    assert.equal((await call(null, 'GET', `/posts/${'0'.repeat(24)}`)).status, 404);
    assert.equal((await call(null, 'GET', '/posts/nope')).status, 400);
  });

  it('lets only the author edit or delete (others get 404)', async () => {
    const { body } = await publish(ann, { title: 'Mine' });
    const id = body.post._id;
    assert.equal((await call(bob, 'PATCH', `/posts/${id}`, { title: 'Hacked' })).status, 404);
    assert.equal((await call(bob, 'DELETE', `/posts/${id}`)).status, 404);
    assert.equal((await call(null, 'PATCH', `/posts/${id}`, { title: 'x' })).status, 401);
    assert.equal((await call(ann, 'PATCH', `/posts/${id}`, {})).status, 400);

    const edited = await call(ann, 'PATCH', `/posts/${id}`, { title: 'Edited', color: 'sky' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.post.title, 'Edited');
    assert.equal((await call(ann, 'DELETE', `/posts/${id}`)).status, 204);
    assert.equal((await call(null, 'GET', `/posts/${id}`)).status, 404);
  });

  it("lists a user's profile and posts in one pipeline (Scenario 2)", async () => {
    await publish(ann, { title: 'a1' });
    await publish(bob, { title: 'b1' });
    await publish(ann, { title: 'a2' });
    await publish(ann, { title: 'a3' });

    const res = await call(null, 'GET', `/users/${ann.id}/posts?limit=2`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.user, { _id: ann.id, name: 'Ann', avatar: null, interests: ['chess'], createdAt: res.body.user.createdAt });
    assert.deepEqual(res.body.data.map((p) => p.title), ['a3', 'a2']);
    assert.deepEqual(res.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
    assert.equal(res.body.data[0].author.name, 'Ann');

    const page2 = await call(null, 'GET', `/users/${ann.id}/posts?limit=2&page=2`);
    assert.deepEqual(page2.body.data.map((p) => p.title), ['a1']);

    const none = await call(null, 'GET', `/users/${bob.id}/posts?page=5`);
    assert.deepEqual(none.body.data, []);
    assert.equal(none.body.meta.total, 1);

    assert.equal((await call(null, 'GET', `/users/${'0'.repeat(24)}/posts`)).status, 404);
    assert.equal((await call(null, 'GET', '/users/me/posts')).status, 400);
  });

  it('adds and removes images on own posts only', async () => {
    const { body } = await publish(ann, { title: 'Pic' });
    const upload = async (user) => {
      const form = new FormData();
      form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'p.png');
      const res = await fetch(`${api.baseUrl}/posts/${body.post._id}/images`, {
        method: 'POST',
        headers: { authorization: `Bearer ${user.token}` },
        body: form,
      });
      return { status: res.status, body: await res.json() };
    };
    assert.equal((await upload(bob)).status, 404);
    const added = await upload(ann);
    assert.equal(added.status, 201);
    const [image] = added.body.post.images;
    assert.match(image.url, /^\/uploads\/posts\/[0-9a-f]{24}\/[0-9a-f]{32}\.png$/);
    assert.equal('publicId' in image, false);

    assert.equal((await call(bob, 'DELETE', `/posts/${body.post._id}/images/${image._id}`)).status, 404);
    const removed = await call(ann, 'DELETE', `/posts/${body.post._id}/images/${image._id}`);
    assert.deepEqual(removed.body.post.images, []);
  });
});
