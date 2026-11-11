// «أ اعمل الأسهم» — the filter row's ‹ › arrows: when they show, which one is spent, and which way
// a click moves the row, in a right-to-left row (the app) and a left-to-right one (English).
import { describe, expect, it } from 'vitest';
import { ROW_FITS, ROW_STEP_SHARE, rowEnds, rowStep, sameRowEnds } from './row-scroll';

/** A 1000px row of 1600px of chips, `scrollLeft` as the browser reports it. */
const row = (scrollLeft: number, clientWidth = 1000, scrollWidth = 1600) => ({
  scrollLeft,
  clientWidth,
  scrollWidth,
});

describe('rowEnds — whether the arrows show', () => {
  it('shows none while the chips fit, and none within a pixel of fitting', () => {
    expect(rowEnds(row(0, 1000, 1000))).toEqual(ROW_FITS);
    expect(rowEnds(row(0, 1000, 1001)), 'a rounding pixel is not an overflow').toEqual(ROW_FITS);
    expect(rowEnds(row(0, 1000, 1002)).overflowing).toBe(true);
  });

  it('measures the overflow against the room WITHOUT the arrows', () => {
    // The arrows narrow the scroller to 928px: 960px of chips overflow it, but fit the row's
    // 1000px frame once the arrows are gone — so the arrows go, and nothing flickers.
    expect(rowEnds(row(0, 928, 960), 1000)).toEqual(ROW_FITS);
    expect(rowEnds(row(0, 928, 1002), 1000).overflowing).toBe(true);
    expect(rowEnds(row(0, 928, 1001), 1000).overflowing).toBe(false);
  });
});

describe('rowEnds — right to left (scrollLeft 0 at the start, negative toward the end)', () => {
  it('at the start: the start arrow spent, the end arrow live', () => {
    expect(rowEnds(row(0))).toEqual({ overflowing: true, atStart: true, atEnd: false });
  });

  it('in the middle: both live', () => {
    expect(rowEnds(row(-300))).toEqual({ overflowing: true, atStart: false, atEnd: false });
  });

  it('at the end: the end arrow spent, the start arrow live', () => {
    expect(rowEnds(row(-600))).toEqual({ overflowing: true, atStart: false, atEnd: true });
  });

  it('reads a fraction of a pixel off either end as that end', () => {
    expect(rowEnds(row(-0.6)).atStart, 'a zoomed screen').toBe(true);
    expect(rowEnds(row(-1)).atStart).toBe(true);
    expect(rowEnds(row(-1.5)).atStart).toBe(false);
    expect(rowEnds(row(-599.4)).atEnd).toBe(true);
    expect(rowEnds(row(-599)).atEnd).toBe(true);
    expect(rowEnds(row(-598.5)).atEnd).toBe(false);
  });
});

describe('rowEnds — left to right (scrollLeft 0 at the start, positive toward the end)', () => {
  it('at the start, in the middle, at the end', () => {
    expect(rowEnds(row(0))).toEqual({ overflowing: true, atStart: true, atEnd: false });
    expect(rowEnds(row(300))).toEqual({ overflowing: true, atStart: false, atEnd: false });
    expect(rowEnds(row(600))).toEqual({ overflowing: true, atStart: false, atEnd: true });
  });

  it('reads a fraction of a pixel off either end as that end', () => {
    expect(rowEnds(row(0.6)).atStart).toBe(true);
    expect(rowEnds(row(1.5)).atStart).toBe(false);
    expect(rowEnds(row(599.4)).atEnd).toBe(true);
    expect(rowEnds(row(598.5)).atEnd).toBe(false);
  });
});

describe('sameRowEnds', () => {
  it('tells a scroll that crossed an end from one that did not', () => {
    expect(sameRowEnds(rowEnds(row(-200)), rowEnds(row(-300)))).toBe(true);
    expect(sameRowEnds(rowEnds(row(0)), rowEnds(row(-300)))).toBe(false);
    expect(sameRowEnds(rowEnds(row(-600)), rowEnds(row(-300)))).toBe(false);
    expect(sameRowEnds(ROW_FITS, rowEnds(row(0)))).toBe(false);
  });
});

describe('rowStep — one click', () => {
  it('moves about 80% of the visible width, rounded to a whole pixel', () => {
    expect(ROW_STEP_SHARE).toBe(0.8);
    expect(Math.abs(rowStep('end', 'rtl', 1000, false).left)).toBe(800);
    expect(Math.abs(rowStep('end', 'rtl', 1001, false).left)).toBe(801);
    expect(Math.abs(rowStep('end', 'rtl', 0, false).left), 'never a click that does nothing').toBe(
      1,
    );
  });

  it('right to left: toward the end is negative, toward the start positive', () => {
    expect(rowStep('end', 'rtl', 1000, false).left).toBe(-800);
    expect(rowStep('start', 'rtl', 1000, false).left).toBe(800);
  });

  it('left to right: toward the end is positive, toward the start negative', () => {
    expect(rowStep('end', 'ltr', 1000, false).left).toBe(800);
    expect(rowStep('start', 'ltr', 1000, false).left).toBe(-800);
  });

  it('glides, unless the reader asked for less motion — then it jumps', () => {
    expect(rowStep('end', 'rtl', 1000, false).behavior).toBe('smooth');
    expect(rowStep('end', 'rtl', 1000, true).behavior).toBe('instant');
  });

  it('walks a right-to-left row from its start to its end and back', () => {
    // 1600px of chips in 1000px: one click reaches the end (the browser clamps), one comes back.
    const max = 1600 - 1000;
    const clamp = (left: number): number => Math.min(0, Math.max(-max, left));
    let at = 0;
    at = clamp(at + rowStep('end', 'rtl', 1000, false).left);
    expect(rowEnds(row(at))).toEqual({ overflowing: true, atStart: false, atEnd: true });
    at = clamp(at + rowStep('start', 'rtl', 1000, false).left);
    expect(rowEnds(row(at))).toEqual({ overflowing: true, atStart: true, atEnd: false });
  });
});
