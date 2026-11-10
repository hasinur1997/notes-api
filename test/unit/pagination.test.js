import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { buildListResponse, getPagination, MAX_LIMIT, paginationQuery } from '../../src/utils/pagination.js';

const schema = z.object(paginationQuery).strict();

describe('paginationQuery', () => {
  it('defaults to page 1 and limit 10', () => {
    assert.deepEqual(schema.parse({}), { page: 1, limit: 10 });
  });

  it('coerces query strings to numbers', () => {
    assert.deepEqual(schema.parse({ page: '3', limit: '5' }), { page: 3, limit: 5 });
  });

  it(`rejects page < 1, limit > ${MAX_LIMIT} and non-integers`, () => {
    for (const bad of [{ page: '0' }, { limit: String(MAX_LIMIT + 1) }, { limit: '0' }, { page: '1.5' }, { page: 'abc' }]) {
      assert.equal(schema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('getPagination', () => {
  it('computes skip from page and limit', () => {
    assert.deepEqual(getPagination({ page: 3, limit: 5 }), { page: 3, limit: 5, skip: 10 });
  });

  it('uses defaults when called without arguments', () => {
    assert.deepEqual(getPagination(), { page: 1, limit: 10, skip: 0 });
  });
});

describe('buildListResponse', () => {
  it('builds the standard list contract', () => {
    assert.deepEqual(buildListResponse([{ a: 1 }], { page: 2, limit: 10, total: 21 }), {
      data: [{ a: 1 }],
      meta: { page: 2, limit: 10, total: 21, totalPages: 3 },
    });
  });

  it('returns 0 pages for an empty result', () => {
    assert.equal(buildListResponse([], { page: 1, limit: 10, total: 0 }).meta.totalPages, 0);
  });
});
