/**
 * Notes API against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_notes"), which must contain "test" and is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Note } from '../../src/models/Note.js';
import { User } from '../../src/models/User.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';
import { JPEG_3X2, PNG_1X1 } from '../helpers/images.js';

describe('notes (integration)', { skip }, () => {
  let api;
  let ann;
  let bob;

  before(async () => {
    await connectTestDb('notes', [User, Note]);
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
    await dropTestDb();
  });

  const call = (user, method, path, body) => request(`${api.baseUrl}${path}`, { method, body, token: user?.token });
  const create = (user, body) => call(user, 'POST', '/notes', body);

  it('creates a note owned by the caller with normalized labels', async () => {
    const res = await create(ann, { title: ' Groceries ', content: 'Rice', labels: ['Personal', 'personal'], pinned: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.note.title, 'Groceries');
    assert.deepEqual(res.body.note.labels, ['Personal']);
    assert.equal(res.body.note.pinned, true);
    assert.deepEqual(res.body.note.owner, { _id: ann.id, name: 'Ann', email: 'ann@example.com', avatar: null });
    assert.equal(res.body.note.isOwner, true);
    assert.equal(res.body.note.color, 'default');
    assert.equal(res.body.note.reminderAt, null);
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
      reminders: 0,
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
    assert.deepEqual(summary.body, { totalNotes: 1, reminders: 0, labels: [{ name: 'Ideas', count: 1 }] });
    assert.equal((await call(ann, 'DELETE', '/notes/labels/Nope')).status, 404);
  });

  it('stores colour and reminder, lists and counts reminders', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const { body } = await create(ann, { title: 'Dentist', color: 'sky', reminderAt: at });
    assert.equal(body.note.color, 'sky');
    assert.equal(body.note.reminderAt, at);
    await create(ann, { title: 'No reminder' });
    const list = await call(ann, 'GET', '/notes?reminder=true');
    assert.deepEqual(list.body.data.map((n) => n.title), ['Dentist']);
    assert.equal((await call(ann, 'GET', '/notes/summary')).body.reminders, 1);
    const cleared = await call(ann, 'PATCH', `/notes/${body.note._id}`, { reminderAt: null });
    assert.equal(cleared.body.note.reminderAt, null);
  });

  it('copies a note into a new unpinned, unshared note owned by the caller', async () => {
    const { body } = await create(ann, { title: 'Original', content: 'x', labels: ['Work'], pinned: true, color: 'mint' });
    await call(ann, 'POST', `/notes/${body.note._id}/collaborators`, { email: 'bob@example.com' });
    const copy = await call(bob, 'POST', `/notes/${body.note._id}/copy`);
    assert.equal(copy.status, 201);
    assert.notEqual(copy.body.note._id, body.note._id);
    assert.equal(copy.body.note.owner._id, bob.id);
    assert.equal(copy.body.note.pinned, false);
    assert.deepEqual(copy.body.note.collaborators, []);
    assert.equal(copy.body.note.color, 'mint');
  });

  describe('sharing', () => {
    let noteId;
    beforeEach(async () => {
      noteId = (await create(ann, { title: 'Shared plan', labels: ['Work'] })).body.note._id;
    });

    it('owner shares by email; the collaborator sees, edits and finds it in lists and summary', async () => {
      const shared = await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'BOB@example.com' });
      assert.equal(shared.status, 200);
      assert.deepEqual(shared.body.note.collaborators, [{ _id: bob.id, name: 'Bob', email: 'bob@example.com', avatar: null }]);

      const list = await call(bob, 'GET', '/notes');
      assert.deepEqual(list.body.data.map((n) => [n.title, n.isOwner]), [['Shared plan', false]]);
      assert.equal((await call(bob, 'GET', '/notes/summary')).body.totalNotes, 1);
      const edit = await call(bob, 'PATCH', `/notes/${noteId}`, { content: 'Edited by Bob' });
      assert.equal(edit.body.note.content, 'Edited by Bob');
    });

    it('collaborators cannot delete, share or remove others', async () => {
      await signUp('Cara');
      await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'bob@example.com' });
      assert.equal((await call(bob, 'DELETE', `/notes/${noteId}`)).status, 404);
      assert.equal((await call(bob, 'POST', `/notes/${noteId}/collaborators`, { email: 'cara@example.com' })).status, 404);
      assert.equal((await call(bob, 'DELETE', `/notes/${noteId}/collaborators/${ann.id}`)).status, 404);
    });

    it('a collaborator can leave; the owner can remove; then access is gone', async () => {
      await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'bob@example.com' });
      assert.equal((await call(bob, 'DELETE', `/notes/${noteId}/collaborators/${bob.id}`)).status, 204);
      assert.equal((await call(bob, 'GET', `/notes/${noteId}`)).status, 404);
      await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'bob@example.com' });
      assert.equal((await call(ann, 'DELETE', `/notes/${noteId}/collaborators/${bob.id}`)).status, 204);
      assert.equal((await call(bob, 'GET', `/notes/${noteId}`)).status, 404);
    });

    it('rejects unknown emails, sharing with yourself, and non-owners', async () => {
      const unknown = await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'nobody@example.com' });
      assert.equal(unknown.status, 404);
      assert.equal(unknown.body.error.code, 'USER_NOT_FOUND');
      assert.equal((await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'ann@example.com' })).status, 400);
    });

    it('label rename reaches shared notes for collaborators', async () => {
      await call(ann, 'POST', `/notes/${noteId}/collaborators`, { email: 'bob@example.com' });
      await call(bob, 'PATCH', '/notes/labels/Work', { name: 'Projects' });
      assert.deepEqual((await call(ann, 'GET', `/notes/${noteId}`)).body.note.labels, ['Projects']);
    });
  });

  describe('images (local storage)', () => {
    /** Uploads raw bytes as the `image` field. */
    async function upload(user, noteId, bytes, type = 'image/png', name = 'photo.png') {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type }), name);
      const res = await fetch(`${api.baseUrl}/notes/${noteId}/images`, {
        method: 'POST',
        headers: { authorization: `Bearer ${user.token}` },
        body: form,
      });
      return { status: res.status, body: await res.json() };
    }

    it('stores a real image, serves it safely, and deletes the file with the image', async () => {
      const { body } = await create(ann, { title: 'With image' });
      const res = await upload(ann, body.note._id, PNG_1X1);
      assert.equal(res.status, 201);
      const [image] = res.body.note.images;
      assert.match(image.url, /^\/uploads\/notes\/[0-9a-f]{24}\/[0-9a-f]{32}\.png$/);
      assert.deepEqual([image.width, image.height], [1, 1]);
      assert.equal('publicId' in image, true);

      const origin = api.baseUrl.replace(/\/api$/, '');
      const file = await fetch(`${origin}${image.url}`);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-type'), 'image/png');
      assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(file.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_1X1);

      const removed = await call(ann, 'DELETE', `/notes/${body.note._id}/images/${image._id}`);
      assert.deepEqual(removed.body.note.images, []);
      assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
    });

    it('replaces an image in place (after cropping) and deletes the old file', async () => {
      const { body } = await create(ann, { title: 'Crop me' });
      const first = (await upload(ann, body.note._id, PNG_1X1)).body.note.images[0];
      const second = (await upload(ann, body.note._id, PNG_1X1)).body.note.images[1];
      const form = new FormData();
      form.append('image', new Blob([JPEG_3X2], { type: 'image/jpeg' }), 'cropped.jpg');
      const res = await fetch(`${api.baseUrl}/notes/${body.note._id}/images/${first._id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${ann.token}` },
        body: form,
      });
      assert.equal(res.status, 200);
      const { note } = await res.json();
      assert.equal(note.images.length, 2);
      assert.match(note.images[0].url, /\.jpg$/);
      assert.deepEqual([note.images[0].width, note.images[0].height], [3, 2]);
      assert.equal(note.images[1].url, second.url);
      const origin = api.baseUrl.replace(/\/api$/, '');
      assert.equal((await fetch(`${origin}${first.url}`)).status, 404);
      const served = await fetch(`${origin}${note.images[0].url}`);
      assert.equal(served.headers.get('access-control-allow-origin'), '*');

      const missing = await fetch(`${api.baseUrl}/notes/${body.note._id}/images/${'0'.repeat(24)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${ann.token}` },
        body: form,
      });
      assert.equal(missing.status, 404);
      const other = await fetch(`${api.baseUrl}/notes/${body.note._id}/images/${second._id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${bob.token}` },
        body: form,
      });
      assert.equal(other.status, 404);
    });

    it('names the file by its real type, not the name or MIME type the client sent', async () => {
      const { body } = await create(ann, { title: 'Disguised' });
      const res = await upload(ann, body.note._id, JPEG_3X2, 'image/png', 'trick.png');
      assert.equal(res.status, 201);
      assert.match(res.body.note.images[0].url, /\.jpg$/);
    });

    it('rejects non-images even with an image MIME type, and wrong MIME types up front', async () => {
      const { body } = await create(ann, { title: 'Bad files' });
      const fake = await upload(ann, body.note._id, Buffer.from('<svg onload="alert(1)"/>'), 'image/png');
      assert.equal(fake.status, 400);
      assert.equal(fake.body.error.code, 'INVALID_IMAGE');
      const svg = await upload(ann, body.note._id, Buffer.from('<svg/>'), 'image/svg+xml', 'a.svg');
      assert.equal(svg.status, 400);
    });

    it('rejects files over 5 MB with 413', async () => {
      const { body } = await create(ann, { title: 'Too big' });
      const big = Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024)]);
      assert.equal((await upload(ann, body.note._id, big)).status, 413);
    });

    it('enforces 5 images per note and access rules', async () => {
      const { body } = await create(ann, { title: 'Album' });
      for (let i = 0; i < 5; i++) assert.equal((await upload(ann, body.note._id, PNG_1X1)).status, 201);
      assert.equal((await upload(ann, body.note._id, PNG_1X1)).status, 400);
      assert.equal((await upload(bob, body.note._id, PNG_1X1)).status, 404);
    });

    it('deleting a note deletes its image files', async () => {
      const { body } = await create(ann, { title: 'Gone' });
      const { body: uploaded } = await upload(ann, body.note._id, PNG_1X1);
      const origin = api.baseUrl.replace(/\/api$/, '');
      await call(ann, 'DELETE', `/notes/${body.note._id}`);
      assert.equal((await fetch(`${origin}${uploaded.note.images[0].url}`)).status, 404);
    });
  });

  it('reads notes created before colour, reminders, sharing and images existed', async () => {
    // Insert directly, bypassing Mongoose defaults, like documents written by older versions.
    const { insertedId } = await Note.collection.insertOne({
      owner: new Note({ owner: ann.id, title: 'x' }).owner,
      title: 'Old note',
      content: 'Before the toolbar',
      labels: ['Work'],
      pinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const list = await call(ann, 'GET', '/notes?pinned=false');
    assert.equal(list.status, 200);
    const old = list.body.data.find((n) => n._id === String(insertedId));
    assert.deepEqual(
      { color: old.color, reminderAt: old.reminderAt, collaborators: old.collaborators, images: old.images },
      { color: 'default', reminderAt: null, collaborators: [], images: [] },
    );
    assert.equal((await call(ann, 'GET', `/notes/${insertedId}`)).status, 200);
    assert.equal((await call(ann, 'POST', `/notes/${insertedId}/collaborators`, { email: 'bob@example.com' })).status, 200);
    assert.equal((await call(ann, 'DELETE', `/notes/${insertedId}`)).status, 204);
  });

  describe('created labels', () => {
    it('creates a label with no notes; it shows in the summary with count 0, sorted ignoring case', async () => {
      await create(ann, { title: 'a', labels: ['Work'] });
      const res = await call(ann, 'POST', '/notes/labels', { name: ' bedIQ ' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.label, { name: 'bedIQ', count: 0 });
      const summary = await call(ann, 'GET', '/notes/summary');
      assert.deepEqual(summary.body.labels, [
        { name: 'bedIQ', count: 0 },
        { name: 'Work', count: 1 },
      ]);
      assert.deepEqual((await call(bob, 'GET', '/notes/summary')).body.labels, []);
    });

    it('rejects duplicates ignoring case, whether created or used on a note', async () => {
      await create(ann, { title: 'a', labels: ['Work'] });
      await call(ann, 'POST', '/notes/labels', { name: 'Ideas' });
      assert.equal((await call(ann, 'POST', '/notes/labels', { name: 'work' })).status, 409);
      assert.equal((await call(ann, 'POST', '/notes/labels', { name: 'IDEAS' })).status, 409);
    });

    it('renames and deletes a label that only exists as a created label', async () => {
      await call(ann, 'POST', '/notes/labels', { name: 'Draft' });
      const renamed = await call(ann, 'PATCH', '/notes/labels/Draft', { name: 'Drafts' });
      assert.deepEqual(renamed.body, { label: 'Drafts', notesUpdated: 0 });
      assert.deepEqual((await call(ann, 'GET', '/notes/summary')).body.labels, [{ name: 'Drafts', count: 0 }]);
      assert.equal((await call(ann, 'DELETE', '/notes/labels/Drafts')).status, 204);
      assert.deepEqual((await call(ann, 'GET', '/notes/summary')).body.labels, []);
      assert.equal((await call(ann, 'DELETE', '/notes/labels/Drafts')).status, 404);
    });

    it('a created label that a note starts using keeps one entry with the note count', async () => {
      await call(ann, 'POST', '/notes/labels', { name: 'Python' });
      await create(ann, { title: 'a', labels: ['Python'] });
      assert.deepEqual((await call(ann, 'GET', '/notes/summary')).body.labels, [{ name: 'Python', count: 1 }]);
    });
  });
});
