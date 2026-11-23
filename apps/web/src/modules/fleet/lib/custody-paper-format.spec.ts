// His numbers and dates, as his Excel memos and Word letters write them — pinned one format at a
// time, because a grouping comma or a «٬» in the wrong place is a paper that is not his. Every figure
// is in Latin digits 0-9, the Word letters' too (owner, 2026-11-23: «اى ارقام بالانجلش»).
import { describe, expect, it } from 'vitest';
import {
  TATWEEL,
  dMy,
  dayOf,
  esc,
  fixed2,
  general,
  grouped,
  latin2,
  r2,
  tatweelDate,
} from './custody-paper-format';

describe('the Excel memos: Latin digits in Excel’s own formats', () => {
  it('«General» — no grouping, no trailing zeros, never a float’s tail', () => {
    expect(general(5230)).toBe('5230');
    expect(general(40)).toBe('40');
    expect(general(12.5)).toBe('12.5');
    expect(general(0.1 + 0.2)).toBe('0.3');
    expect(r2(0.1 + 0.2)).toBe(0.3);
  });

  it('«0.00» — two decimals, no comma', () => {
    expect(fixed2(5720)).toBe('5720.00');
    expect(fixed2(12500)).toBe('12500.00');
  });

  it('«#,##0» — grouped, and «#,##0.00» only when there are piastres', () => {
    expect(grouped(50109)).toBe('50,109');
    expect(grouped(49844)).toBe('49,844');
    expect(grouped(1234.5)).toBe('1,234.50');
  });

  it('his fuel dates: day/month/year with no leading zeros', () => {
    expect(dMy('2026-08-23')).toBe('23/8/2026');
    expect(dMy('2026-09-01')).toBe('1/9/2026');
  });
});

describe('the Word letters: Latin digits — never Intl’s «٬»', () => {
  it('amounts: Latin digits, a Latin comma between thousands, «.» before piastres only when any', () => {
    expect(grouped(81908)).toBe('81,908');
    expect(grouped(100000)).toBe('100,000');
    expect(grouped(124139.46)).toBe('124,139.46');
    for (const value of [81908, 100000, 124139.46, 1234567.5]) {
      expect(grouped(value), String(value)).not.toMatch(/[٠-٩٫٬]/u);
    }
  });

  it('the settle letter’s table: Latin, always two decimals', () => {
    expect(latin2(39732.19)).toBe('39,732.19');
    expect(latin2(124139.46)).toBe('124,139.46');
    expect(latin2(5000)).toBe('5,000.00');
  });

  it('his period dates: Latin parts joined by a tatweel drawn on the baseline', () => {
    const tw = `<span class="tw">${TATWEEL}</span>`;
    expect(TATWEEL).toBe('ـ');
    expect(tatweelDate('2026-09-01', true)).toBe(`01${tw}09${tw}2026`);
    expect(tatweelDate('2026-09-01', false)).toBe(`1${tw}09${tw}2026`);
    expect(tatweelDate('2026-09-30', false)).toBe(`30${tw}09${tw}2026`);
  });
});

describe('the rest', () => {
  it('escapes every character HTML would read', () => {
    expect(esc('<b>"x" & y</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  });

  it('reads the day out of a wire date, a day already or a full ISO string', () => {
    expect(dayOf('2026-09-01')).toBe('2026-09-01');
    expect(dayOf('2026-09-01T00:00:00.000Z')).toBe('2026-09-01');
  });
});
