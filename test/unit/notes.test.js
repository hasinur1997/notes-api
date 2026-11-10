import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Note, normalizeLabels } from '../../src/models/Note.js';
import { accessibleBy, buildNotesFilter } from '../../src/services/noteService.js';
import { escapeRegex } from '../../src/utils/escapeRegex.js';
import {
  addCollaboratorBody,
  createNoteBody,
  listNotesQuery,
  renameLabelBody,
  updateNoteBody,
} from '../../src/validators/notes.js';
import { request, startServer } from '../helpers/http.js';

const ownerId = new mongoose.Types.ObjectId();

describe('Note model', () => {
  it('defines exactly the two allowed indexes', () => {
    assert.deepEqual(Note.schema.indexes(), [
      [{ owner: 1, _id: -1 }, {}],
      [{ collaborators: 1, _id: -1 }, {}],
    ]);
  });

  it('has no field-level index options', () => {
    const offenders = Object.entries(Note.schema.paths)
      .filter(([, path]) => path.options.index || path.options.unique || path.options.sparse)
      .map(([name]) => name);
    assert.deepEqual(offenders, []);
  });

  it('defaults content, labels, pinned, colour, reminder, collaborators and images', () => {
    const note = new Note({ owner: ownerId, title: 'A' });
    assert.equal(note.content, '');
    assert.deepEqual([...note.labels], []);
    assert.equal(note.pinned, false);
    assert.equal(note.color, 'default');
    assert.equal(note.reminderAt, null);
    assert.deepEqual([...note.collaborators], []);
    assert.deepEqual([...note.images], []);
  });

  it('rejects unknown colours', () => {
    assert.ok(new Note({ owner: ownerId, title: 'A', color: 'neon' }).validateSync().errors.color);
  });

  it('requires owner and title', () => {
    const err = new Note({}).validateSync();
    assert.ok(err.errors.owner);
    assert.ok(err.errors.title);
  });
});

describe('normalizeLabels', () => {
  it('trims, collapses spaces and removes case-insensitive duplicates, keeping the first spelling', () => {
    assert.deepEqual(normalizeLabels([' Work ', 'work', 'Interview   prep', '', 'WORK', 'Ideas']), [
      'Work',
      'Interview prep',
      'Ideas',
    ]);
  });
});

describe('escapeRegex', () => {
  it('escapes every metacharacter so input matches literally', () => {
    const input = 'a.b*c+d?(e)[f]{g}|h^i$j\\k';
    assert.ok(new RegExp(escapeRegex(input)).test(input));
    assert.equal(new RegExp(escapeRegex('a.c')).test('abc'), false);
  });
});

describe('accessibleBy / buildNotesFilter', () => {
  it('matches notes the user owns or collaborates on, each branch starting with an indexed field', () => {
    assert.deepEqual(accessibleBy(ownerId), { $or: [{ owner: ownerId }, { collaborators: ownerId }] });
  });

  it('applies every filter inside both branches, with an escaped case-insensitive search', () => {
    const { $or: branches } = buildNotesFilter(ownerId, { pinned: false, label: 'Work', q: 'a.b', reminder: true });
    assert.equal(branches.length, 2);
    for (const branch of branches) {
      assert.equal(branch.pinned, false);
      assert.equal(branch.labels, 'Work');
      assert.deepEqual(branch.reminderAt, { $ne: null });
      assert.equal(branch.$or[0].title.source, 'a\\.b');
      assert.equal(branch.$or[0].title.flags, 'i');
    }
    assert.equal(branches[0].owner, ownerId);
    assert.equal(branches[1].collaborators, ownerId);
  });
});

