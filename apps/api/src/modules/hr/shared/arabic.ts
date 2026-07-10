// Arabic text normalization for search (Sprint 4.1 plan §9) — a business requirement,
// not a nicety: a recruiter searching "احمد" must find "أحمد"/"إحمد"/"ﺍحمد". Pure and
// module-local; if a second module needs it, promote to shared/utils.

// Arabic diacritics (tashkeel) + tatweel (ـ) — stripped entirely.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;

/**
 * Fold an Arabic string to a search-stable form:
 * - all hamza-carrier alef variants (أ إ آ ٱ) → bare alef (ا)
 * - alef maqsura (ى) → yaa (ي); taa marbuta (ة) → haa (ه)
 * - hamza on waw/yaa (ؤ ئ) → waw/yaa
 * - strip diacritics + tatweel, collapse whitespace, lowercase (for mixed ar/en).
 */
export const normalizeArabic = (input: string): string =>
  input
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Escapes a user string for safe use as a literal inside a RegExp (search, injection-safe). */
export const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
