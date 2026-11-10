/**
 * Identifies an image from its bytes (never from the file name or the client's MIME type)
 * and reads its dimensions. Supports PNG, JPEG, GIF and WebP. No image decoding happens,
 * so a malicious file cannot exploit an image library.
 */

/** Largest width or height accepted, to reject absurd or corrupt headers. */
const MAX_DIMENSION = 20000;

const TYPES = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

/** PNG: fixed signature, then the IHDR chunk holds width and height. */
function readPng(buf) {
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== signature || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF: "GIF87a" or "GIF89a", then the logical screen size. */
function readGif(buf) {
  const header = buf.toString('ascii', 0, 6);
  if (buf.length < 10 || (header !== 'GIF87a' && header !== 'GIF89a')) return null;
  return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk. */
function readWebp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [buf[21], buf[22], buf[23], buf[24]];
    return {
      type: 'webp',
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

/** Start-of-frame markers that carry the image size in a JPEG. */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** JPEG: walk the marker segments until a start-of-frame marker. */
function readJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length
      continue;
    }
    if (JPEG_SOF.has(marker)) {
      return { type: 'jpeg', height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/**
 * Detects a supported image and its size from the file's bytes.
 *
 * @param {Buffer} buffer - Uploaded file contents.
 * @returns {{ type: string, mime: string, ext: string, width: number, height: number } | null}
 *   Image details, or null if the bytes are not a valid PNG, JPEG, GIF or WebP image.
 */
export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  let info = null;
  try {
    info = readPng(buffer) ?? readGif(buffer) ?? readWebp(buffer) ?? readJpeg(buffer);
  } catch {
    return null; // truncated or corrupt header
  }
  if (!info) return null;
  const { width, height } = info;
  if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) return null;
  return { ...info, ...TYPES[info.type] };
}
