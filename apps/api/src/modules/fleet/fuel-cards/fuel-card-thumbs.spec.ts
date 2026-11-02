// Every go-live card photo has its committed thumbnail and every thumbnail its photo; the manifest
// names each source by size and SHA-256; every thumbnail is small. And a browser's thumbnail is
// checked from its header alone.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  FLEET_FUEL_CARD_THUMB_MAX_BYTES,
  FLEET_FUEL_CARD_THUMB_MAX_SIDE,
} from '@ecms/contracts';
import {
  goLiveThumbOf,
  goLiveThumbs,
  hasThumb,
  validateThumb,
  type FuelCardThumbManifest,
} from './fuel-card-thumbs';
import { imageHeader } from './image-header';

const goLive = join(dirname(fileURLToPath(import.meta.url)), '../../../../assets/fleet-go-live');
const photos = join(goLive, 'fuel-card-photos');
const thumbs = join(goLive, 'fuel-card-photo-thumbs');
const manifest = JSON.parse(
  readFileSync(join(thumbs, 'manifest.json'), 'utf8'),
) as FuelCardThumbManifest;
const sha256 = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

describe('the go-live thumbnails', () => {
  it('one per photo, and nothing else', () => {
    const photoNames = readdirSync(photos).sort();
    const thumbNames = readdirSync(thumbs)
      .filter((name) => name !== 'manifest.json')
      .sort();
    expect(photoNames.length).toBe(406);
    expect(thumbNames).toEqual(photoNames);
    expect(Object.keys(manifest.files).sort()).toEqual(photoNames);
    expect(manifest.params).toContain('-blur 0x1.2');
  });

  it('the manifest names each source exactly; each thumbnail is small, by its own header', () => {
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect(statSync(join(photos, name)).size, name).toBe(entry.sourceBytes);
      expect(sha256(join(photos, name)), name).toBe(entry.sourceSha256);
      const thumb = readFileSync(join(thumbs, name));
      expect(thumb.byteLength, name).toBe(entry.thumbBytes);
      expect(thumb.byteLength, name).toBeLessThanOrEqual(FLEET_FUEL_CARD_THUMB_MAX_BYTES);
      const header = imageHeader(thumb);
      expect(header, name).toEqual({ type: 'jpeg', width: entry.width, height: entry.height });
      expect(Math.max(entry.width, entry.height), name).toBe(FLEET_FUEL_CARD_THUMB_MAX_SIDE);
      // The thumbnail passes the same check a browser's does.
      expect(() => validateThumb(thumb), name).not.toThrow();
    }
  });

  it('a card photo has the committed thumbnail only when it IS that go-live photo', () => {
    const [name, entry] = Object.entries(manifest.files)[0] as [string, { sourceBytes: number }];
    expect(goLiveThumbs().files.size).toBe(406);
    expect(goLiveThumbOf({ fileName: name, size: entry.sourceBytes })).toBe(join(thumbs, name));
    expect(goLiveThumbOf({ fileName: name, size: entry.sourceBytes + 1 })).toBeNull();
    expect(goLiveThumbOf({ fileName: 'IMG_0001.jpg', size: entry.sourceBytes })).toBeNull();
    expect(goLiveThumbOf({ fileName: '../fuel-cards-2026-10-04.json', size: 1 })).toBeNull();
    expect(goLiveThumbOf(null)).toBeNull();
    expect(hasThumb({ fileName: name, size: entry.sourceBytes })).toBe(true);
    expect(hasThumb({ fileName: 'x.jpg', size: 1 })).toBe(false);
    expect(hasThumb({ fileName: 'x.jpg', size: 1, thumb: { size: 9 } as never })).toBe(true);
    expect(hasThumb(null)).toBe(false);
  });
});

describe('a thumbnail the browser sent', () => {
  const refusal = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      const e = error as { code: string; httpStatus: number; details?: { code: string }[] };
      return [e.code, e.httpStatus, e.details?.[0]?.code];
    }
    return null;
  };
  const png = (width: number, height: number): Buffer => {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  };

  it('takes its type from the bytes, never from the client', () => {
    expect(validateThumb(png(160, 90))).toEqual({ mime: 'image/png', width: 160, height: 90 });
  });

  it('refuses another type, a larger picture, more bytes — 422 FLEET_FUEL_CARD_THUMB_INVALID', () => {
    const code = ErrorCodes.FLEET_FUEL_CARD_THUMB_INVALID;
    expect(refusal(() => validateThumb(Buffer.from('GIF89a and more bytes here')))).toEqual([
      code,
      422,
      'TYPE',
    ]);
    expect(refusal(() => validateThumb(png(161, 90)))).toEqual([code, 422, 'SIZE']);
    expect(refusal(() => validateThumb(png(90, 1100)))).toEqual([code, 422, 'SIZE']);
    const big = Buffer.concat([png(100, 100), Buffer.alloc(FLEET_FUEL_CARD_THUMB_MAX_BYTES)]);
    expect(refusal(() => validateThumb(big))).toEqual([code, 422, 'BYTES']);
    // A full-size photo is refused as a thumbnail.
    expect(
      refusal(() =>
        validateThumb(readFileSync(join(photos, Object.keys(manifest.files)[0] as string))),
      ),
    ).not.toBeNull();
  });
});
