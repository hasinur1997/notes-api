import { z } from 'zod';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

// Spread into a route's query schema: z.object({ ...paginationQuery, owner: ... }).strict()
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

export function getPagination({ page = 1, limit = DEFAULT_LIMIT } = {}) {
  return { page, limit, skip: (page - 1) * limit };
}

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
