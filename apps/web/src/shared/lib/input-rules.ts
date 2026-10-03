// What a typed or PASTED value may contain, by the kind of field it is going into.
//
// «تسمح لاى انبوت يتحط فيه داتا لو واخد حاجه نسخ … بس بشرط لو رقم وانا بعمل لصق ل نص يمنع ويظهر رساله
// فيها السبب» and «اى مكان هكتب بس رقم يبقى مينفعش غير رقم هكتب بس عربى يبقى عربي مينفعش انجليزي
// واى مكان انجليزي يبقى انجليزي مينفعش يبقى عربى».
//
// Two steps, both pure so a node test reaches them:
//   1. `normalizeForRule` makes an ACCEPTABLE value canonical — Arabic-Indic digits to ASCII
//      (١٢٣ → 123) everywhere, grouping commas out of a whole number («48,213» → 48213), the
//      separators out of a phone number. Paste is never refused for a value that only needed this.
//   2. `inputRuleReason` says WHY a normalised value cannot go in, or `null` when it can. The
//      caller refuses the keystroke or the paste and shows the reason.
//
// Money is not here: `MoneyInput` already owns its digits and point (`money-input.ts`); it asks
// `inputRuleReason('decimal', …)` only to refuse a paste that carries letters.
import { asciiDigits } from './format';

export type InputRule = 'integer' | 'decimal' | 'digits' | 'phone' | 'arabic' | 'english' | 'plate';

/** Why a value was refused — a key under `common.input.*`. */
export type InputRuleReason = 'numbersOnly' | 'arabicOnly' | 'englishOnly' | 'plateOnly';

const LATIN_LETTER = /[A-Za-z]/u;
// Arabic LETTERS only — the block also holds the Arabic-Indic digits, which are not a script. The
// presentation forms are included: Arabic copied out of a PDF arrives as them, and is still Arabic.
const ARABIC_LETTER = /[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;

/**
 * Direction marks and other invisible characters that ride along on copied text — a phone number
 * copied from WhatsApp on an Arabic phone arrives wrapped in them. They are not part of any value,
 * so they are dropped before anything is checked. The joiners (U+200C/U+200D) are not in this list:
 * they shape Arabic letters and belong to the name.
 */
export const INVISIBLE_MARKS = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

export const normalizeForRule = (rule: InputRule, raw: string): string => {
  const ascii = asciiDigits(raw.replace(INVISIBLE_MARKS, ''));
  switch (rule) {
    case 'integer':
      // A pasted «48,213» or «48 213» is the number 48213.
      return ascii.replace(/[,٬\s]/gu, '');
    case 'decimal':
      return ascii.replace(/٫/gu, '.').replace(/[٬,\s]/gu, '');
    case 'digits':
      // A card number keeps the spaces it is read in; a dash between groups is one too.
      return ascii.replace(/[-–]/gu, ' ').replace(/\s+/gu, ' ');
    case 'phone':
      return ascii.replace(/[\s\-()]/gu, '');
    default:
      return ascii;
  }
};

export const inputRuleReason = (rule: InputRule, value: string): InputRuleReason | null => {
  switch (rule) {
    case 'integer':
      return /^\d*$/u.test(value) ? null : 'numbersOnly';
    case 'decimal':
      return /^\d*(\.\d*)?$/u.test(value) ? null : 'numbersOnly';
    case 'digits':
      return /^[\d ]*$/u.test(value) ? null : 'numbersOnly';
    case 'phone':
      return /^\+?\d*$/u.test(value) ? null : 'numbersOnly';
    case 'arabic':
      // Digits and punctuation stay allowed — «مرسيدس 515» is an Arabic name.
      return LATIN_LETTER.test(value) ? 'arabicOnly' : null;
    case 'english':
      return ARABIC_LETTER.test(value) ? 'englishOnly' : null;
    case 'plate':
      // «ج ك ق 4719»: Arabic letters, digits and spaces.
      return LATIN_LETTER.test(value) ? 'plateOnly' : null;
    default:
      return null;
  }
};

/** The two steps together: the value to keep, or why there is none. */
export const applyInputRule = (
  rule: InputRule,
  raw: string,
): { value: string; reason: null } | { value: null; reason: InputRuleReason } => {
  const value = normalizeForRule(rule, raw);
  const reason = inputRuleReason(rule, value);
  return reason === null ? { value, reason: null } : { value: null, reason };
};

/** What an edit ADDED: `after` less the stretch it shares with `before` at either end. */
export const insertedText = (before: string, after: string): string => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return after.slice(start, after.length - end);
};

/**
 * One edit — a keystroke, a paste, a cut — from `before` to `after`.
 *
 * A value saved before the rule existed may already break it (a chassis typed in Arabic years
 * ago). Refusing every edit to it would leave the clerk unable even to delete the bad part, so
 * once the value already breaks the rule only what the edit ADDS is checked: the old text can be
 * corrected, never added to.
 */
export const applyInputChange = (
  rule: InputRule,
  before: string,
  after: string,
): { value: string; reason: null } | { value: null; reason: InputRuleReason } => {
  const whole = applyInputRule(rule, after);
  if (whole.reason === null) return whole;
  if (inputRuleReason(rule, normalizeForRule(rule, before)) === null) return whole;
  const added = insertedText(before, after);
  const reason = added === '' ? null : inputRuleReason(rule, normalizeForRule(rule, added));
  return reason === null
    ? { value: normalizeForRule(rule, after), reason: null }
    : { value: null, reason };
};

/**
 * Where the caret belongs when an edit is REFUSED and the box goes back to what it held: where the
 * user was typing, less what the refused edit added. Writing a value moves the caret to the end,
 * and the next character would then land there instead of where the user is looking.
 */
export const caretAfterRefusal = (caret: number, typedLength: number, keptLength: number): number =>
  Math.max(0, Math.min(keptLength, caret - (typedLength - keptLength)));

/**
 * Where the caret belongs when an accepted edit was rewritten canonical (١٢ → 12, a grouping comma
 * dropped): after the same characters it followed. Normalisation maps or drops characters one at a
 * time, so the normalised text before the caret is exactly the prefix of the normalised value.
 */
export const caretAfterNormalise = (
  rule: InputRule,
  typed: string,
  caret: number,
  normalised: string,
): number => Math.min(normalised.length, normalizeForRule(rule, typed.slice(0, caret)).length);

/** How a field of this kind should ask the on-screen keyboard, and which way it reads. */
export const inputRuleAttributes = (
  rule: InputRule,
): { inputMode?: 'numeric' | 'decimal' | 'tel'; dir?: 'ltr' | 'rtl' } => {
  switch (rule) {
    case 'integer':
    case 'digits':
      return { inputMode: 'numeric', dir: 'ltr' };
    case 'decimal':
      return { inputMode: 'decimal', dir: 'ltr' };
    case 'phone':
      return { inputMode: 'tel', dir: 'ltr' };
    case 'english':
      return { dir: 'ltr' };
    case 'arabic':
      return { dir: 'rtl' };
    default:
      return {};
  }
};
