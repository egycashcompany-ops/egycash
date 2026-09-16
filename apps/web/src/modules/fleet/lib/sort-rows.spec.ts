// The rule three Fleet boards are ordered by, as arithmetic.
//
// Each of the three holds every row it reports on, so this really is the whole order — not one
// page of it. What is pinned here is the part that is easy to get wrong in either direction: a
// missing value, a second column, and Arabic.
import { describe, expect, it } from 'vitest';
import { compare, sortRows } from './sort-rows';

interface Row {
  code: string;
  remaining: number | null;
  level: string;
}

const ROWS: Row[] = [
  { code: '152', remaining: 500, level: 'yellow' },
  { code: '150', remaining: null, level: 'red' },
  { code: '151', remaining: 500, level: 'red' },
  { code: '149', remaining: -200, level: 'red' },
];

const value = (row: Row, key: string): string | number | null =>
  key === 'code' ? row.code : key === 'remaining' ? row.remaining : key === 'level' ? row.level : null;
const codes = (rows: Row[]): string[] => rows.map((r) => r.code);

describe('compare — what a missing value is worth', () => {
  it('answers LAST for nothing, whichever way the arrow points', () => {
    expect(compare(null, 5)).toBe(Number.POSITIVE_INFINITY);
    expect(compare(5, null)).toBe(Number.NEGATIVE_INFINITY);
    expect(compare(null, null)).toBe(0);
  });

  it('compares numbers as numbers, not as text', () => {
    // `'10' < '9'` as text, which on «المتبقي» would put a car 10km from service after one 9km
    // from it — the two rows a reader is deciding between.
    expect(compare(10, 9)).toBeGreaterThan(0);
  });

  it('compares words as words — Arabic included', () => {
    expect(compare('أحمد', 'محمد')).toBeLessThan(0);
    expect(compare('محمد', 'أحمد')).toBeGreaterThan(0);
  });
});

describe('sortRows', () => {
  it('orders by the one column asked for', () => {
    expect(codes(sortRows(ROWS, [{ by: 'code', dir: 'asc' }], value))).toEqual([
      '149',
      '150',
      '151',
      '152',
    ]);
  });

  it('turns the whole order round, except for what is missing', () => {
    // «المتبقي» descending: the largest first, and the car with no figure still last — it is not
    // the smallest remaining distance, it is no distance at all.
    expect(codes(sortRows(ROWS, [{ by: 'remaining', dir: 'desc' }], value))).toEqual([
      '152',
      '151',
      '149',
      '150',
    ]);
    expect(codes(sortRows(ROWS, [{ by: 'remaining', dir: 'asc' }], value)).at(-1)).toBe('150');
  });

  it('lets a SECOND column break the first one’s ties', () => {
    // Two cars 500km from service: the second column decides which is first, and reversing it
    // swaps exactly those two and nothing else.
    expect(codes(sortRows(ROWS, [
      { by: 'remaining', dir: 'desc' },
      { by: 'code', dir: 'asc' },
    ], value)).slice(0, 2)).toEqual(['151', '152']);
    expect(codes(sortRows(ROWS, [
      { by: 'remaining', dir: 'desc' },
      { by: 'code', dir: 'desc' },
    ], value)).slice(0, 2)).toEqual(['152', '151']);
  });

  it('keeps the board’s OWN order for rows the reader’s columns cannot separate', () => {
    // Without this a board re-sorts differently on every render and rows swap while being read.
    const byCode = (a: Row, b: Row): number => a.code.localeCompare(b.code);
    expect(codes(sortRows(ROWS, [{ by: 'level', dir: 'asc' }], value, byCode))).toEqual([
      '149',
      '150',
      '151',
      '152',
    ]);
  });

  it('leaves the board alone when nothing is sorted, and when the column is nonsense', () => {
    expect(codes(sortRows(ROWS, [], value))).toEqual(codes(ROWS));
    expect(codes(sortRows(ROWS, [{ by: 'nonsense', dir: 'asc' }], value))).toEqual(codes(ROWS));
  });

  it('does not rewrite the array it was given', () => {
    const rows = [...ROWS];
    sortRows(rows, [{ by: 'code', dir: 'asc' }], value);
    expect(codes(rows)).toEqual(codes(ROWS));
  });
});
