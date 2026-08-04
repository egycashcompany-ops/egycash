// Matching text the way an Arabic typist actually types it.
//
// Arabic has several ways to write the same word: hamza forms (أ إ آ ا), final ya vs alef maqsura
// (ي ى), ta marbuta vs ha (ة ه), and optional diacritics nobody types when searching. A filter that
// compares raw strings finds nothing for "الاسماعيليه" when the catalog says "الإسماعيلية", and the
// user concludes the list is broken.
//
// Shared so every search box in the app agrees on what "matches" means — one definition, not one
// per control.
export const fold = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N} ]/gu, '');

/** Does `haystack` contain `query`, both folded? An empty query matches everything. */
export const foldIncludes = (haystack: string, query: string): boolean => {
  const q = fold(query);
  return q === '' || fold(haystack).includes(q);
};
