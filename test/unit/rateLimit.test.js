import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { createRegisterLimiter, REGISTER_MAX_PER_WINDOW } from '../../src/middleware/rateLimit.js';

describe('createRegisterLimiter', () => {
  let server;
  let url;

  before(async () => {
    // A tiny app with only the limiter (no skip), so the real limit is exercised.
    const app = express();
    app.post('/register', createRegisterLimiter(), (req, res) => res.status(201).json({ ok: true }));
    app.use(errorHandler);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    url = `http://127.0.0.1:${server.address().port}/register`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it(`allows ${REGISTER_MAX_PER_WINDOW} sign-ups per window, then answers 429 in the standard shape`, async () => {
    for (let i = 0; i < REGISTER_MAX_PER_WINDOW; i++) {
      assert.equal((await fetch(url, { method: 'POST' })).status, 201);
    }
    const blocked = await fetch(url, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.deepEqual((await blocked.json()).error.code, 'RATE_LIMITED');
  });
});
