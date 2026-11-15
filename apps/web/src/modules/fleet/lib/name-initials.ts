/**
 * The letters a person's round badge shows: the first letter of the first two words, and «السيد»
 * gives «س», not «ا» — the article is not the name. «ابراهيم السيد» → «اس».
 *
 * Two letters side by side read as a word. A few pairs are rude words in Egyptian Arabic, and a
 * real name gives them easily: «كريم السيد» → «كس», «زكي بدوي» → «زب», «طارق زكي» → «طز». For those
 * the badge shows the first letter alone. With a space between the letters, the same pairs still
 * read as the word, so the rule is the same whatever joins them.
 */
const NAME_ARTICLE = 'ال';

/** Pairs a badge never shows. Add a pair here; nothing else needs to change. */
export const BLOCKED_INITIAL_PAIRS: ReadonlySet<string> = new Set(['كس', 'زب', 'طز', 'شخ', 'تف']);

const firstLetter = (word: string): string =>
  word.startsWith(NAME_ARTICLE) && word.length > NAME_ARTICLE.length
    ? word.charAt(NAME_ARTICLE.length)
    : word.charAt(0);

/** The badge's letters, joined by `separator` («» for a small badge, « » for a profile card). */
export const nameInitials = (name: string, separator = ''): string => {
  const letters = name.trim().split(/\s+/u).slice(0, 2).map(firstLetter).filter(Boolean);
  if (letters.length === 2 && BLOCKED_INITIAL_PAIRS.has(letters.join(''))) {
    return letters[0]!;
  }
  return letters.join(separator);
};
