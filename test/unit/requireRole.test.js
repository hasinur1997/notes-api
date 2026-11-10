import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireRole } from '../../src/middleware/requireRole.js';

/** Runs the middleware and resolves with the value passed to next(). */
function run(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, (err) => resolve(err)));
}

describe('requireRole', () => {
  const adminOnly = requireRole('admin');

  it('lets an allowed role through', async () => {
    assert.equal(await run(adminOnly, { user: { role: 'admin' } }), undefined);
  });

  it('returns 403 for another role', async () => {
    assert.equal((await run(adminOnly, { user: { role: 'user' } })).status, 403);
  });

  it('returns 401 when there is no user', async () => {
    assert.equal((await run(adminOnly, {})).status, 401);
  });

  it('accepts any of several roles', async () => {
    assert.equal(await run(requireRole('user', 'admin'), { user: { role: 'user' } }), undefined);
  });
});
