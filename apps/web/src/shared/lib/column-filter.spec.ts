// The row of column filters under a table's head (2026-11-02, «فلتر لكل عمود», then «لأ عايز
// الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi select»). These pin the rules every table
// with the row shares:
//
//   · a column's list holds the values its cells show — each once, alphabetical (numbers as
//     numbers), an empty cell last — from the rows the OTHER columns' picks keep;
//   · picking values in one column keeps the rows whose cell is any of them;
//   · the columns add up: a row stays only if every column with picks keeps it;
//   · a column with nothing picked narrows nothing, and a pick for a column the table does not
//     have is ignored rather than emptying the table.
//
// Every code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  activeColumnFilters,
  cellValue,
  columnFilterChoices,
  columnFilterChoicesOf,
  filterRowsByColumns,
  hasColumnFilters,
  type ColumnFilterValues,
} from './column-filter';

type Row = { id: string; bank: string; code: string; name: string; area: string; leader: string };
const ROWS: Row[] = [
  { id: 'a', bank: 'بنك مصر', code: '70493', name: 'SYN الإسماعيلية', area: 'الدقي', leader: '' },
  { id: 'b', bank: 'NBE', code: '70492', name: 'SYN سموحة', area: 'زايد', leader: 'SYN علي' },
  { id: 'c', bank: 'بنك مصر', code: '9100', name: 'SYN المعادي', area: 'الدقي', leader: 'SYN علي' },
  { id: 'd', bank: 'CIB', code: '71210', name: 'SYN  المعادي ', area: 'أكتوبر', leader: '  ' },
];
const textOf = (row: Row, key: string): string | null =>
  key in row && key !== 'id' ? (row[key as keyof Row] as string) : null;
const ids = (values: ColumnFilterValues): string[] =>
  filterRowsByColumns(ROWS, values, textOf).map((row) => row.id);
const choices = (key: string, values: ColumnFilterValues = {}): string[] =>
  columnFilterChoices(ROWS, values, key, textOf);

describe('what one column’s picks keep', () => {
  it('the rows whose cell is ANY of the picked values', () => {
    expect(ids({ bank: ['NBE'] })).toEqual(['b']);
    expect(ids({ bank: ['NBE', 'CIB'] })).toEqual(['b', 'd']);
    expect(ids({ bank: ['بنك مصر'] })).toEqual(['a', 'c']);
  });

  it('the whole cell, never a part of it — «7049» picked keeps no 70493', () => {
    expect(ids({ code: ['7049'] })).toEqual([]);
    expect(ids({ code: ['70493'] })).toEqual(['a']);
  });

  it('a cell read the way its list reads it: trimmed, its spaces one', () => {
    expect(cellValue('  SYN  المعادي ')).toBe('SYN المعادي');
    expect(ids({ name: ['SYN المعادي'] })).toEqual(['c', 'd']);
  });

  it('an empty cell is a value of its own — blank and spaces alike', () => {
    expect(ids({ leader: [''] })).toEqual(['a', 'd']);
    expect(ids({ leader: ['', 'SYN علي'] })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nothing picked narrows nothing', () => {
    expect(ids({ code: [] })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the columns together', () => {
  it('add up: every column with picks must keep the row', () => {
    expect(ids({ area: ['الدقي'] })).toEqual(['a', 'c']);
    expect(ids({ area: ['الدقي'], leader: ['SYN علي'] })).toEqual(['c']);
    expect(ids({ area: ['زايد'], bank: ['CIB'] })).toEqual([]);
  });

  it('match a column on its own cells only — a code picked never matches a name', () => {
    expect(ids({ code: ['SYN سموحة'] })).toEqual([]);
  });

  it('ignore picks for a column the table does not have', () => {
    expect(ids({ nope: ['x'], bank: ['NBE'] })).toEqual(['b']);
  });

  it('say which columns narrow the table, with their picks', () => {
    expect(activeColumnFilters({ code: ['70'], name: [], area: ['الدقي', 'زايد'] })).toEqual([
      { key: 'code', picked: ['70'] },
      { key: 'area', picked: ['الدقي', 'زايد'] },
    ]);
    expect(hasColumnFilters({ name: [] })).toBe(false);
    expect(hasColumnFilters({ name: [''] })).toBe(true);
  });

  it('keep the rows in the order they came, and never change the input', () => {
    const before = ROWS.map((row) => row.id);
    expect(ids({ area: ['الدقي'] })).toEqual(['a', 'c']);
    expect(ROWS.map((row) => row.id)).toEqual(before);
    expect(filterRowsByColumns(ROWS, {}, textOf)).not.toBe(ROWS);
  });
});

describe('what a column’s list offers', () => {
  it('each value once, alphabetical, numbers as numbers, an empty cell last', () => {
    expect(choices('bank')).toEqual(['بنك مصر', 'CIB', 'NBE']);
    // 9100 before 70492: a run of digits sorts as the number it is.
    expect(choices('code')).toEqual(['9100', '70492', '70493', '71210']);
    expect(choices('leader')).toEqual(['SYN علي', '']);
    expect(choices('name')).toEqual(['SYN الإسماعيلية', 'SYN المعادي', 'SYN سموحة']);
  });

  it('from the rows the OTHER columns keep — never a value that would empty the table', () => {
    expect(choices('bank', { area: ['الدقي'] })).toEqual(['بنك مصر']);
    expect(choices('area', { bank: ['NBE', 'CIB'] })).toEqual(['أكتوبر', 'زايد']);
  });

  it('ignore the column’s own picks, so a second value can be added', () => {
    expect(choices('bank', { bank: ['NBE'] })).toEqual(['بنك مصر', 'CIB', 'NBE']);
  });

  it('keep a picked value the rows no longer hold, first, so it can be dropped', () => {
    expect(choices('bank', { bank: ['SYN GONE', 'NBE'] })).toEqual([
      'SYN GONE',
      'بنك مصر',
      'CIB',
      'NBE',
    ]);
  });

  it('nothing for a column the table does not have', () => {
    expect(choices('nope')).toEqual([]);
  });

  it('are asked for one column at a time', () => {
    const of = columnFilterChoicesOf(ROWS, { area: ['زايد'] }, textOf);
    expect(of('bank')).toEqual(['NBE']);
    expect(of('area')).toEqual(['أكتوبر', 'الدقي', 'زايد']);
  });
});
