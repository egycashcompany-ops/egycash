import { describe, expect, it } from 'vitest';
import { PHOTO_ASPECT } from '../id-card/card-render';
import {
  clampRect,
  cropAround,
  defaultCrop,
  looksLikePage,
  resizeCrop,
  searchTiles,
} from './a4-face';

// An A4 sheet drawn at the size the cropper draws it.
const W = 1697;
const H = 2400;

describe('reading an A4 sheet for the employee photo', () => {
  it('tells a scanned page from a portrait photo', () => {
    expect(looksLikePage(W, H)).toBe(true);
    expect(looksLikePage(H, W)).toBe(true); // scanned sideways
    expect(looksLikePage(600, 760)).toBe(false); // a card photo
    expect(looksLikePage(3000, 3000)).toBe(false); // square
    expect(looksLikePage(300, 424)).toBe(false); // page-shaped, but too small to be a scan
  });

  it('searches the whole sheet first, then tiles that cover it at every size', () => {
    const tiles = searchTiles(W, H);
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: W, h: H });
    for (const parts of [2, 3, 4]) {
      const side = Math.round(W / parts);
      const ofSize = tiles.filter((t) => Math.abs(t.w - side) <= 1 && t !== tiles[0]);
      expect(ofSize.length).toBeGreaterThan(0);
      // Covers the bottom-right corner too, not only the top-left.
      expect(tiles.some((t) => t.x + t.w >= W - 1 && t.y + t.h >= H - 1 && t.w <= side)).toBe(true);
    }
    expect(tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H)).toBe(true);
  });
});

describe('the crop around the face', () => {
  const face = { x: 700, y: 500, w: 200, h: 240 };

  it('is the card frame’s shape, head and shoulders, with the face centred across', () => {
    const r = cropAround(face, W, H);
    expect(r.w / r.h).toBeCloseTo(PHOTO_ASPECT, 5);
    expect(r.h).toBeCloseTo(face.h * 2.7, 5);
    expect(r.x + r.w / 2).toBeCloseTo(face.x + face.w / 2, 5);
    // Room above the head, and the face in the upper half of the frame.
    expect(r.y).toBeLessThan(face.y);
    expect(face.y + face.h / 2 - r.y).toBeLessThan(r.h / 2);
  });

  it('stays on the sheet when the face is at its edge', () => {
    const r = cropAround({ x: 5, y: 10, w: 200, h: 240 }, W, H);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('is never larger than the sheet, even for a face that fills it', () => {
    const r = cropAround({ x: 0, y: 0, w: W, h: H }, W, H);
    expect(r.w).toBeLessThanOrEqual(W + 1e-6);
    expect(r.h).toBeLessThanOrEqual(H + 1e-6);
    expect(r.w / r.h).toBeCloseTo(PHOTO_ASPECT, 5);
  });

  it('starts in the card’s shape when no face was found', () => {
    const r = defaultCrop(W, H);
    expect(r.w / r.h).toBeCloseTo(PHOTO_ASPECT, 5);
    expect(r.x + r.w / 2).toBeCloseTo(W / 2, 5);
  });

  it('resizes about its centre, keeps its shape and stays on the sheet', () => {
    const r = cropAround(face, W, H);
    const bigger = resizeCrop(r, 1.5, W, H);
    expect(bigger.h).toBeCloseTo(r.h * 1.5, 5);
    expect(bigger.w / bigger.h).toBeCloseTo(PHOTO_ASPECT, 5);
    expect(bigger.x + bigger.w / 2).toBeCloseTo(r.x + r.w / 2, 5);
    const huge = resizeCrop(r, 100, W, H);
    expect(huge.w).toBeLessThanOrEqual(W + 1e-6);
    expect(huge.h).toBeLessThanOrEqual(H + 1e-6);
  });

  it('moves back inside the sheet without changing size', () => {
    expect(clampRect({ x: -50, y: H, w: 100, h: 120 }, W, H)).toEqual({
      x: 0,
      y: H - 120,
      w: 100,
      h: 120,
    });
  });
});

describe('a PDF photo stored in strips', () => {
  it('joins strips that touch into the one photo, and leaves apart what does not touch', async () => {
    const { mergeRects } = await import('./a4-face');
    // The sample's photo: two strips, one under the other (points), and a logo far away.
    const merged = mergeRects([
      { x: 549, y: 730.7, w: 30.6, h: 25.7 },
      { x: 549, y: 756.4, w: 30.6, h: 12.8 },
      { x: 40, y: 40, w: 80, h: 30 },
    ]);
    expect(merged).toHaveLength(2);
    const photo = merged.find((r) => r.x === 549);
    expect(photo?.y).toBeCloseTo(730.7, 5);
    expect(photo?.h).toBeCloseTo(38.5, 5);
  });

  it('searches finer, down to an eighth of the sheet, for a small photo on a scan', async () => {
    const { searchLevels } = await import('./a4-face');
    const levels = searchLevels(1240, 1754);
    expect(levels).toHaveLength(6);
    const finest = levels[5] ?? [];
    expect(finest[0]?.w).toBe(Math.round(1240 / 8));
    // The last tile reaches the bottom-right corner, where the sample's photo is.
    expect(finest.some((t) => t.x + t.w >= 1239 && t.y + t.h >= 1753)).toBe(true);
  });
});
