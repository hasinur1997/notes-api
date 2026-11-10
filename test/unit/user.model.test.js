import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeInterests, User } from '../../src/models/User.js';

describe('User model', () => {
  it('defines exactly the two allowed indexes', () => {
    assert.deepEqual(User.schema.indexes(), [
      [{ email: 1 }, { unique: true }],
      [{ interests: 1 }, {}],
    ]);
  });

  it('has no field-level index options (indexes come only from schema.index())', () => {
    const offenders = Object.entries(User.schema.paths)
      .filter(([, path]) => path.options.index || path.options.unique || path.options.sparse)
      .map(([name]) => name);
    assert.deepEqual(offenders, []);
  });

  it('excludes the password from queries by default', () => {
    assert.equal(User.schema.paths.password.options.select, false);
  });

  it('never serializes the password', () => {
    const user = new User({ name: 'Ann', email: 'ann@example.com', password: 'secret-hash' });
    assert.equal('password' in user.toJSON(), false);
    assert.equal('__v' in user.toJSON(), false);
  });

  it('normalizes name, email and interests on assignment', () => {
    const user = new User({ name: ' Ann ', email: ' Ann@Example.COM ', password: 'x', interests: [' Music', 'music', 'ART '] });
    assert.equal(user.name, 'Ann');
    assert.equal(user.email, 'ann@example.com');
    assert.deepEqual([...user.interests], ['music', 'art']);
  });

  it('defaults role to user and rejects unknown roles', () => {
    assert.equal(new User({}).role, 'user');
    const err = new User({ name: 'A', email: 'a@b.co', password: 'x', role: 'root' }).validateSync();
    assert.ok(err?.errors.role);
  });
});

describe('normalizeInterests', () => {
  it('trims, lowercases, drops empties and duplicates, keeping order', () => {
    assert.deepEqual(normalizeInterests([' B', 'a', 'b ', '', '  ', 'A']), ['b', 'a']);
  });

  it('returns an empty list when called without values', () => {
    assert.deepEqual(normalizeInterests(), []);
  });
});
