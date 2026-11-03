// The card photo's thumbnail (6d): its size rule, the parameters it shares with the committed go-live
// thumbnails (the contract's constants, never literals), and — in a place with no browser image
// support — no thumbnail at all, so the photo goes up without one rather than failing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLEET_FUEL_CARD_THUMB_BLUR_PX,
  FLEET_FUEL_CARD_THUMB_JPEG_QUALITY,
  FLEET_FUEL_CARD_THUMB_MAX_BYTES,
  FLEET_FUEL_CARD_THUMB_MAX_SIDE,
} from '@ecms/contracts';
import { FALLBACK_SIDE, THUMB_QUALITIES, makeFuelCardThumb, thumbSize } from './fuel-card-thumb';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('thumbSize', () => {
  it('brings the longer side down to 160 px, the shorter in proportion', () => {
    expect(FLEET_FUEL_CARD_THUMB_MAX_SIDE).toBe(160);
    expect(thumbSize(1100, 700)).toEqual({ width: 160, height: 102 });
    expect(thumbSize(700, 1100)).toEqual({ width: 102, height: 160 });
    expect(thumbSize(4000, 3000)).toEqual({ width: 160, height: 120 });
  });
  it('never enlarges a small photo, and keeps at least one pixel', () => {
    expect(thumbSize(120, 80)).toEqual({ width: 120, height: 80 });
    expect(thumbSize(5000, 10)).toEqual({ width: 160, height: 1 });
  });
  it('gives nothing for a photo with no size', () => {
    expect(thumbSize(0, 100)).toBeNull();
    expect(thumbSize(Number.NaN, 100)).toBeNull();
  });
  it('the blur fallback draws at a smaller long side', () => {
    expect(thumbSize(160, 102, FALLBACK_SIDE)).toEqual({ width: 48, height: 31 });
  });
});

describe('makeFuelCardThumb', () => {
  it('starts at the contract’s JPEG quality, and only lowers it to fit the byte cap', () => {
    expect(THUMB_QUALITIES[0]).toBe(FLEET_FUEL_CARD_THUMB_JPEG_QUALITY);
    expect([...THUMB_QUALITIES].sort((a, b) => b - a)).toEqual([...THUMB_QUALITIES]);
    expect(FLEET_FUEL_CARD_THUMB_MAX_BYTES).toBe(16 * 1024);
  });
  it('blurs by the contract’s radius and checks the contract’s byte cap — no literals', () => {
    const SOURCE = readFileSync(join(HERE, 'fuel-card-thumb.ts'), 'utf8');
    expect(SOURCE).toContain('blur(${FLEET_FUEL_CARD_THUMB_BLUR_PX}px)');
    expect(SOURCE).toContain('blob.size <= FLEET_FUEL_CARD_THUMB_MAX_BYTES');
    expect(SOURCE).toContain("'image/jpeg'");
    expect(FLEET_FUEL_CARD_THUMB_BLUR_PX).toBeGreaterThan(0);
  });
  it('gives `null` where the browser cannot make one — the photo goes up without it', async () => {
    expect(await makeFuelCardThumb(new Blob(['not an image'], { type: 'image/jpeg' }))).toBeNull();
  });
});
