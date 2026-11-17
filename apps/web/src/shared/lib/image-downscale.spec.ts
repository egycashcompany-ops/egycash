// `fitWithin` — the size a phone photo is drawn at before it goes up (it-vehicle-checks-design.md
// §6.3). `downscaleToJpeg` needs a canvas and `createImageBitmap`, which the node test environment
// has neither of; its one rule with arithmetic in it is this one.
import { describe, expect, it } from 'vitest';
import { downscaleToJpeg, fitWithin } from './image-downscale';

describe('fitWithin', () => {
  it('brings the longest side to the max', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('keeps the ratio', () => {
    const size = fitWithin(4032, 1816, 1600);
    expect(size?.width).toBe(1600);
    expect(size?.height).toBe(Math.round(1816 * (1600 / 4032)));
    expect((size?.width ?? 0) / (size?.height ?? 1)).toBeCloseTo(4032 / 1816, 2);
  });

  it('never enlarges a photo already small enough', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('gives every side at least one pixel', () => {
    expect(fitWithin(100_000, 3, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(2, 50_000, 1600)).toEqual({ width: 1, height: 1600 });
  });

  it('gives null for a photo with no size', () => {
    expect(fitWithin(0, 300, 1600)).toBeNull();
    expect(fitWithin(300, -1, 1600)).toBeNull();
    expect(fitWithin(Number.NaN, 300, 1600)).toBeNull();
  });
});

describe('downscaleToJpeg', () => {
  it('answers null where nothing can decode the photo, so the caller decides', async () => {
    // Node has no `createImageBitmap` and no `document`: the same answer as a browser that cannot
    // read a HEIC.
    await expect(downscaleToJpeg(new Blob(['x'], { type: 'image/heic' }))).resolves.toBeNull();
  });
});
