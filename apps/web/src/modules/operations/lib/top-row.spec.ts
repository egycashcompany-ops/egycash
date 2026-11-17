// The page's top row of «توزيع المحصنات» and «تسليم المحصنات» — «عاوز اخلى التاريخ يكون مكان الاحصائيات
// والاحصائيات تكون فى النص» (Round 26b): the day at the start, the figures in the middle, the acts at
// the end.
//
// R26b critic — the row went to one line at a fixed 68rem with sides at least their own content: in
// Arabic (the day 192px, the figures 640px, the acts 249px) it needs 1162px, so from 1088 to 1161 the
// figures stood off the middle (29px) or split inside the row; and the acts dropped their words to
// hold them. The row now measures its parts and takes one line only where the figures stand exactly
// in its middle.
import { describe, expect, it } from 'vitest';
import {
  TOP_ROW_PHONE,
  TOP_ROW_SLACK,
  topRowLayout,
  topRowLineNeeds,
  type TopRowLayout,
} from './top-row';

/** The critic's measures — Arabic, «تراجع» then cut to its icon; and with every act's words. */
const AR = { day: 192, figures: 640, end: 249, gap: 12 };
const AR_WORDS = { day: 192, figures: 640, end: 300, gap: 12 };
/** «تسليم المحصنات» at 1024 in Arabic: no acts, a 904px row. */
const VAULT = { day: 192, figures: 632, end: null, gap: 12 };

/** Where the figures stand in a `line` row: their centre, against the row's. */
const offCentre = (row: number, widths: { figures: number; gap: number }): number => {
  const side = (row - widths.figures - 2 * widths.gap) / 2;
  return side + widths.gap + widths.figures / 2 - row / 2;
};

describe('the top row — one line only where the figures stand truly in the middle', () => {
  it('needs the figures and two sides as wide as the wider of the day and the acts', () => {
    expect(topRowLineNeeds(AR)).toBe(640 + 2 * 249 + 24);
    expect(topRowLineNeeds({ ...AR, end: 100 })).toBe(640 + 2 * 192 + 24);
    expect(topRowLineNeeds(VAULT)).toBe(632 + 2 * 192 + 24);
  });

  it('the critic’s 1105–1161 (Arabic): NOT one line — the figures take a centred line of their own', () => {
    // The old row was one line from 68rem (1088px) on, its figures 29px off the middle at 1225.
    for (const row of [1088, 1105, 1130, 1161, 1162 + TOP_ROW_SLACK - 1]) {
      expect(topRowLayout({ row, ...AR }), `row ${row}`).toBe('split');
    }
    expect(topRowLayout({ row: 1162 + TOP_ROW_SLACK, ...AR })).toBe('line');
  });

  it('every act keeps its words: the line waits for the room they need', () => {
    const needs = topRowLineNeeds(AR_WORDS);
    expect(topRowLayout({ row: needs - 1, ...AR_WORDS })).toBe('split');
    expect(topRowLayout({ row: needs + TOP_ROW_SLACK, ...AR_WORDS })).toBe('line');
  });

  it('on one line the figures are EXACTLY in the middle, and neither side is narrower than its part', () => {
    for (const widths of [AR, AR_WORDS, { day: 192, figures: 700, end: 420, gap: 12 }]) {
      for (let row = TOP_ROW_PHONE; row <= 2600; row += 7) {
        if (topRowLayout({ row, ...widths }) !== 'line') continue;
        expect(offCentre(row, widths)).toBe(0);
        const side = (row - widths.figures - 2 * widths.gap) / 2;
        expect(side, `row ${row}`).toBeGreaterThanOrEqual(Math.max(widths.day, widths.end));
      }
    }
  });

  it('holds its layout at the edge — no flipping as a scrollbar comes and goes', () => {
    const needs = topRowLineNeeds(AR);
    expect(topRowLayout({ row: needs, ...AR }, 'line')).toBe('line');
    expect(topRowLayout({ row: needs, ...AR }, 'split')).toBe('split');
    expect(topRowLayout({ row: needs - 1, ...AR }, 'line')).toBe('split');
  });

  it('no acts (the vault): the figures beside the day where they fit — not alone on a second line', () => {
    // The critic's 1024 Arabic: a 904px row; the day 192 and the figures 632 fit side by side.
    expect(topRowLayout({ row: 904, ...VAULT })).toBe('beside');
    expect(topRowLayout({ row: 192 + 12 + 632 - 1, ...VAULT })).toBe('split');
    expect(topRowLayout({ row: topRowLineNeeds(VAULT) + TOP_ROW_SLACK, ...VAULT })).toBe('line');
    // With acts, never `beside`: the figures would sit between the day and the acts off the middle.
    const seen = new Set<TopRowLayout>();
    for (let row = 300; row <= 2000; row += 5) seen.add(topRowLayout({ row, ...AR }));
    expect([...seen].sort()).toEqual(['line', 'split', 'stack']);
  });

  it('a phone stacks — and so does a row too narrow for the day beside the acts', () => {
    expect(topRowLayout({ row: 358, ...AR })).toBe('stack');
    expect(topRowLayout({ row: TOP_ROW_PHONE - 1, ...VAULT })).toBe('stack');
    expect(topRowLayout({ row: 600, day: 192, figures: 640, end: 420, gap: 12 })).toBe('stack');
    expect(topRowLayout({ row: 640, day: 192, figures: 640, end: 420, gap: 12 })).toBe('split');
  });
});
