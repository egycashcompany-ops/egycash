import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { imageHeader, mimeOfHeader } from './image-header';

const assets = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../assets/fleet-go-live/fuel-card-photo-thumbs',
);
const hex = (text: string): Buffer => Buffer.from(text.replace(/\s+/gu, ''), 'hex');

// The first bytes of a 37×21 PNG and of a lossy and a lossless 37×21 WebP (ImageMagick 6).
const PNG = hex('89504e470d0a1a0a 0000000d49484452 0000002500000015 0103000000fb2ab5');
const WEBP_LOSSY = hex(
  '524946464e000000 5745425056503820 4200000050030 09d012a 2500 1500 3e91469e4b25a3a2',
);
const WEBP_LOSSLESS = hex('524946461c000000 5745425056503 84c 0f0000002f240005 000710fd8ffe0722');
// An extended WebP, hand-built: canvas 160 × 120 (stored minus one, 24-bit little endian).
const WEBP_EXTENDED = Buffer.concat([
  Buffer.from('RIFF'),
  hex('2a000000'),
  Buffer.from('WEBPVP8X'),
  hex('0a000000 10000000 9f0000 770000'),
  Buffer.alloc(4),
]);

describe('imageHeader', () => {
  it('reads a committed go-live thumbnail (JPEG) — landscape and portrait', () => {
    expect(imageHeader(readFileSync(join(assets, '5485640004460487.jpg')))).toEqual({
      type: 'jpeg',
      width: 160,
      height: 97,
    });
    expect(imageHeader(readFileSync(join(assets, '5485640004700551.jpg')))).toEqual({
      type: 'jpeg',
      width: 120,
      height: 160,
    });
  });

  it('reads PNG and the three WebP forms', () => {
    expect(imageHeader(PNG)).toEqual({ type: 'png', width: 37, height: 21 });
    expect(imageHeader(WEBP_LOSSY)).toEqual({ type: 'webp', width: 37, height: 21 });
    expect(imageHeader(WEBP_LOSSLESS)).toEqual({ type: 'webp', width: 37, height: 21 });
    expect(imageHeader(WEBP_EXTENDED)).toEqual({ type: 'webp', width: 160, height: 120 });
    expect(
      ['jpeg', 'png', 'webp'].map((type) => mimeOfHeader({ type, width: 1, height: 1 } as never)),
    ).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('a JPEG frame header is found past other segments and fill bytes', () => {
    const app0 = hex('ffe0 0010 4a46494600 0101 0000010001 0000');
    const fill = hex('ffff');
    const sof2 = hex('ffc2 0011 08 0050 0040 03 012200 021101 031101');
    expect(imageHeader(Buffer.concat([hex('ffd8'), app0, fill, sof2]))).toEqual({
      type: 'jpeg',
      width: 64,
      height: 80,
    });
    // DHT (C4) shares the SOF range and is skipped, not read as a frame.
    const dht = hex('ffc4 0004 0000');
    expect(imageHeader(Buffer.concat([hex('ffd8'), dht, sof2]))).toMatchObject({ width: 64 });
  });

  it('anything else — or a header cut short — is null', () => {
    const jpeg = readFileSync(join(assets, '5485640004460487.jpg'));
    expect(imageHeader(Buffer.alloc(0))).toBeNull();
    expect(imageHeader(Buffer.from('GIF89a……………………………………………'))).toBeNull();
    expect(imageHeader(Buffer.from('%PDF-1.7 a document'))).toBeNull();
    expect(imageHeader(jpeg.subarray(0, 40))).toBeNull();
    expect(imageHeader(PNG.subarray(0, 20))).toBeNull();
    expect(imageHeader(WEBP_LOSSY.subarray(0, 24))).toBeNull();
    expect(imageHeader(hex('ffd8ffd9'))).toBeNull();
    expect(imageHeader(Buffer.concat([hex('ffd8'), hex('ffe0 0001')]))).toBeNull();
    // A zero-sized frame is not an image.
    expect(imageHeader(Buffer.concat([hex('ffd8'), hex('ffc0 0011 08 0000 0040 03')]))).toBeNull();
  });
});
