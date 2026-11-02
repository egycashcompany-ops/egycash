// A filter for every column, typed under the column's own name — the ATM tables' row of boxes
// under the head: «في كل الصفحات بردو عايزك تعمل فلتر لكل الجدول فوق الجدول … بس الفلتر اللى فوق
// الجدول يتفلتر مع الفلتر اللى فوق» (2026-11-02), and asked which: «فلتر لكل عمود».
//
// The rules, one definition for every table that has the row:
//   · a box keeps the rows whose CELL contains what was typed — against the text the cell SHOWS,
//     nothing hidden behind it — with the app's search folds (hamza forms, ى/ي, ة/ه, diacritics,
//     case, and Arabic or Latin digits are one) but its PUNCTUATION KEPT: «2/11» finds a date that
//     shows «02/11», never «21/10» (`fold` drops the separators, which would make both «211»).
//     The invisible direction marks inside an Arabic date are dropped, as nobody can type them;
//   · several words in one box must all appear in that cell, in any order — «3h 05m» finds
//     «3h : 05m», and «بنك مصر» finds «مصر - بنك»;
//   · the boxes add up: a row stays only if every box that holds something matches its column;
//   · an empty box, or one holding only spaces or punctuation, narrows nothing.
//
// The rows are filtered BY THE PAGE, before it counts, groups, selects or exports them: what the
// table shows is what a statement prints and what «select all» checks. The boxes live in the
// page's state, not the address: a narrowing typed for a moment is not a view to come back to
// tomorrow with rows silently missing.
import { asciiDigits } from '@ecms/contracts';

/** What one table's boxes hold: the column key → the text typed in its box. */
export type ColumnFilterValues = Readonly<Record<string, string>>;

/**
 * Pure: a cell's text or a box's text, folded for matching — digits to Latin and the Arabic
 * separators to theirs (thousands «٬» and comma «،» to «,», decimal «٫» to «.»: «1,000» finds
 * «١٬٠٠٠»), lower case, hamza forms to «ا», ى to ي, ة to ه, diacritics and invisible format marks
 * (the RLM in «٠٢‏/١١‏/٢٠٢٦») gone. All other punctuation and the spaces stay where they were.
 */
export const foldColumnText = (value: string): string =>
  asciiDigits(value)
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.')
    .replace(/\p{Cf}/gu, '');

/**
 * Pure: the words of one box, folded. A word with no letter or digit in it — a lone «-» or «:» —
 * narrows nothing, so a box of punctuation only is an empty box.
 */
export const filterWords = (typed: string): string[] =>
  foldColumnText(typed)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

/**
 * Pure: does a cell's text hold every word of its box? A word is looked for in the cell as it
 * shows, and in the cell with its digit groups closed up — «1250» finds «١٬٢٥٠», as «1,250» does —
 * while a date's «/» and a time's «:» stay where they are.
 */
export const cellMatches = (text: string, words: readonly string[]): boolean => {
  if (words.length === 0) return true;
  const folded = foldColumnText(text);
  const ungrouped = folded.replace(/(\d),(?=\d)/g, '$1');
  return words.every((word) => folded.includes(word) || ungrouped.includes(word));
};

/** Pure: the boxes that narrow something, each with its words. */
export const activeColumnFilters = (
  values: ColumnFilterValues,
): { key: string; typed: string; words: string[] }[] =>
  Object.entries(values)
    .map(([key, typed]) => ({ key, typed: typed.trim(), words: filterWords(typed) }))
    .filter((entry) => entry.words.length > 0);

/** Pure: is any box narrowing the table? */
export const hasColumnFilters = (values: ColumnFilterValues): boolean =>
  activeColumnFilters(values).length > 0;

/**
 * Pure: the rows every box keeps. `textOf` is what the cell of that column shows for a row — the
 * same text the table renders, so a reader never filters on something they cannot see. A key the
 * table does not know matches nothing it could test, so it is ignored rather than emptying the
 * table.
 */
export const filterRowsByColumns = <T>(
  rows: readonly T[],
  values: ColumnFilterValues,
  textOf: (row: T, key: string) => string | null,
): T[] => {
  const active = activeColumnFilters(values);
  if (active.length === 0) return [...rows];
  return rows.filter((row) =>
    active.every(({ key, words }) => {
      const text = textOf(row, key);
      return text === null || cellMatches(text, words);
    }),
  );
};
