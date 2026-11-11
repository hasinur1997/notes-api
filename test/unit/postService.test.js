import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFeedPipeline, buildUserPostsPipeline, toPublicAuthor } from '../../src/services/postService.js';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('buildUserPostsPipeline (Scenario 2)', () => {
  const pipeline = buildUserPostsPipeline(USER_ID, { skip: 20, limit: 10 });

  it('matches the user by _id first, then projects public fields only', () => {
    assert.equal(String(pipeline[0].$match._id), USER_ID);
    assert.deepEqual(pipeline[1], { $project: { name: 1, interests: 1, avatar: 1, createdAt: 1 } });
  });

  it('looks up one page of posts newest first, and their count, on author', () => {
    const [posts, count] = pipeline.slice(2).map((stage) => stage.$lookup);
    for (const lookup of [posts, count]) {
      assert.equal(lookup.from, 'posts');
      assert.equal(lookup.localField, '_id');
      assert.equal(lookup.foreignField, 'author');
    }
    assert.deepEqual(posts.pipeline, [{ $sort: { _id: -1 } }, { $skip: 20 }, { $limit: 10 }]);
    assert.deepEqual(count.pipeline, [{ $count: 'total' }]);
    assert.equal(pipeline.length, 4);
  });
});

describe('buildFeedPipeline', () => {
  it('pages by _id before looking up authors', () => {
    const stages = buildFeedPipeline({ skip: 10, limit: 5 });
    assert.deepEqual(stages.slice(0, 3), [{ $sort: { _id: -1 } }, { $skip: 10 }, { $limit: 5 }]);
    assert.equal(stages[3].$lookup.from, 'users');
  });
});

describe('toPublicAuthor', () => {
  it('keeps only the name and photo URL/size', () => {
    const author = toPublicAuthor({
      _id: USER_ID,
      name: 'Ann',
      email: 'ann@example.com',
      avatar: { url: '/a.png', publicId: 'secret', width: 1, height: 1 },
    });
    assert.deepEqual(author, { _id: USER_ID, name: 'Ann', avatar: { url: '/a.png', width: 1, height: 1 } });
  });
});
