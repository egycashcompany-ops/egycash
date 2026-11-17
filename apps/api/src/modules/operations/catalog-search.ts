// The catalogs' "search" box, as a Mongo condition that matches the TEXT the operator typed.
//
// Every catalog list used to hand `search` straight to `$regex`, so the typed text was read as a
// pattern: "(" made Mongo reject the query and the request failed with a 500, and "." or "+"
// matched things the operator never typed. That was tolerable while only an admin typed into the
// catalogs screen; the shipment form now filters branches as the operator types a name, so any
// branch name with a bracket or a dot would break the picker at the moment it is needed.
//
// Escaping turns the text back into a literal. Case-insensitivity stays, as before.
//
// LITERAL, BUT ARABIC-FOLDED. Arabic is written several ways that read as the same word: with or
// without the hamza on the alef, with taa marbuta or haa at the end, with or without tashkeel. An
// operator who typed «الاسكندريه» while the catalog held «الإسكندرية» got nothing back, and the
// shipment form then offered to add it «كفرع جديد» — so a search miss became a duplicate branch,
// and the bank's collections split across two rows from then on.
//
// HR solved the same problem with `normalizeArabic` (hr/shared/arabic.ts), but by folding BOTH
// sides: it stores a folded `searchName` beside every name. The catalogs store no folded copy, so
// the fold is done inside the pattern instead: each foldable letter becomes a class of every
// letter that folds with it, and tashkeel/tatweel may sit between any two letters. The groups and
// marks below mirror `normalizeArabic` exactly, and catalog-search.spec.ts holds them to it.
//
// What normalizeArabic does that this does NOT:
//   · NFKC's compatibility forms: the presentation forms (ﺍ ﻹ ﻻ …) and the high-hamza letters
//     U+0675–0678, none of which a keyboard produces. Mirroring them would turn every letter into
//     a class, and each of ﻻ or ٵ stands for two letters, which no single class can. (Its canonical
//     half — a hamza or madda typed as a separate mark on ا, و or ي — needs nothing: the mark is
//     skipped, and the bare letter is in the same group as the composed one.)
//   · whitespace collapsing. Spaces stay literal, as they were.
//
// ReDoS-safe by construction: the pattern is single-character atoms (a literal or a class) joined
// by ONE `[marks]*`, with no nesting and no alternation. The marks are stripped from the typed
// text first, so no atom can match a mark and every `[marks]*` stops at the first letter.
//
// SIZE-BOUNDED, because the fold costs about 33 bytes a character (the marks run between every
// two) and mongod refuses a pattern past 16 KB — «pattern string is longer than the limit set by
// the application» — which reaches the operator as a 500. Unfolded, that took some 8,000 typed
// letters; folded, about 370. So only the first MAX_SEARCH_CHARS letters build the pattern.

/** Every character `RegExp` treats as syntax, so it can be matched as itself. */
const REGEX_SYNTAX = /[.*+?^${}()|[\]\\]/g;

export const escapeRegExp = (text: string): string => text.replace(REGEX_SYNTAX, '\\$&');

/**
 * The letters normalizeArabic folds together, one group per letter it folds to:
 *   «أ إ آ ٱ → ا», «ى ئ → ي», «ة → ه», «ؤ → و».
 */
const FOLD_GROUPS: readonly string[] = ['اأإآٱ', 'يىئ', 'هة', 'وؤ'];

/** Each foldable letter → the class of its whole group, so «ي» also finds «ى» and «ئ». */
const FOLD_CLASS = new Map<string, string>(
  FOLD_GROUPS.flatMap((group) =>
    [...group].map((letter): [string, string] => [letter, `[${group}]`]),
  ),
);

/**
 * Tashkeel and tatweel — normalizeArabic's DIACRITICS, range for range (U+0610–061A, U+064B–065F,
 * U+0670, U+06D6–06DC, U+06DF–06E8, U+06EA–06ED, U+0640). The `\u` escapes are JavaScript's, so
 * the pattern Mongo receives holds the characters themselves: PCRE does not read `\u`.
 */
const MARKS = '\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640';
const ANY_MARKS = `[${MARKS}]*`;
const MARK = new RegExp(`[${MARKS}]`, 'g');

/**
 * How many typed letters (marks already stripped) the pattern is built from. At the worst — a
 * fold class for every letter — 200 come to under 9 KB, well inside mongod's 16 KB. Cutting can
 * only widen the answer, never empty it (a name holding the whole text holds its start), and 200
 * letters is a paste, not a branch name anybody types.
 */
const MAX_SEARCH_CHARS = 200;

/**
 * `{ $regex, $options: 'i' }` matching `text` anywhere in the field: literally, except that Arabic
 * letter variants and tashkeel compare the way normalizeArabic compares them. Text made only of
 * marks folds to nothing and so matches everything, as an empty search box does.
 */
export const containsText = (text: string): { $regex: string; $options: 'i' } => ({
  // `[...]` walks code points, so a character outside the BMP is never split by a marks run, nor
  // cut in half by the size bound.
  $regex: [...text.replace(MARK, '')]
    .slice(0, MAX_SEARCH_CHARS)
    .map((char) => FOLD_CLASS.get(char) ?? escapeRegExp(char))
    .join(ANY_MARKS),
  $options: 'i',
});
