import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildInterestGroupsPipeline, MAX_USERS_PER_GROUP } from '../../src/services/interestGroups.js';
import { interestGroupsQuery } from '../../src/validators/admin.js';

describe('buildInterestGroupsPipeline', () => {
  it('without an interest: no $match, ends with $group, $sort and a paginating $facet', () => {
    const pipeline = buildInterestGroupsPipeline({ skip: 20, limit: 10 });
    assert.deepEqual(
      pipeline.map((stage) => Object.keys(stage)[0]),
      ['$project', '$unwind', '$group', '$sort', '$facet'],
    );
    assert.deepEqual(pipeline.at(-2), { $sort: { count: -1, _id: 1 } });
    assert.deepEqual(pipeline.at(-1).$facet, {
      meta: [{ $count: 'total' }],
      data: [
        { $skip: 20 },
        { $limit: 10 },
        { $project: { count: 1, users: { $slice: ['$users', MAX_USERS_PER_GROUP] } } },
      ],
    });
  });

  it('with an interest: matches first (index) and again after $unwind', () => {
    const pipeline = buildInterestGroupsPipeline({ interest: 'chess', skip: 0, limit: 10 });
    assert.deepEqual(pipeline[0], { $match: { interests: 'chess' } });
    assert.deepEqual(pipeline[3], { $match: { interests: 'chess' } });
    assert.deepEqual(Object.keys(pipeline[2]), ['$unwind']);
  });

  it('projects only public user fields into each group', () => {
    const group = buildInterestGroupsPipeline({ skip: 0, limit: 10 }).find((stage) => stage.$group).$group;
    assert.deepEqual(group.users, { $push: { _id: '$_id', name: '$name', email: '$email' } });
  });
});

describe('interestGroupsQuery', () => {
  it('normalizes the interest like stored interests and applies pagination defaults', () => {
    assert.deepEqual(interestGroupsQuery.parse({ interest: '  Chess ' }), { page: 1, limit: 10, interest: 'chess' });
  });

  it('rejects empty interests and unknown fields', () => {
    assert.equal(interestGroupsQuery.safeParse({ interest: '   ' }).success, false);
    assert.equal(interestGroupsQuery.safeParse({ sort: 'name' }).success, false);
  });
});
