/**
 * Scenario 1: users grouped by interest, using exactly one User.aggregate() call.
 * Pagination happens inside the pipeline with $facet, so there is no second query for the total.
 */
import { User } from '../models/User.js';
import { buildListResponse, getPagination } from '../utils/pagination.js';

/**
 * Most users returned per interest group. `count` is always the full group size, so the page can
 * say "and N more"; the cap keeps responses small and keeps the single $facet result document
 * far below MongoDB's 16 MB limit however popular an interest gets.
 */
export const MAX_USERS_PER_GROUP = 20;

/**
 * Builds the group-by-interest pipeline.
 *
 * With `interest`, the first $match uses the multikey { interests: 1 } index, so only the users
 * who have that interest are read. The second $match (after $unwind) keeps just that interest's
 * group, since those users usually have other interests too. Without `interest`, every user must be
 * read to build every group, so there is no $match at all.
 *
 * @param {{ interest?: string, skip: number, limit: number }} options - Normalized interest and paging.
 * @returns {object[]} Aggregation pipeline.
 */
export function buildInterestGroupsPipeline({ interest, skip, limit }) {
  const match = interest ? [{ $match: { interests: interest } }] : [];
  return [
    ...match,
    { $project: { name: 1, email: 1, interests: 1 } },
    { $unwind: '$interests' },
    ...match,
    {
      $group: {
        _id: '$interests',
        count: { $sum: 1 },
        users: { $push: { _id: '$_id', name: '$name', email: '$email' } },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        // Trimmed after paging, so only the groups on this page are touched.
        data: [
          { $skip: skip },
          { $limit: limit },
          { $project: { count: 1, users: { $slice: ['$users', MAX_USERS_PER_GROUP] } } },
        ],
      },
    },
  ];
}

/**
 * A page of interest groups, largest first (ties by interest name).
 *
 * @param {{ page: number, limit: number, interest?: string }} query - Validated query; `interest`
 *   is already trimmed and lowercased like stored interests.
 * @returns {Promise<{ data: { interest: string, count: number, users: object[] }[], meta: object }>}
 *   Standard list response; `total` is the number of groups. Each group lists at most
 *   MAX_USERS_PER_GROUP users; `count` is the full number.
 */
export async function getInterestGroups({ page, limit, interest }) {
  const { skip } = getPagination({ page, limit });
  const [result] = await User.aggregate(buildInterestGroupsPipeline({ interest, skip, limit }));
  const total = result.meta[0]?.total ?? 0;
  const data = result.data.map(({ _id, count, users }) => ({ interest: _id, count, users }));
  return buildListResponse(data, { page, limit, total });
}