describe('notes validators', () => {
  it('list query: coerces pinned and rejects unknown keys and long searches', () => {
    assert.equal(listNotesQuery.parse({ pinned: 'true' }).pinned, true);
    assert.equal(listNotesQuery.parse({ pinned: 'false' }).pinned, false);
    assert.equal(listNotesQuery.safeParse({ pinned: 'yes' }).success, false);
    assert.equal(listNotesQuery.safeParse({ sort: 'createdAt' }).success, false);
    assert.equal(listNotesQuery.safeParse({ q: 'x'.repeat(101) }).success, false);
  });

  it('create: requires a title and rejects owner (no writing notes for other users)', () => {
    assert.equal(createNoteBody.safeParse({ content: 'x' }).success, false);
    assert.equal(createNoteBody.safeParse({ title: 'A', owner: ownerId.toString() }).success, false);
    assert.equal(createNoteBody.safeParse({ title: '  ' }).success, false);
  });

  it('create: bounds labels to 10 entries of 1-30 characters', () => {
    assert.equal(createNoteBody.safeParse({ title: 'A', labels: Array(11).fill('x') }).success, false);
    assert.equal(createNoteBody.safeParse({ title: 'A', labels: ['x'.repeat(31)] }).success, false);
    assert.equal(createNoteBody.safeParse({ title: 'A', labels: ['Work'], pinned: true }).success, true);
  });

  it('update: needs at least one field and rejects unknown fields', () => {
    assert.equal(updateNoteBody.safeParse({}).success, false);
    assert.equal(updateNoteBody.safeParse({ pinned: true }).success, true);
    assert.equal(updateNoteBody.safeParse({ owner: 'x' }).success, false);
  });

  it('colour must be a palette key', () => {
    assert.equal(createNoteBody.safeParse({ title: 'A', color: 'amber' }).success, true);
    assert.equal(createNoteBody.safeParse({ title: 'A', color: '#ff0000' }).success, false);
  });

  it('reminder: ISO date with offset or null; not absurdly far ahead', () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    assert.ok(updateNoteBody.parse({ reminderAt: soon }).reminderAt instanceof Date);
    assert.equal(updateNoteBody.parse({ reminderAt: null }).reminderAt, null);
    assert.equal(updateNoteBody.safeParse({ reminderAt: 'tomorrow' }).success, false);
    assert.equal(updateNoteBody.safeParse({ reminderAt: '2099-01-01T00:00:00Z' }).success, false);
  });

  it('collaborators and images are not editable through the note body', () => {
    assert.equal(updateNoteBody.safeParse({ collaborators: [ownerId.toString()] }).success, false);
    assert.equal(updateNoteBody.safeParse({ images: [] }).success, false);
  });

  it('add collaborator: needs a valid email', () => {
    assert.equal(addCollaboratorBody.parse({ email: ' Bob@Example.com ' }).email, 'bob@example.com');
    assert.equal(addCollaboratorBody.safeParse({ email: 'bob' }).success, false);
  });

  it('rename label: requires a non-empty new name', () => {
    assert.equal(renameLabelBody.safeParse({ name: ' ' }).success, false);
    assert.equal(renameLabelBody.safeParse({ name: 'Projects' }).success, true);
  });
});

describe('/api/notes requires authentication', () => {
  let api;
  before(async () => {
    api = await startServer();
  });
  after(async () => {
    await api.close();
  });

  const id = '0123456789abcdef01234567';
  for (const [method, path] of [
    ['GET', '/notes'],
    ['POST', '/notes'],
    ['GET', '/notes/summary'],
    ['GET', `/notes/${id}`],
    ['PATCH', `/notes/${id}`],
    ['DELETE', `/notes/${id}`],
    ['PATCH', '/notes/labels/Work'],
    ['DELETE', '/notes/labels/Work'],
    ['POST', `/notes/${id}/copy`],
    ['POST', `/notes/${id}/collaborators`],
    ['DELETE', `/notes/${id}/collaborators/${id}`],
    ['POST', `/notes/${id}/images`],
    ['DELETE', `/notes/${id}/images/${id}`],
  ]) {
    it(`${method} ${path} -> 401`, async () => {
      const res = await request(`${api.baseUrl}${path}`, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 401);
    });
  }
});
