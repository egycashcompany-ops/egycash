// The row of column filters under a table's head (2026-11-02, «فلتر لكل عمود»). These pin the
// matching rules every table with the row shares:
//
//   · a box keeps the rows whose cell contains what was typed, matched the way every search box in
//     the app matches — hamza forms, ى/ي, ة/ه, and Arabic or Latin digits are one;
//   · several words in one box must all appear in that cell, in any order;
//   · the boxes add up: a row stays only if every box that holds something matches;
//   · an empty box, or one of spaces and punctuation only, narrows nothing;
//   · a box for a column the table does not have is ignored rather than emptying the table.
//
// Every code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  activeColumnFilters,
  cellMatches,
  filterRowsByColumns,
  filterWords,
  hasColumnFilters,
} from './column-filter';

type Row = { id: string; bank: string; code: string; name: string; area: string; taken: string };
const ROWS: Row[] = [
  {
    id: 'a',
    bank: 'بنك مصر',
    code: '70493',
    name: 'SYN الإسماعيلية',
    area: 'الدقي',
    taken: '3h : 05m',
  },
  { id: 'b', bank: 'NBE', code: '70492', name: 'SYN سموحة', area: 'زايد', taken: '0h : 40m' },
  {
    id: 'c',
    bank: 'مصر - بنك',
    code: '71210',
    name: 'SYN المعادي',
    area: 'الدقي',
    taken: '12h : 05m',
  },
];
const textOf = (row: Row, key: string): string | null =>
  key in row && key !== 'id' ? (row[key as keyof Row] as string) : null;
const ids = (values: Record<string, string>): string[] =>
  filterRowsByColumns(ROWS, values, textOf).map((row) => row.id);

describe('what one box matches', () => {
  it('a cell containing the text, in any case', () => {
    expect(ids({ code: '7049' })).toEqual(['a', 'b']);
    expect(ids({ bank: 'nbe' })).toEqual(['b']);
  });

  it('Arabic digits are the same number, and its separators the same marks', () => {
    expect(ids({ code: '٧١٢' })).toEqual(['c']);
    const amounts = [{ id: 'x', total: '١٬٢٥٠٫٥٠ ج.م' }];
    const keep = (typed: string): number =>
      filterRowsByColumns(amounts, { total: typed }, (row, key) =>
        key === 'total' ? row.total : null,
      ).length;
    expect(keep('1,250.50')).toBe(1);
    // Typed without the thousands mark, as people type amounts: found all the same.
    expect(keep('1250')).toBe(1);
    expect(keep('١٢٥٠٫٥')).toBe(1);
    expect(keep('1,25')).toBe(1);
    expect(keep('2501')).toBe(0);
  });

  it('hamza forms and ة/ه are one — «الاسماعيليه» finds «الإسماعيلية»', () => {
    expect(ids({ name: 'الاسماعيليه' })).toEqual(['a']);
  });

  it('several words must all be in the cell, in any order', () => {
    expect(ids({ bank: 'بنك مصر' })).toEqual(['a', 'c']);
    expect(ids({ bank: 'مصر بنك' })).toEqual(['a', 'c']);
    expect(ids({ bank: 'بنك القاهرة' })).toEqual([]);
    // Punctuation in the cell is not in the way: «3h 05m» finds «3h : 05m».
    expect(ids({ taken: '3h 05m' })).toEqual(['a']);
  });

  it('keeps the punctuation it shows: «2/11» finds 02/11, never 21/10 — the RLM between ignored', () => {
    // As an Arabic date renders: digits, a right-to-left mark after each part, «/» between.
    const dates = [
      { id: 'nov2', at: '٠٢\u200F/١١\u200F/٢٠٢٦، ١٠:٣٠ ص' },
      { id: 'oct21', at: '٢١\u200F/١٠\u200F/٢٠٢٦، ١١:٣٠ ص' },
      { id: 'dec1', at: '٠١\u200F/١٢\u200F/٢٠٢٦، ٠٩:٠٠ ص' },
    ];
    const kept = (typed: string): string[] =>
      filterRowsByColumns(dates, { at: typed }, (row, key) => (key === 'at' ? row.at : null)).map(
        (row) => row.id,
      );
    expect(kept('2/11')).toEqual(['nov2']);
    expect(kept('1/12')).toEqual(['dec1']);
    // With the separators dropped, as `fold` drops them, «2/11» would be «211» and keep 21/10 too.
    expect(kept('12/11')).toEqual([]);
    expect(kept('١٠:٣٠')).toEqual(['nov2']);
    expect(kept('2026 ص')).toEqual(['nov2', 'oct21', 'dec1']);
  });

  it('an empty box, or one of spaces or punctuation only, narrows nothing', () => {
    expect(ids({ code: '' })).toEqual(['a', 'b', 'c']);
    expect(ids({ code: '   ' })).toEqual(['a', 'b', 'c']);
    expect(ids({ code: ' - : ' })).toEqual(['a', 'b', 'c']);
    expect(filterWords(' - : ')).toEqual([]);
    expect(cellMatches('anything', [])).toBe(true);
  });
});

describe('the boxes together', () => {
  it('add up: every box that holds something must match its own column', () => {
    expect(ids({ area: 'دقي' })).toEqual(['a', 'c']);
    expect(ids({ area: 'دقي', code: '704' })).toEqual(['a']);
    expect(ids({ area: 'زايد', code: '712' })).toEqual([]);
  });

  it('match a column on its own text only — the code box never matches the name', () => {
    expect(ids({ code: 'سموحة' })).toEqual([]);
  });

  it('ignore a box for a column the table does not have', () => {
    expect(ids({ nope: 'x', code: '7049' })).toEqual(['a', 'b']);
  });

  it('say which boxes narrow the table, trimmed, with their words', () => {
    expect(activeColumnFilters({ code: ' 70 ', name: '', area: ' : ' })).toEqual([
      { key: 'code', typed: '70', words: ['70'] },
    ]);
    expect(hasColumnFilters({ name: '', area: '  ' })).toBe(false);
    expect(hasColumnFilters({ name: 'x' })).toBe(true);
  });

  it('keep the rows in the order they came, and never change the input', () => {
    const before = ROWS.map((row) => row.id);
    expect(ids({ area: 'دقي' })).toEqual(['a', 'c']);
    expect(ROWS.map((row) => row.id)).toEqual(before);
    expect(filterRowsByColumns(ROWS, {}, textOf)).not.toBe(ROWS);
  });
});
