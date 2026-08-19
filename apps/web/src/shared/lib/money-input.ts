// Typing an amount, one keystroke at a time.
//
// A money field has two values at once: what the user READS (1,000) and what the form SUBMITS
// (1000). Everything here converts between the two, and it is deliberately free of React so the
// whole of it is testable in a node suite — the component around it holds no rules at all.
//
// The grouping rule is the legacy one, verbatim: `\B(?=(\d{3})+(?!\d))` is the regex the operations
// screens used at main_ops.ejs:874 and 41 sites beside it. Read and write now group identically
// because they group through the same rule.
import { MONEY_DECIMAL_PLACES, asciiDigits } from '@ecms/contracts';

/** Characters that survive into the submitted value — and the ones the caret is counted in. */
const CANONICAL = /[0-9.]/;

/**
 * What the caret is counted in on the way IN. Wider than `CANONICAL` because the text being read
 * is whatever the user's keyboard produced: an Arabic keyboard types ٠١٠ and ٫ for the decimal
 * point, and those are digits to the person typing them.
 */
const TYPED = /[0-9٠-٩۰-۹.٫]/;

/**
 * The submitted form of what was typed: ASCII digits, at most one decimal point, no separators.
 *
 * Never negative — every money field in the system is `min={0}`, and a minus sign simply is not a
 * character an amount can contain, so dropping it is the same constraint the old
 * `<input type="number" min={0}>` carried.
 *
 * Trailing state is PRESERVED, not tidied: `1000.` is what a half-typed `1000.5` looks like, and
 * rewriting it to `1000` mid-keystroke would fight the person typing.
 */
export const sanitizeAmount = (raw: string): string => {
  const ascii = asciiDigits(raw)
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/٬/g, ''); // Arabic thousands separator
  const kept = ascii.replace(/[^0-9.]/g, '');
  const dot = kept.indexOf('.');
  if (dot === -1) return kept;
  // Only the FIRST point is a decimal point; later ones are noise. Decimals are capped at what
  // the contract records (`MoneyAmountSchema` refuses more), so the field cannot accept a value
  // the API would then reject.
  const decimals = kept.slice(dot + 1).replace(/\./g, '').slice(0, MONEY_DECIMAL_PLACES);
  return `${kept.slice(0, dot)}.${decimals}`;
};

/** The read form: the same digits, grouped in threes. `1000` → `1,000`, `1000.5` → `1,000.5`. */
export const groupAmount = (canonical: string): string => {
  const dot = canonical.indexOf('.');
  const whole = dot === -1 ? canonical : canonical.slice(0, dot);
  const rest = dot === -1 ? '' : canonical.slice(dot);
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
};

/** How many meaningful characters sit before the caret in the text the user just typed. */
export const typedBeforeCaret = (raw: string, caret: number): number =>
  [...raw.slice(0, caret)].filter((ch) => TYPED.test(ch)).length;

/**
 * Where the caret belongs in the reformatted text: after the same COUNT of meaningful characters
 * it was after before. Counting them, rather than keeping the offset, is what survives a comma
 * appearing or disappearing to the left of the caret — the whole reason typing in a grouped field
 * usually throws the caret to the end.
 */
export const caretAfterGrouping = (grouped: string, typed: number): number => {
  if (typed <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < grouped.length; i += 1) {
    if (CANONICAL.test(grouped[i] ?? '')) {
      seen += 1;
      if (seen === typed) return i + 1;
    }
  }
  return grouped.length;
};

/**
 * Backspace and Delete ONTO a separator, resolved before the browser acts.
 *
 * Left alone, deleting the comma in `1,000` removes a character that the reformat immediately
 * puts back — the field flickers and nothing happens, at the one position people edit most. The
 * intent is plainly to remove the digit the separator is standing in front of, so this returns
 * the text and caret for doing exactly that, or `null` when the keystroke is ordinary and the
 * browser should handle it.
 */
export const separatorDelete = (
  shown: string,
  caret: number,
  key: 'Backspace' | 'Delete',
): { raw: string; caret: number } | null => {
  if (key === 'Backspace' && shown[caret - 1] === ',') {
    return { raw: shown.slice(0, caret - 2) + shown.slice(caret), caret: caret - 2 };
  }
  if (key === 'Delete' && shown[caret] === ',') {
    return { raw: shown.slice(0, caret) + shown.slice(caret + 2), caret };
  }
  return null;
};
