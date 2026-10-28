// How an IT register reads what a reader types into its search box — one rule for every register
// that matches free text against what people typed in.
//
// A number may be typed in any of the three digit sets an Arabic keyboard writes — ASCII "24",
// Arabic-Indic «٢٤», Extended Arabic-Indic «۲۴» — and a register keeps a name or a serial exactly as
// it was typed. So a digit matches its own value in EVERY set, both ways: «٢٤» finds «شاشة 24 بوصة»,
// and "24" finds «شاشة ٢٤ بوصة». The invisible direction marks a text copied out of a chat or a sheet
// carries are not part of it. Everything else is taken literally, letter case ignored.
import { asciiDigits } from '@ecms/contracts';

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;

/** One ASCII digit as every set writes it: `4` → `[4٤۴]`. */
const anyDigitSet = (digit: string): string => {
  const value = Number(digit);
  return `[${digit}${String.fromCharCode(0x0660 + value)}${String.fromCharCode(0x06f0 + value)}]`;
};

/**
 * The typed text as one case-insensitive pattern, or `null` when nothing is left to match. The
 * text is folded to ASCII digits first and escaped — `escapeRegex` never writes a backslash before
 * a digit — so every digit, and only a digit, becomes its class.
 */
export const registerSearchPattern = (typed: string): RegExp | null => {
  const text = asciiDigits(typed).replace(DIRECTION_MARKS, '').trim();
  if (text === '') return null;
  return new RegExp(escapeRegex(text).replace(/[0-9]/g, anyDigitSet), 'i');
};
