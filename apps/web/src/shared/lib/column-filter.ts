// A filter for every column, under the column's own name — the ATM tables' row of filters under
// the head: «في كل الصفحات بردو عايزك تعمل فلتر لكل الجدول فوق الجدول … بس الفلتر اللى فوق
// الجدول يتفلتر مع الفلتر اللى فوق» (2026-11-02), asked which: «فلتر لكل عمود», and then «لأ عايز
// الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi select» — a drop-down of the column's own
// values, several of them pickable, as the bank and area filters above are.
//
// The rules, one definition for every table that has the row:
//   · a column's list holds the values its cells SHOW — each once, in the reader's order (Arabic
//     collation, numbers as numbers, dates and times in time order), an empty cell («—» on screen)
//     as one «(فارغ)» entry, last — taken from the rows the OTHER columns' picks keep, as a sheet's
//     own filter does: a list never offers a value that would empty the table;
//   · the list's search matches as the box typed into used to (`columnSearchMatches`): Arabic or
//     Latin digits, any hamza form, several words in any order — and a date's «/» or a time's «:»
//     kept, so «2/11» never finds 21/10;
//   · picking values in one column keeps the rows whose cell is ANY of them;
//   · the columns add up: a row stays only if every column with picks keeps it — and the filters
//     above the table (bank, area, day…) have already chosen the rows the lists are made from;
//   · a column with nothing picked narrows nothing.
//
// The rows are filtered BY THE PAGE, before it counts, groups, selects or exports them: what the
// table shows is what a statement prints and what «select all» checks. The picks live in the
// page's state, not the address: a narrowing made for a moment is not a view to come back to
// tomorrow with rows silently missing.
import { asciiDigits } from '@ecms/contracts';

/** What one table's filters hold: the column key → the values picked in its list. */
export type ColumnFilterValues = Readonly<Record<string, readonly string[]>>;

/** What a table prints in an empty cell. */
const EMPTY_MARK = '—';

/**
 * Pure: a cell's text as its list knows it — trimmed, every run of spaces one, and a cell showing
 * only the empty mark «—» as the empty value `''` («(فارغ)»). Two cells that read the same on
 * screen are one entry, and a pick matches both — whether a page prints its empty cells as «—» or
 * as nothing.
 */
export const cellValue = (text: string): string => {
  const value = text.trim().replace(/\s+/g, ' ');
  return value === EMPTY_MARK ? '' : value;
};

/**
 * Pure: a list's value or its search, folded for matching — digits to Latin and the Arabic
 * separators to theirs (thousands «٬» and comma «،» to «,», decimal «٫» to «.»: «1,000» finds
 * «١٬٠٠٠»), lower case, hamza forms to «ا», ى to ي, ة to ه, diacritics and invisible format marks
 * (the RLM in «٠٢‏/١١‏/٢٠٢٦») gone. All other punctuation and the spaces stay where they were —
 * unlike the app's search boxes (`fold`), which drop it, and would find 21/10 for «2/11».
 */
export const foldColumnText = (value: string): string =>
  asciiDigits(value)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.')
    .replace(/\p{Cf}/gu, '');

/**
 * Pure: the words of a list's search, folded. A word with no letter or digit in it — a lone «-» or
 * «/» — searches for nothing, so a search of punctuation only is no search.
 */
const searchWords = (typed: string): string[] =>
  foldColumnText(typed)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

/**
 * Pure: does a value of a column's list hold every word of what was typed in its search? A word
 * is looked for in the value as it shows, and with its digit groups closed up — «1250» finds
 * «١٬٢٥٠», as «1,250» does — while a date's «/» and a time's «:» stay where they are. Nothing
 * searched matches every value.
 */
export const columnSearchMatches = (value: string, typed: string): boolean => {
  const words = searchWords(typed);
  if (words.length === 0) return true;
  const folded = foldColumnText(value);
  const ungrouped = folded.replace(/(\d),(?=\d)/g, '$1');
  return words.every((word) => folded.includes(word) || ungrouped.includes(word));
};

/** Pure: does what was typed in a list's search look for anything — a letter or a digit? */
export const isColumnSearch = (typed: string): boolean => searchWords(typed).length > 0;

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

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Pure: what a value sorts by, so a list reads in the order the reader expects — a number with its
 * digit groups closed up («١٬٢٥٠٬٠٠٠» after «٥٠٬٠٠٠», not before), a date year first (the tables
 * print «٠٢/١١/٢٠٢٦» and «2 Nov 2026»: day first), a time on the 24-hour clock («٣:٠٥ م» after
 * «١١:٠٠ ص»). Only the order changes: the list shows each value as its cells do.
 */
export const columnSortKey = (value: string): string =>
  asciiDigits(value)
    .replace(/\p{Cf}/gu, '')
    .replace(/(\d)[,٬](?=\d)/g, '$1')
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, '$3/$2/$1')
    .replace(
      /\b(\d{1,2}) ([A-Za-z]{3,4})\.? (\d{4})\b/g,
      (whole, day: string, month: string, year: string) => {
        const number = MONTHS[month.toLowerCase()];
        return number === undefined ? whole : `${year}/${String(number)}/${day}`;
      },
    )
    .replace(
      /\b(\d{1,2}):(\d{2})(:\d{2})?\s*(ص|م|AM|PM|am|pm)/g,
      (_whole, hour: string, minute: string, second: string | undefined, half: string) => {
        const pm = half === 'م' || half.toLowerCase() === 'pm';
        const h = (Number(hour) % 12) + (pm ? 12 : 0);
        return `${String(h)}:${minute}${second ?? ''}`;
      },
    );

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
  // Each value's sort key made once, not once per comparison.
  const sorted = [...seen]
    .filter((value) => value !== '')
    .map((value) => ({ value, key: columnSortKey(value) }))
    .sort((a, b) => collator.compare(a.key, b.key) || collator.compare(a.value, b.value))
    .map((entry) => entry.value);
  if (seen.has('')) sorted.push('');
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
