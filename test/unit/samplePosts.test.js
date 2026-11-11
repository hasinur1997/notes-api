import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Post } from '../../src/models/Post.js';
import { User } from '../../src/models/User.js';
import { SAMPLE_AUTHORS, SAMPLE_POSTS } from '../../src/services/samplePosts.js';

describe('sample posts', () => {
  const authorKeys = new Set(SAMPLE_AUTHORS.map((author) => author.key));

  it('are valid posts by known sample authors', async () => {
    for (const { author, hoursAgo, ...fields } of SAMPLE_POSTS) {
      assert.ok(authorKeys.has(author), `unknown author ${author}`);
      assert.ok(hoursAgo >= 0);
      await new Post({ ...fields, author: new User()._id }).validate();
    }
  });

  it('are listed oldest first, so insertion order matches their dates', () => {
    const hours = SAMPLE_POSTS.map((post) => post.hoursAgo);
    assert.deepEqual(hours, [...hours].sort((a, b) => b - a));
  });

  it('use example.com addresses and normalized interests for every author', () => {
    for (const author of SAMPLE_AUTHORS) {
      assert.match(author.email, /@example\.com$/);
      for (const interest of author.interests) assert.equal(interest, interest.trim().toLowerCase());
    }
  });
});
