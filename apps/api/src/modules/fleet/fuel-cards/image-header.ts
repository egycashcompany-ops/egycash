// An image's type and pixel size, read from its HEADER BYTES only — pure, no decoding, no
// dependency. The fuel card thumbnail (6d) is checked with it: the server must know a thumbnail is
// small without ever decoding an image (no image library is a dependency of the API).
//
//   JPEG — the markers are walked to the first frame header (SOF0–SOF15, except DHT C4, JPG C8 and
//          DAC CC, which share the range); its height and width are the frame's.
//   PNG  — the signature, then the IHDR chunk's width and height.
//   WebP — RIFF/WEBP with a VP8 (lossy), VP8L (lossless) or VP8X (extended) first chunk.
// Anything else — or a header cut short — is `null`.

export interface ImageHeader {
  type: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
}

const MIME: Record<ImageHeader['type'], string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The MIME type a header names — taken from the bytes, never from the client. */
export const mimeOfHeader = (header: ImageHeader): string => MIME[header.type];

const jpegHeader = (buf: Buffer): ImageHeader | null => {
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1] as number;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers without a length: TEM, RST0–7. SOI again or EOI before a frame: not an image.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9) return null;
    const length = buf.readUInt16BE(at + 2);
    if (length < 2) return null;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > buf.length) return null;
      const height = buf.readUInt16BE(at + 5);
      const width = buf.readUInt16BE(at + 7);
      return width > 0 && height > 0 ? { type: 'jpeg', width, height } : null;
    }
    at += 2 + length;
  }
  return null;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const pngHeader = (buf: Buffer): ImageHeader | null => {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { type: 'png', width, height } : null;
};

const webpHeader = (buf: Buffer): ImageHeader | null => {
  if (buf.length < 30) return null;
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // A key frame's start code, then 14-bit width and height.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { type: 'webp', width, height } : null;
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (buf.readUIntLE(24, 3) as number);
    const height = 1 + (buf.readUIntLE(27, 3) as number);
    return { type: 'webp', width, height };
  }
  return null;
};

/** The image's type and size from its first bytes; `null` when it is none of the three. */
export const imageHeader = (buf: Buffer): ImageHeader | null => {
  try {
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return jpegHeader(buf);
    }
    if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return pngHeader(buf);
    if (
      buf.length >= 12 &&
      buf.toString('latin1', 0, 4) === 'RIFF' &&
      buf.toString('latin1', 8, 12) === 'WEBP'
    ) {
      return webpHeader(buf);
    }
    return null;
  } catch {
    // A read past the end of a buffer cut short.
    return null;
  }
};
