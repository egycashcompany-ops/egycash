// A filter for every column, typed under the column's own name — the ATM tables' row of boxes
// under the head: «في كل الصفحات بردو عايزك تعمل فلتر لكل الجدول فوق الجدول … بس الفلتر اللى فوق
// الجدول يتفلتر مع الفلتر اللى فوق» (2026-11-02), and asked which: «فلتر لكل عمود».
//
// The rules, one definition for every table that has the row:
//   · a box keeps the rows whose CELL contains what was typed, matched the way every search box in
//     the app matches (`fold`: hamza forms, ى/ي, ة/ه, diacritics, and Arabic or Latin digits are
//     one) — against the text the cell SHOWS, nothing hidden behind it;
//   · several words in one box must all appear in that cell, in any order — «3h 05m» finds
//     «3h : 05m», and «بنك مصر» finds «مصر - بنك»;
//   · the boxes add up: a row stays only if every box that holds something matches its column;
//   · an empty box, or one holding only spaces or punctuation, narrows nothing.
//
// The rows are filtered BY THE PAGE, before it counts, groups, selects or exports them: what the
// table shows is what a statement prints and what «select all» checks. The boxes live in the
// page's state, not the address: a narrowing typed for a moment is not a view to come back to
// tomorrow with rows silently missing.
import { fold } from './fold';

/** What one table's boxes hold: the column key → the text typed in its box. */
export type ColumnFilterValues = Readonly<Record<string, string>>;

/** Pure: the words of one box, folded. None for a box that narrows nothing. */
export const filterWords = (typed: string): string[] =>
  fold(typed)
    .split(/\s+/)
    .filter((word) => word !== '');

/** Pure: does a cell's text hold every word of its box? */
export const cellMatches = (text: string, words: readonly string[]): boolean => {
  if (words.length === 0) return true;
  const folded = fold(text);
  return words.every((word) => folded.includes(word));
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
