/**
 * HTTP-level tests that need no database: routing, body parsing, CORS, and every
 * auth rejection path that happens before a database lookup.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { startServer, request } from '../helpers/http.js';

const SOME_ID = '0123456789abcdef01234567';
let api;

before(async () => {
  api = await startServer();
});

after(async () => {
  await api.close();
});

describe('app', () => {
  it('GET /api/health reports 503 when the database is disconnected', async () => {
    const res = await request(`${api.baseUrl}/health`);
    assert.equal(res.status, 503);
    assert.equal(res.body.db, 'disconnected');
  });

  it('unknown routes return 404 in the standard error shape', async () => {
    const res = await request(`${api.baseUrl}/does-not-exist`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('malformed JSON returns 400', async () => {
    const res = await request(`${api.baseUrl}/auth/register`, { method: 'POST', body: '{bad' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  it('bodies over 100kb return 413', async () => {
    const res = await request(`${api.baseUrl}/auth/register`, { method: 'POST', body: { name: 'x'.repeat(110_000) } });
    assert.equal(res.status, 413);
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(`${api.baseUrl}/health`);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('allows the configured CORS origin only', async () => {
    const allowed = await request(`${api.baseUrl}/health`, { headers: { origin: 'http://localhost:3000' } });
    const denied = await request(`${api.baseUrl}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

describe('POST /api/auth/register validation', () => {
  it('rejects a role field with 400', async () => {
    const res = await request(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      body: { name: 'Ann', email: 'ann@example.com', password: 'correct-horse', role: 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me token checks', () => {
  const me = (token, headers) => request(`${api.baseUrl}/auth/me`, { token, headers });
  const sign = (payload, options) => jwt.sign(payload, process.env.JWT_SECRET, options);

  it('401 NO_TOKEN without a header', async () => {
    const res = await me();
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'NO_TOKEN');
  });

  it('401 NO_TOKEN for a non-Bearer scheme', async () => {
    assert.equal((await me(undefined, { authorization: 'Basic abc' })).body.error.code, 'NO_TOKEN');
  });

  it('401 INVALID_TOKEN for garbage', async () => {
    assert.equal((await me('abc.def.ghi')).body.error.code, 'INVALID_TOKEN');
  });

  it('401 TOKEN_EXPIRED for an expired token', async () => {
    const token = sign({ sub: SOME_ID, role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 });
    assert.equal((await me(token)).body.error.code, 'TOKEN_EXPIRED');
  });

  it('401 INVALID_TOKEN for a token signed with another secret', async () => {
    const token = jwt.sign({ sub: SOME_ID }, 'x'.repeat(64));
    assert.equal((await me(token)).body.error.code, 'INVALID_TOKEN');
  });

  it('401 INVALID_TOKEN for an unsigned (alg: none) token', async () => {
    const token = jwt.sign({ sub: SOME_ID, role: 'admin' }, null, { algorithm: 'none' });
    assert.equal((await me(token)).body.error.code, 'INVALID_TOKEN');
  });

  it('401 INVALID_TOKEN for a token signed with a different algorithm', async () => {
    const token = sign({ sub: SOME_ID }, { algorithm: 'HS512' });
    assert.equal((await me(token)).body.error.code, 'INVALID_TOKEN');
  });

  it('401 INVALID_TOKEN when sub is not an ObjectId', async () => {
    assert.equal((await me(sign({ sub: 'not-an-id' }))).body.error.code, 'INVALID_TOKEN');
  });
});

describe('account routes require authentication', () => {
  for (const [method, path] of [
    ['PATCH', '/users/me'],
    ['POST', '/users/me/avatar'],
    ['DELETE', '/users/me/avatar'],
  ]) {
    it(`${method} ${path} -> 401`, async () => {
      const res = await request(`${api.baseUrl}${path}`, { method, body: method === 'DELETE' ? undefined : {} });
      assert.equal(res.status, 401);
    });
  }
});

describe('password reset validation', () => {
  it('rejects malformed reset requests with 400 before touching the database', async () => {
    const forgot = await request(`${api.baseUrl}/auth/forgot-password`, { method: 'POST', body: { email: 'nope' } });
    assert.equal(forgot.status, 400);
    const reset = await request(`${api.baseUrl}/auth/reset-password`, {
      method: 'POST',
      body: { email: 'a@b.co', token: 'x', password: 'correct-horse' },
    });
    assert.equal(reset.status, 400);
  });
});

describe('POST /api/auth/login rate limit', () => {
  it('returns 429 after 10 attempts', async () => {
    const attempt = () => request(`${api.baseUrl}/auth/login`, { method: 'POST', body: {} });
    for (let i = 0; i < 10; i++) assert.notEqual((await attempt()).status, 429);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });
});
