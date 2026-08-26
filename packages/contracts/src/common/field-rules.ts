// Field-level rules for personal data, written once and used by both sides: the browser turns
// them into on-blur feedback, the API turns them into schema refinements. A rule that lives only
// in the form is decoration — the same predicate has to be what the server enforces.
//
// Each rule is a plain predicate over a TRIMMED, non-empty string. Whether a field is required is
// the schema's business, not the rule's, so an empty value is never this file's concern.
import { z } from 'zod';
import { asciiDigits } from './value-objects.js';

// ── Names ───────────────────────────────────────────────────────────────────
// The Arabic range is deliberately assembled from letter/diacritic blocks rather than the whole
// ؀-ۿ block, because that block also contains the Arabic-Indic digits ٠-٩ — and a name
// with digits in it is exactly what this rule exists to reject.
const ARABIC_LETTERS = '\\u0621-\\u0652\\u0670-\\u06D3'; // hamza→sukun, superscript alef→ye barree
const NAME_PUNCTUATION = " '\\u2019.\\-";

export const ARABIC_NAME_RE = new RegExp(`^[${ARABIC_LETTERS}${NAME_PUNCTUATION}]+$`);
export const ENGLISH_NAME_RE = new RegExp(`^[A-Za-z${NAME_PUNCTUATION}]+$`);

/** Arabic letters only — no digits (Arabic or Latin), no Latin letters. */
export const isArabicName = (value: string): boolean => ARABIC_NAME_RE.test(value.trim());
/** Latin letters only — no digits, no Arabic. */
export const isEnglishName = (value: string): boolean => ENGLISH_NAME_RE.test(value.trim());

/**
 * Tokens that bind to the word AFTER them to form ONE name part.
 *
 * Without these, counting parts by counting spaces is wrong in both directions: «عبد الرحمن محمد
 * علي حسن» is five words and four parts, while «محمد عبد الله علي» is four words and three. An
 * Egyptian quadruple name is four PARTS — the person, the father, the grandfather, the family —
 * and compound parts are ordinary, not exceptional.
 */
const NAME_BINDERS = new Set(['عبد', 'أبو', 'ابو', 'أبا', 'ابا', 'ابن', 'بن', 'آل']);

/**
 * How many name PARTS a full name carries.
 *
 * A HEURISTIC, and used only to advise (never to reject): the binder list cannot be complete, and
 * a name it counts short is still a name somebody is entitled to. Callers warn on the result; none
 * of them refuse a save because of it.
 */
export const countNameParts = (value: string): number => {
  const tokens = value.trim().split(/\s+/).filter((t) => t.length > 0);
  let parts = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    parts += 1;
    // A binder swallows the word that follows it — but never the last word, or a trailing «عبد»
    // would count as a part that has no name attached to it.
    if (NAME_BINDERS.has(tokens[i] as string) && i + 1 < tokens.length) i += 1;
  }
  return parts;
};

/** The Egyptian convention every official form is filled in with: person, father, grandfather, family. */
export const QUADRUPLE_NAME_PARTS = 4;

export const isQuadrupleName = (value: string): boolean =>
  countNameParts(value) >= QUADRUPLE_NAME_PARTS;

// ── Email ───────────────────────────────────────────────────────────────────
// One `@`, a dotted domain, ASCII only. Stricter than `z.string().email()`, which accepts a
// dotless domain like `a@b` — valid by the RFC, never valid as a contact address on a job form.
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

// ── Postal code ─────────────────────────────────────────────────────────────
/** Egypt Post codes are exactly five digits — typed in either script, stored in ASCII. */
export const POSTAL_CODE_RE = /^\d{5}$/;
export const isPostalCode = (value: string): boolean =>
  POSTAL_CODE_RE.test(asciiDigits(value.trim()));

// ── Religion ────────────────────────────────────────────────────────────────
// Stored in Arabic, which is what the National-ID card carries and what the OCR reads back, so a
// scanned card and a hand-picked value are the same string rather than two encodings of it.
export const RELIGIONS = ['مسلم', 'مسيحي'] as const;
export type Religion = (typeof RELIGIONS)[number];

/** Fold the spellings a card/OCR produces onto the catalog value; undefined when unrecognised. */
export const normalizeReligion = (value: string): Religion | undefined => {
  const v = value.trim().replace(/[ً-ْ]/g, ''); // drop harakat
  if (v.startsWith('مسلم')) return 'مسلم'; // مسلم / مسلمة
  if (v.startsWith('مسيح')) return 'مسيحي'; // مسيحي / مسيحى / مسيحية
  return undefined;
};

// ── Nationality ─────────────────────────────────────────────────────────────
/** Stored canonically in English; the UI renders the Arabic label. */
export const NATIONALITY_EGYPTIAN = 'Egyptian';
export const NATIONALITY_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  Egyptian: { ar: 'مصري', en: 'Egyptian' },
};

// ── Zod refinements ─────────────────────────────────────────────────────────
// Named messages, so an API failure names the same rule the field showed.

export const arabicName = (schema: z.ZodString): z.ZodEffects<z.ZodString, string, string> =>
  schema.refine((v) => v.trim() === '' || isArabicName(v), {
    message: 'must contain Arabic letters only',
  });

export const englishName = (schema: z.ZodString): z.ZodEffects<z.ZodString, string, string> =>
  schema.refine((v) => v.trim() === '' || isEnglishName(v), {
    message: 'must contain Latin letters only',
  });

export const PostalCodeSchema = z
  .string()
  .transform((v) => asciiDigits(v.trim()))
  .refine((v) => isPostalCode(v), { message: 'must be a 5-digit Egyptian postal code' });

export const EmailSchema = z.string().refine((v) => isEmail(v), { message: 'invalid email' });
