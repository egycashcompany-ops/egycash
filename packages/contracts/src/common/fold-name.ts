// One fold for comparing two spellings of one Arabic name — written for IT's go-live imports,
// shared here so every module that matches names (IT's imports, Administrative Affairs' master
// data, §2.1 of its design) folds alike, and a stored folded key means the same thing everywhere.
/**
 * Arabic folded flat for comparing two spellings of one name: the hamza forms to a bare alef,
 * the diacritics and tatweel dropped, taa marbuta and alef maqsura normalised, case and spacing
 * ignored. «الأسكندرية» and «الاسكندرية», or «لاب توب» and «لابتوب», fold to one key.
 */
export const foldName = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[آأإٱ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .replace(/ى/gu, 'ي')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('en');
