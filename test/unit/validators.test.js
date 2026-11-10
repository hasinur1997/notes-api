import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { idParams } from '../../src/middleware/validate.js';
import { emailField, loginBody, registerBody } from '../../src/validators/auth.js';

const validRegister = { name: 'Ann', email: 'ann@example.com', password: 'correct-horse' };

describe('emailField', () => {
  it('trims and lowercases before validating', () => {
    assert.equal(emailField.parse('  Ann@Example.COM '), 'ann@example.com');
  });

  it('rejects invalid emails', () => {
    for (const bad of ['', 'nope', 'a@b', '@example.com']) {
      assert.equal(emailField.safeParse(bad).success, false, bad);
    }
  });
});

describe('registerBody', () => {
  it('accepts a valid body', () => {
    assert.equal(registerBody.safeParse(validRegister).success, true);
  });

  it('rejects a role field (privilege escalation)', () => {
    assert.equal(registerBody.safeParse({ ...validRegister, role: 'admin' }).success, false);
  });

  it('rejects unknown fields', () => {
    assert.equal(registerBody.safeParse({ ...validRegister, isAdmin: true }).success, false);
  });

  it('enforces password length 8-72', () => {
    assert.equal(registerBody.safeParse({ ...validRegister, password: 'short' }).success, false);
    assert.equal(registerBody.safeParse({ ...validRegister, password: 'x'.repeat(73) }).success, false);
    assert.equal(registerBody.safeParse({ ...validRegister, password: 'x'.repeat(72) }).success, true);
  });

  it('bounds interests to 20 entries of 1-50 characters', () => {
    assert.equal(registerBody.safeParse({ ...validRegister, interests: Array(21).fill('a') }).success, false);
    assert.equal(registerBody.safeParse({ ...validRegister, interests: ['x'.repeat(51)] }).success, false);
    assert.equal(registerBody.safeParse({ ...validRegister, interests: ['  '] }).success, false);
  });

  it('rejects non-string values (NoSQL injection attempts)', () => {
    assert.equal(registerBody.safeParse({ ...validRegister, email: { $ne: null } }).success, false);
  });
});

describe('loginBody', () => {
  it('rejects operator objects instead of strings', () => {
    assert.equal(loginBody.safeParse({ email: 'a@b.co', password: { $gt: '' } }).success, false);
  });

  it('rejects unknown fields', () => {
    assert.equal(loginBody.safeParse({ email: 'a@b.co', password: 'x', admin: true }).success, false);
  });
});

describe('idParams', () => {
  it('accepts a 24-character hex id', () => {
    assert.equal(idParams.safeParse({ id: '0123456789abcdef01234567' }).success, true);
  });

  it('rejects anything else', () => {
    for (const id of ['123', 'zzzzzzzzzzzzzzzzzzzzzzzz', '0123456789abcdef012345678']) {
      assert.equal(idParams.safeParse({ id }).success, false, id);
    }
  });
});
