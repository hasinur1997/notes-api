/**
 * Tiny but valid image files for upload tests.
 */

/** A valid 1x1 PNG (transparent pixel). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** A minimal JPEG header with a 3x2 start-of-frame marker. */
export const JPEG_3X2 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

/** A GIF89a header for a 4x5 image. */
export const GIF_4X5 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x04, 0x00, 0x05, 0x00, 0x80, 0x00, 0x00]);

/** A lossless WebP (VP8L) header for a 7x9 image. */
export const WEBP_7X9 = (() => {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[20] = 0x2f;
  const w = 7 - 1;
  const h = 9 - 1;
  const bits = w | (h << 14);
  buf.writeUInt32LE(bits, 21);
  return buf;
})();
