import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { z } from 'zod';
import { errorHandler, toApiError } from '../../src/middleware/errorHandler.js';
import { ApiError } from '../../src/utils/ApiError.js';

/** Runs the error handler with a fake response and returns what it sent. */
function handle(err) {
  const sent = {};
  const res = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
  errorHandler(err, {}, res, () => {});
  return sent;
}

describe('toApiError', () => {
  it('passes ApiErrors through unchanged', () => {
    const err = ApiError.notFound('Note not found');
    assert.equal(toApiError(err), err);
  });

  it('maps ZodError to 400 VALIDATION_ERROR with field paths', () => {
    const { error } = z.object({ email: z.email() }).safeParse({ email: 'x' });
    const mapped = toApiError(error);
    assert.equal(mapped.status, 400);
    assert.equal(mapped.code, 'VALIDATION_ERROR');
    assert.match(mapped.message, /^email: /);
  });

  it('maps Mongo duplicate key (11000) to 409', () => {
    const mapped = toApiError({ code: 11000, keyValue: { email: 'a@b.co' } });
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, 'DUPLICATE_KEY');
    assert.match(mapped.message, /email/);
  });

  it('maps a Mongoose CastError to 400 INVALID_ID', () => {
    const mapped = toApiError(new mongoose.Error.CastError('ObjectId', 'bad', '_id'));
    assert.equal(mapped.status, 400);
    assert.equal(mapped.code, 'INVALID_ID');
  });

  it('returns null for unexpected errors', () => {
    assert.equal(toApiError(new Error('boom')), null);
  });
});

describe('errorHandler', () => {
  it('sends the standard error shape for known errors', () => {
    const sent = handle(ApiError.forbidden());
    assert.equal(sent.status, 403);
    assert.deepEqual(sent.body, { error: { message: 'You do not have permission to do this', code: 'FORBIDDEN' } });
  });

  it('hides internal messages of unexpected errors', (t) => {
    t.mock.method(console, 'error', () => {});
    const sent = handle(new Error('db password is hunter2'));
    assert.equal(sent.status, 500);
    assert.equal(sent.body.error.message, 'Internal server error');
    assert.equal(sent.body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(sent.body.error.message), /hunter2/);
  });
});
