// A filter for every column, under the column's own name — the ATM tables' row of filters under
// the head: «في كل الصفحات بردو عايزك تعمل فلتر لكل الجدول فوق الجدول … بس الفلتر اللى فوق
// الجدول يتفلتر مع الفلتر اللى فوق» (2026-11-02), asked which: «فلتر لكل عمود», and then «لأ عايز
// الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi select» — a drop-down of the column's own
// values, several of them pickable, as the bank and area filters above are.
//
// The rules, one definition for every table that has the row:
//   · a column's list holds the values its cells SHOW — each once, in alphabetical order (numbers
//     as numbers), an empty cell as one «(فارغ)» entry — taken from the rows the OTHER columns'
//     picks keep, as a sheet's own filter does: a list never offers a value that would empty the
//     table;
//   · picking values in one column keeps the rows whose cell is ANY of them;
//   · the columns add up: a row stays only if every column with picks keeps it — and the filters
//     above the table (bank, area, day…) have already chosen the rows the lists are made from;
//   · a column with nothing picked narrows nothing.
//
// The rows are filtered BY THE PAGE, before it counts, groups, selects or exports them: what the
// table shows is what a statement prints and what «select all» checks. The picks live in the
// page's state, not the address: a narrowing made for a moment is not a view to come back to
// tomorrow with rows silently missing.
/** What one table's filters hold: the column key → the values picked in its list. */
export type ColumnFilterValues = Readonly<Record<string, readonly string[]>>;

/**
 * Pure: a cell's text as its list knows it — trimmed, every run of spaces one. Two cells that
 * read the same on screen are one entry, and a pick matches both.
 */
export const cellValue = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** Pure: the columns whose lists have something picked, each with its picks. */
export const activeColumnFilters = (
  values: ColumnFilterValues,
): { key: string; picked: readonly string[] }[] =>
  Object.entries(values)
    .filter(([, picked]) => picked.length > 0)
    .map(([key, picked]) => ({ key, picked }));

/** Pure: is any column narrowing the table? */
export const hasColumnFilters = (values: ColumnFilterValues): boolean =>
  activeColumnFilters(values).length > 0;

/**
 * Pure: does a row pass every column with picks — leaving one column out (`except`), as that
 * column's own list is made? `textOf` answers what the cell of that column shows for a row; a key
 * the table has no column for answers null and narrows nothing.
 */
const passes = <T>(
  row: T,
  active: readonly { key: string; picked: ReadonlySet<string> }[],
  textOf: (row: T, key: string) => string | null,
  except: string | null = null,
): boolean =>
  active.every(({ key, picked }) => {
    if (key === except) return true;
    const text = textOf(row, key);
    return text === null || picked.has(cellValue(text));
  });

const pickedSets = (values: ColumnFilterValues): { key: string; picked: ReadonlySet<string> }[] =>
  activeColumnFilters(values).map(({ key, picked }) => ({
    key,
    picked: new Set(picked.map(cellValue)),
  }));

/** Pure: the rows every column's picks keep, in the order they came. */
export const filterRowsByColumns = <T>(
  rows: readonly T[],
  values: ColumnFilterValues,
  textOf: (row: T, key: string) => string | null,
): T[] => {
  const active = pickedSets(values);
  if (active.length === 0) return [...rows];
  return rows.filter((row) => passes(row, active, textOf));
};

/** Alphabetical, the way the reader reads: Arabic collation, a run of digits as a number. */
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

/**
 * Pure: one column's list — the values its cells show among the rows the OTHER columns' picks
 * keep, each once, sorted, an empty cell (`''`) last. A value still picked that no longer appears
 * (a filter above moved on) comes first, so it can be seen and un-picked: a pick the list hid
 * would narrow the table with nothing on screen to say how.
 */
export const columnFilterChoices = <T>(
  rows: readonly T[],
  values: ColumnFilterValues,
  key: string,
  textOf: (row: T, key: string) => string | null,
): string[] => {
  const active = pickedSets(values);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!passes(row, active, textOf, key)) continue;
    const text = textOf(row, key);
    if (text !== null) seen.add(cellValue(text));
  }
  const missing = [...new Set((values[key] ?? []).map(cellValue))].filter(
    (value) => !seen.has(value),
  );
  const sorted = [...seen].sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return collator.compare(a, b);
  });
  return [...missing, ...sorted];
};

/**
 * Pure: the lists of a whole table, asked for one column at a time — and only when that column's
 * list is opened (`ColumnFilterSelect`): a board re-renders every second for its timers, and
 * making every column's list on every tick would be work nobody looks at.
 */
export const columnFilterChoicesOf =
  <T>(
    rows: readonly T[],
    values: ColumnFilterValues,
    textOf: (row: T, key: string) => string | null,
  ): ((key: string) => string[]) =>
  (key) =>
    columnFilterChoices(rows, values, key, textOf);
