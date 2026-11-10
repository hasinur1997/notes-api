/**
 * Pagination helpers shared by every list endpoint.
 */
import { z } from 'zod';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

/**
 * Zod fields for `?page=&limit=`. Spread into a route's query schema:
 * `z.object({ ...paginationQuery, owner: objectId }).strict()`.
 */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

/**
 * Converts validated page/limit values into query options.
 *
 * @param {{ page?: number, limit?: number }} [query] - Validated pagination values.
 * @returns {{ page: number, limit: number, skip: number }} Values ready for `.skip()` / `.limit()` or `$skip` / `$limit`.
 */
export function getPagination({ page = 1, limit = DEFAULT_LIMIT } = {}) {
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Builds the standard list response body.
 *
 * @param {object[]} data - Items on the current page.
 * @param {{ page: number, limit: number, total: number }} paging - Current page, page size and total item count.
 * @returns {{ data: object[], meta: { page: number, limit: number, total: number, totalPages: number } }}
 */
export function buildListResponse(data, { page, limit, total }) {
  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
