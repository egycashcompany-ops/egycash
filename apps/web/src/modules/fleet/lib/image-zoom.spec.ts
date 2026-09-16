// The zoom, as arithmetic — what the reader sees after a wheel notch, a drag or a button.
//
// Driven as functions because that is what they are, and because the two properties that make a
// zoom feel right are both invariants rather than pixels: what is under the pointer stays under
// the pointer, and no edge of the picture ever comes inside the frame.
import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  clampScale,
  containSize,
  DOUBLE_CLICK_SCALE,
  FIT,
  isZoomed,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  toggleZoom,
  zoomAt,
  zoomByStep,
  zoomPercent,
  ZOOM_STEP,
  type ZoomSurface,
} from './image-zoom';

/** A square frame with a square picture in it: the offsets are then readable by eye. */
const SQUARE: ZoomSurface = { box: { width: 400, height: 400 }, content: { width: 400, height: 400 } };
/** A wide scan in a square frame — the letterbox case, which is what a licence actually is. */
const WIDE: ZoomSurface = { box: { width: 400, height: 400 }, content: { width: 400, height: 200 } };

const near = (value: number, expected: number, tolerance = 1e-6): void => {
  expect(Math.abs(value - expected), `${value} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
};

describe('containSize — how big the picture is at scale 1', () => {
  it('fits a wide picture by its WIDTH, leaving the box letterboxed', () => {
    expect(containSize({ width: 1000, height: 500 }, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200,
    });
  });

  it('fits a tall picture by its height', () => {
    expect(containSize({ width: 500, height: 1000 }, { width: 400, height: 400 })).toEqual({
      width: 200,
      height: 400,
    });
  });

  it('falls back to the box while the picture has not loaded — no division by zero', () => {
    // `naturalWidth` is 0 until the bytes arrive, and a NaN offset would freeze the surface.
    const box = { width: 400, height: 300 };
    expect(containSize({ width: 0, height: 0 }, box)).toEqual(box);
  });
});

describe('clampScale — one is the floor, and it is deliberate', () => {
  it('never goes below fit: there is nothing to see zoomed out of a dialog', () => {
    expect(clampScale(0.25)).toBe(MIN_SCALE);
    expect(clampScale(-3)).toBe(MIN_SCALE);
  });

  it('stops at the ceiling rather than pixelating for ever', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
  });

  it('answers with fit for a value that is not a number', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
  });
});

describe('the pan cannot lose the picture', () => {
  it('does not move at all while the whole scan is showing', () => {
    expect(panBy(FIT, 200, 200, SQUARE)).toEqual(FIT);
    expect(panBy(FIT, -999, 999, WIDE)).toEqual(FIT);
  });

  it('allows exactly the overhang and not a pixel more', () => {
    // At 2× the 400px picture is 800px in a 400px box: 200px hangs off each side.
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(panBy(zoomed, 500, 0, SQUARE).x).toBe(200);
    expect(panBy(zoomed, -500, 0, SQUARE).x).toBe(-200);
    expect(panBy(zoomed, 0, 500, SQUARE).y).toBe(200);
  });

  it('keeps a letterboxed axis centred — a wide scan does not drag up and down at 2×', () => {
    // The wide scan is 200px tall; at 2× that is 400px, exactly the box. Nothing to pan.
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(panBy(zoomed, 0, 300, WIDE).y).toBe(0);
    expect(panBy(zoomed, 300, 0, WIDE).x, 'but it still pans sideways').toBe(200);
  });

  it('pulls an already-out-of-bounds state back in', () => {
    expect(clampOffset({ scale: 2, x: 9999, y: -9999 }, SQUARE)).toEqual({ scale: 2, x: 200, y: -200 });
  });
});

describe('zoomAt — what is under the pointer stays under the pointer', () => {
  /** Where a point of the SURFACE lands after the transform. The property under test. */
  const project = (state: { scale: number; x: number; y: number }, point: number, boxSize: number): number =>
    (point - boxSize / 2 - state.x) / state.scale;

  it('holds the point the reader is pointing at, wherever it is', () => {
    for (const pointer of [0, 100, 200, 350, 400]) {
      const before = project(FIT, pointer, 400);
      const after = project(zoomAt(FIT, 2, { x: pointer, y: 200 }, SQUARE), pointer, 400);
      near(after, before, 1e-9);
    }
  });

  it('holds it through a SECOND zoom on top of the first', () => {
    const once = zoomAt(FIT, 2, { x: 300, y: 200 }, SQUARE);
    const twice = zoomAt(once, 1.5, { x: 300, y: 200 }, SQUARE);
    near(project(twice, 300, 400), project(once, 300, 400), 1e-9);
    near(twice.scale, 3);
  });

  it('refuses to zoom past the ceiling, and leaves the offset legal when it stops', () => {
    const maxed = zoomAt({ scale: MAX_SCALE, x: 0, y: 0 }, 4, { x: 0, y: 0 }, SQUARE);
    expect(maxed.scale).toBe(MAX_SCALE);
    expect(clampOffset(maxed, SQUARE)).toEqual(maxed);
  });

  it('lands exactly back at fit on the way out, with the offsets cleared', () => {
    // The offsets MUST go with it: a 1× image with a leftover offset is a scan sitting off-centre
    // in its own frame, which the clamp then has no room to correct.
    const zoomed = zoomAt(FIT, 3, { x: 40, y: 380 }, SQUARE);
    const out = zoomAt(zoomed, 1 / 3, { x: 40, y: 380 }, SQUARE);
    near(out.scale, 1);
    near(out.x, 0);
    near(out.y, 0);
  });
});

describe('the buttons', () => {
  it('step by the same multiple each way, about the middle', () => {
    const inOnce = zoomByStep(FIT, 1, SQUARE);
    near(inOnce.scale, ZOOM_STEP);
    near(inOnce.x, 0, 1e-9);
    near(zoomByStep(inOnce, -1, SQUARE).scale, 1);
  });

  it('cannot step below fit however often it is pressed', () => {
    let state = FIT;
    for (let i = 0; i < 10; i += 1) state = zoomByStep(state, -1, SQUARE);
    expect(state.scale).toBe(MIN_SCALE);
  });
});

describe('double-click', () => {
  it('goes in from fit, at the point clicked', () => {
    const zoomed = toggleZoom(FIT, { x: 100, y: 100 }, SQUARE);
    near(zoomed.scale, DOUBLE_CLICK_SCALE);
    expect(isZoomed(zoomed)).toBe(true);
  });

  it('goes all the way back out from anywhere — one gesture undoes four', () => {
    const deep = { scale: 6, x: 120, y: -80 };
    expect(toggleZoom(deep, { x: 10, y: 10 }, SQUARE)).toEqual(FIT);
  });
});

describe('what the control prints', () => {
  it('reads the scale as a percentage a reader recognizes', () => {
    expect(zoomPercent(FIT)).toBe(100);
    expect(zoomPercent({ scale: 2.5, x: 0, y: 0 })).toBe(250);
  });

  it('calls a fitted image not zoomed, float dust and all', () => {
    expect(isZoomed(FIT)).toBe(false);
    expect(isZoomed({ scale: 1 + 1e-12, x: 0, y: 0 })).toBe(false);
    expect(isZoomed({ scale: 1.01, x: 0, y: 0 })).toBe(true);
  });
});
