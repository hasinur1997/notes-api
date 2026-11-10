import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Note } from '../../src/models/Note.js';
import { FAKE_LABELS, buildFakeNotes, createRandom } from '../../src/services/fakeData.js';

const ownerId = new mongoose.Types.ObjectId();
const now = new Date('2026-11-10T12:00:00Z');

describe('buildFakeNotes', () => {
  it('is deterministic for the same seed', () => {
    assert.deepEqual(buildFakeNotes({ ownerId, count: 20, seed: 7, now }), buildFakeNotes({ ownerId, count: 20, seed: 7, now }));
    assert.notDeepEqual(buildFakeNotes({ ownerId, count: 20, seed: 7, now }), buildFakeNotes({ ownerId, count: 20, seed: 8, now }));
  });

  it('produces valid notes that use every label and a mix of features', async () => {
    const notes = buildFakeNotes({ ownerId, count: 120, now });
    assert.equal(notes.length, 120);
    await Promise.all(notes.map((fields) => new Note(fields).validate()));
    assert.deepEqual(new Set(notes.flatMap((n) => n.labels)), new Set(FAKE_LABELS));
    assert.ok(notes.some((n) => n.pinned));
    assert.ok(notes.some((n) => n.color !== 'default'));
    assert.ok(notes.some((n) => n.reminderAt && n.reminderAt > now));
    assert.ok(notes.some((n) => n.content.includes('**')));
  });

  it('shares every n-th note with the given collaborators', () => {
    const friend = new mongoose.Types.ObjectId();
    const notes = buildFakeNotes({ ownerId, count: 30, now, collaboratorIds: [friend], shareEvery: 15 });
    assert.equal(notes.filter((n) => n.collaborators.length).length, 2);
  });
});

describe('createRandom', () => {
  it('returns numbers in [0, 1)', () => {
    const random = createRandom(1);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      assert.ok(value >= 0 && value < 1);
    }
  });
});
