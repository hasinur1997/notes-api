import '../helpers/setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectImage } from '../../src/utils/imageInfo.js';
import { GIF_4X5, JPEG_3X2, PNG_1X1, WEBP_7X9 } from '../helpers/images.js';

describe('detectImage', () => {
  it('identifies PNG, JPEG, GIF and WebP from their bytes and reads the size', () => {
    assert.deepEqual(detectImage(PNG_1X1), { type: 'png', mime: 'image/png', ext: 'png', width: 1, height: 1 });
    assert.deepEqual(detectImage(JPEG_3X2), { type: 'jpeg', mime: 'image/jpeg', ext: 'jpg', width: 3, height: 2 });
    assert.deepEqual(detectImage(GIF_4X5), { type: 'gif', mime: 'image/gif', ext: 'gif', width: 4, height: 5 });
    assert.deepEqual(detectImage(WEBP_7X9), { type: 'webp', mime: 'image/webp', ext: 'webp', width: 7, height: 9 });
  });

  it('rejects files that only pretend to be images', () => {
    assert.equal(detectImage(Buffer.from('<svg onload="alert(1)"></svg>')), null);
    assert.equal(detectImage(Buffer.from('89504e470d0a1a0a', 'hex')), null); // PNG signature, no header
    assert.equal(detectImage(Buffer.from('GIF89a')), null);
    assert.equal(detectImage(Buffer.alloc(0)), null);
    assert.equal(detectImage('not a buffer'), null);
  });

  it('rejects zero or absurd dimensions', () => {
    const zero = Buffer.from(GIF_4X5);
    zero.writeUInt16LE(0, 6);
    assert.equal(detectImage(zero), null);
    const huge = Buffer.from(PNG_1X1);
    huge.writeUInt32BE(50000, 16);
    assert.equal(detectImage(huge), null);
  });
});
