/**
 * Password reset and profile photo against a real MongoDB. Skipped unless TEST_MONGO_URI is set.
 * Uses its own database (TEST_MONGO_URI name + "_account"), which must contain "test" and is dropped after the run.
 */
import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Note } from '../../src/models/Note.js';
import { User } from '../../src/models/User.js';
import { requestPasswordReset } from '../../src/services/passwordReset.js';
import { UPLOAD_DIR } from '../../src/utils/imageStorage.js';
import { outbox } from '../../src/utils/mailer.js';
import { connectTestDb, dropTestDb, skipWithoutDb as skip } from '../helpers/db.js';
import { request, startServer } from '../helpers/http.js';
import { PNG_1X1 } from '../helpers/images.js';

const PASSWORD = 'correct-horse';
const NEW_PASSWORD = 'battery-staple-42';

describe('account (integration)', { skip }, () => {
  let api;
  let ann;

  before(async () => {
    await connectTestDb('account', [User, Note]);
    api = await startServer();
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Note.deleteMany({})]);
    outbox.length = 0;
    const res = await request(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      body: { name: 'Ann <b>', email: 'ann@example.com', password: PASSWORD },
    });
    ann = { token: res.body.token, id: res.body.user._id };
  });

  after(async () => {
    await api?.close();
    await dropTestDb();
  });

  const post = (pathname, body, token) => request(`${api.baseUrl}${pathname}`, { method: 'POST', body, token });
  const login = (password) => post('/auth/login', { email: 'ann@example.com', password });

  /** Waits for background emails (forgot-password responds before the email is sent). */
  async function waitForEmails(count) {
    for (let i = 0; i < 50 && outbox.length < count; i++) await new Promise((r) => setTimeout(r, 20));
  }

  /** Requests a reset for Ann and returns the token from the emailed link. */
  async function resetToken() {
    outbox.length = 0;
    await requestPasswordReset('ann@example.com');
    return new URL(outbox[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  }

  describe('forgot password', () => {
    it('answers the same for known and unknown emails, and emails only real accounts', async () => {
      const known = await post('/auth/forgot-password', { email: 'ANN@example.com' });
      const unknown = await post('/auth/forgot-password', { email: 'nobody@example.com' });
      assert.equal(known.status, 200);
      assert.deepEqual(known.body, unknown.body);
      await waitForEmails(1);
      assert.equal(outbox.length, 1);
      assert.equal(outbox[0].to, 'ann@example.com');
      assert.match(outbox[0].text, /http:\/\/localhost:3000\/reset-password\?email=ann%40example\.com&token=[a-f0-9]{64}/);
      // User-controlled names are escaped in the HTML email.
      assert.match(outbox[0].html, /Ann &#60;b&#62;/);
    });

    it('stores only a hash of the token, never the token itself', async () => {
      const token = await resetToken();
      const stored = await User.findOne({ email: 'ann@example.com' }).select('+resetPasswordTokenHash').lean();
      assert.equal(stored.resetPasswordTokenHash.length, 64);
      assert.notEqual(stored.resetPasswordTokenHash, token);
      const me = await request(`${api.baseUrl}/auth/me`, { token: ann.token });
      assert.equal('resetPasswordTokenHash' in me.body.user, false);
      assert.equal('tokenVersion' in me.body.user, false);
    });
  });

  describe('reset password', () => {
    it('sets the new password once, signs out old sessions and sends a notice', async () => {
      const token = await resetToken();
      const res = await post('/auth/reset-password', { email: 'ann@example.com', token, password: NEW_PASSWORD });
      assert.equal(res.status, 200);

      assert.equal((await login(PASSWORD)).status, 401);
      const fresh = await login(NEW_PASSWORD);
      assert.equal(fresh.status, 200);

      const old = await request(`${api.baseUrl}/auth/me`, { token: ann.token });
      assert.equal(old.status, 401);
      assert.equal(old.body.error.code, 'TOKEN_REVOKED');
      assert.equal((await request(`${api.baseUrl}/auth/me`, { token: fresh.body.token })).status, 200);

      const again = await post('/auth/reset-password', { email: 'ann@example.com', token, password: 'another-pass-1' });
      assert.equal(again.status, 400);
      assert.equal(again.body.error.code, 'INVALID_RESET_TOKEN');

      await waitForEmails(2);
      assert.match(outbox.at(-1).subject, /password was changed/);
    });

    it('rejects a wrong token, a token for another email, and an expired token', async () => {
      const token = await resetToken();
      const wrong = 'a'.repeat(64);
      assert.equal((await post('/auth/reset-password', { email: 'ann@example.com', token: wrong, password: NEW_PASSWORD })).status, 400);
      assert.equal((await post('/auth/reset-password', { email: 'bob@example.com', token, password: NEW_PASSWORD })).status, 400);

      await User.updateOne({ email: 'ann@example.com' }, { $set: { resetPasswordExpiresAt: new Date(Date.now() - 1000) } });
      const expired = await post('/auth/reset-password', { email: 'ann@example.com', token, password: NEW_PASSWORD });
      assert.equal(expired.status, 400);
      assert.equal((await login(PASSWORD)).status, 200);
    });

    it('validates the token format and the new password', async () => {
      const token = await resetToken();
      assert.equal((await post('/auth/reset-password', { email: 'ann@example.com', token: 'short', password: NEW_PASSWORD })).status, 400);
      assert.equal((await post('/auth/reset-password', { email: 'ann@example.com', token, password: 'short' })).status, 400);
    });
  });

  describe('profile photo', () => {
    /** Uploads bytes as Ann's avatar. */
    async function uploadAvatar(bytes = PNG_1X1, type = 'image/png') {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type }), 'me.png');
      const res = await fetch(`${api.baseUrl}/users/me/avatar`, { method: 'POST', headers: { authorization: `Bearer ${ann.token}` }, body: form });
      return { status: res.status, body: await res.json() };
    }
    const fileOf = (url) => path.join(UPLOAD_DIR, url.replace(/^\/uploads\//, ''));

    it('uploads, replaces (deleting the old file) and removes the photo', async () => {
      const first = await uploadAvatar();
      assert.equal(first.status, 200);
      assert.match(first.body.user.avatar.url, /^\/uploads\/avatars\/[0-9a-f]{24}\/[0-9a-f]{32}\.png$/);
      assert.equal('publicId' in first.body.user.avatar, false);
      assert.ok(existsSync(fileOf(first.body.user.avatar.url)));

      const second = await uploadAvatar();
      assert.notEqual(second.body.user.avatar.url, first.body.user.avatar.url);
      assert.equal(existsSync(fileOf(first.body.user.avatar.url)), false);

      const removed = await request(`${api.baseUrl}/users/me/avatar`, { method: 'DELETE', token: ann.token });
      assert.equal(removed.body.user.avatar, null);
      assert.equal(existsSync(fileOf(second.body.user.avatar.url)), false);
    });

    it('rejects files that are not images', async () => {
      const res = await uploadAvatar(Buffer.from('<svg onload="alert(1)"/>'));
      assert.equal(res.status, 400);
    });

    it('shows the photo on notes shared with others', async () => {
      await uploadAvatar();
      await post('/auth/register', { name: 'Bob', email: 'bob@example.com', password: PASSWORD });
      const { body } = await post('/notes', { title: 'Shared' }, ann.token);
      const shared = await post(`/notes/${body.note._id}/collaborators`, { email: 'bob@example.com' }, ann.token);
      assert.match(shared.body.note.owner.avatar.url, /^\/uploads\/avatars\//);
      assert.equal('publicId' in shared.body.note.owner.avatar, false);
    });
  });
});
