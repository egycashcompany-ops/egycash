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
  columnSearchMatches,
  columnSortKey,
  filterRowsByColumns,
  hasColumnFilters,
  isColumnSearch,
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

describe('an empty cell, whichever way a page prints it', () => {
  it('«—» is the empty value, as a blank cell is — one «(فارغ)» entry, last', () => {
    expect(cellValue(' — ')).toBe('');
    // A dash inside a value is part of it.
    expect(cellValue('SYN — 1')).toBe('SYN — 1');
    const lines = [
      { id: 'x', serial: '—' },
      { id: 'y', serial: '١٠١' },
      { id: 'z', serial: '' },
    ];
    const serialOf = (line: { serial: string }, key: string): string | null =>
      key === 'serial' ? line.serial : null;
    expect(columnFilterChoices(lines, {}, 'serial', serialOf)).toEqual(['١٠١', '']);
    expect(filterRowsByColumns(lines, { serial: [''] }, serialOf).map((l) => l.id)).toEqual([
      'x',
      'z',
    ]);
  });
});

describe('the list’s search — as the box typed into matched', () => {
  const at = [
    '٠٢\u200F/١١\u200F/٢٠٢٦، ١٠:٣٠ ص',
    '٢١\u200F/١٠\u200F/٢٠٢٦، ١١:٣٠ ص',
    '٢١\u200F/١١\u200F/٢٠٢٦، ١١:٠٣ ص',
  ];
  const found = (typed: string): number[] =>
    at.flatMap((value, index) => (columnSearchMatches(value, typed) ? [index] : []));

  it('keeps a date’s «/» and a time’s «:» — «2/11» never finds 21/10, «1:03» never 10:30', () => {
    expect(found('2/11')).toEqual([0]);
    expect(found('1:03')).toEqual([2]);
    expect(found('١٠:٣٠')).toEqual([0]);
  });

  it('Arabic or Latin digits and separators, digit groups closed up, any hamza form, words in any order', () => {
    expect(columnSearchMatches('١٬٢٥٠٫٥٠ ج.م', '1,250.50')).toBe(true);
    expect(columnSearchMatches('١٬٢٥٠٫٥٠ ج.م', '1250')).toBe(true);
    expect(columnSearchMatches('١٬٢٥٠٫٥٠ ج.م', '2501')).toBe(false);
    expect(columnSearchMatches('SYN الإسماعيلية', 'الاسماعيليه syn')).toBe(true);
  });

  it('punctuation alone searches for nothing — it matches all, and is no search', () => {
    expect(found('/')).toEqual([0, 1, 2]);
    expect(isColumnSearch(' / — ')).toBe(false);
    expect(isColumnSearch('704')).toBe(true);
  });
});

describe('the order a list reads in', () => {
  const sorted = (values: string[]): string[] =>
    columnFilterChoices(
      values.map((value) => ({ value })),
      {},
      'value',
      (row: { value: string }) => row.value,
    );

  it('numbers with digit groups as the numbers they are', () => {
    expect(sorted(['٩٠٠٬٠٠٠', '١٬٢٥٠٬٠٠٠', '٥٠٬٠٠٠', '١٬٠٠٠', '٩٩'])).toEqual([
      '٩٩',
      '١٬٠٠٠',
      '٥٠٬٠٠٠',
      '٩٠٠٬٠٠٠',
      '١٬٢٥٠٬٠٠٠',
    ]);
  });

  it('dates in time order, Arabic and English, and times on the 24-hour clock', () => {
    expect(
      sorted([
        '٠١\u200F/١٢\u200F/٢٠٢٦، ٩:٠٠ ص',
        '٠٢\u200F/١١\u200F/٢٠٢٦، ٣:٠٥ م',
        '٠٢\u200F/١١\u200F/٢٠٢٦، ١١:٠٠ ص',
      ]),
    ).toEqual([
      '٠٢\u200F/١١\u200F/٢٠٢٦، ١١:٠٠ ص',
      '٠٢\u200F/١١\u200F/٢٠٢٦، ٣:٠٥ م',
      '٠١\u200F/١٢\u200F/٢٠٢٦، ٩:٠٠ ص',
    ]);
    expect(sorted(['1 Dec 2026, 09:00', '21 Oct 2026, 11:30', '2 Nov 2026, 15:05'])).toEqual([
      '21 Oct 2026, 11:30',
      '2 Nov 2026, 15:05',
      '1 Dec 2026, 09:00',
    ]);
    expect(columnSortKey('12:15 ص')).toBe('0:15');
    expect(columnSortKey('12:15 م')).toBe('12:15');
  });
});

describe('a column that puts something first — the run, first to third', () => {
  it('sorts by what each value’s row puts first, then by the value itself', () => {
    const lines = [
      { run: 3, text: 'التغذية الثالثة 3:00 م' },
      { run: 2, text: 'التغذية الثانية 12:00 م' },
      { run: 1, text: 'التغذية الأولى 8:00 ص' },
      { run: 2, text: 'التغذية الثانية 9:00 ص' },
    ];
    const textOf = (line: { text: string }, key: string): string | null =>
      key === 'run' ? line.text : null;
    // The alphabet alone reads first, third, second: ث-ا-ل before ث-ا-ن.
    expect(columnFilterChoices(lines, {}, 'run', textOf)).toEqual([
      'التغذية الأولى 8:00 ص',
      'التغذية الثالثة 3:00 م',
      'التغذية الثانية 9:00 ص',
      'التغذية الثانية 12:00 م',
    ]);
    const runFirst = (line: { run: number }, key: string): string | null =>
      key === 'run' ? String(line.run) : null;
    // With the run's number first: first, second (its morning before its noon), third.
    expect(columnFilterChoices(lines, {}, 'run', textOf, runFirst)).toEqual([
      'التغذية الأولى 8:00 ص',
      'التغذية الثانية 9:00 ص',
      'التغذية الثانية 12:00 م',
      'التغذية الثالثة 3:00 م',
    ]);
    expect(columnFilterChoicesOf(lines, {}, textOf, runFirst)('run')[1]).toBe(
      'التغذية الثانية 9:00 ص',
    );
  });
});
