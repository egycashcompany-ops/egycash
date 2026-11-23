// Fleet's figures, in Latin digits in both languages — owner, 2026-11-23: «اى ارقام خليها بالانجلش
// حتى لو عربى» / «انا عاوزك تعدل حاجات الحركة فقط».
//
// The helpers are TWINS of the shared `formatNumber` / `formatDate` / `formatDateTime`: what this
// proves is that each one says exactly what the shared one says — the same «—» for nothing, the
// same English byte for byte, the same Arabic date shape with its RLM marks — and that the ONLY
// thing that differs is the Arabic numbering system. A date compared by hand would miss the U+200F
// the Arabic shape carries, so the expectation is always the shared output with its digits folded.
import { describe, expect, it } from 'vitest';
import { asciiDigits, formatDate, formatDateTime, formatNumber } from '../../../shared/lib/format';
import { latinDate, latinDateTime, latinNumber } from './fleet-figures';

const ARABIC_INDIC = /[٠-٩۰-۹٫٬]/;

const DATES: readonly (string | Date)[] = [
  '2026-11-07',
  '2026-01-31T23:30:00.000Z',
  '2025-12-01T08:05:00Z',
  '2026-09-29T12:00:00.000Z',
  new Date(2026, 2, 9, 14, 5),
];

describe('latinNumber', () => {
  it('groups with a Latin comma and keeps the decimals', () => {
    expect(latinNumber(154320.5)).toBe('154,320.5');
    expect(latinNumber(120000)).toBe('120,000');
    expect(latinNumber(0)).toBe('0');
  });

  it('says «—» for a missing figure, as the shared helper does', () => {
    expect(latinNumber(null)).toBe('—');
    expect(latinNumber(undefined)).toBe('—');
    expect(latinNumber(null)).toBe(formatNumber(null, 'ar'));
  });

  it("is the shared helper's English, byte for byte", () => {
    for (const value of [0, 7, 1234, 120000, 154320.5, 1.125, -250]) {
      expect(latinNumber(value), String(value)).toBe(formatNumber(value, 'en'));
    }
  });

  it('writes no Arabic-Indic digit or mark, and no LRM before a minus', () => {
    for (const value of [0, 7, 1234, 120000, 154320.5, 1.125, -250]) {
      expect(latinNumber(value), String(value)).not.toMatch(ARABIC_INDIC);
    }
    expect(latinNumber(-250)).toBe('-250');
  });
});

describe('latinDate', () => {
  it('is the shared Arabic date with only its digits changed — same order, same RLM marks', () => {
    for (const value of DATES) {
      const shared = formatDate(value, 'ar');
      const latin = latinDate(value, 'ar');
      expect(latin, String(value)).toBe(asciiDigits(shared));
      expect(latin, String(value)).not.toMatch(ARABIC_INDIC);
      expect(latin, `${String(value)}: the RLM marks stay`).toContain('‏');
    }
  });

  it("is the shared helper's English, byte for byte", () => {
    for (const value of DATES) {
      expect(latinDate(value, 'en'), String(value)).toBe(formatDate(value, 'en'));
    }
  });

  it('writes the day first, as the Arabic screens always have', () => {
    expect(latinDate('2026-11-07', 'ar')).toBe('07‏/11‏/2026');
  });

  it('says «—» for nothing and for an invalid date', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(latinDate(null, locale)).toBe('—');
      expect(latinDate(undefined, locale)).toBe('—');
      expect(latinDate('not a date', locale)).toBe('—');
      expect(latinDate(new Date(Number.NaN), locale)).toBe('—');
      expect(latinDate('not a date', locale)).toBe(formatDate('not a date', locale));
    }
  });
});

describe('latinDateTime', () => {
  it('is the shared Arabic date and time with only its digits changed', () => {
    for (const value of DATES) {
      const shared = formatDateTime(value, 'ar');
      const latin = latinDateTime(value, 'ar');
      expect(latin, String(value)).toBe(asciiDigits(shared));
      expect(latin, String(value)).not.toMatch(ARABIC_INDIC);
    }
  });

  it("is the shared helper's English, byte for byte", () => {
    for (const value of DATES) {
      expect(latinDateTime(value, 'en'), String(value)).toBe(formatDateTime(value, 'en'));
    }
  });

  it('says «—» for nothing and for an invalid date', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(latinDateTime(null, locale)).toBe('—');
      expect(latinDateTime(undefined, locale)).toBe('—');
      expect(latinDateTime('not a date', locale)).toBe('—');
    }
  });
});

describe('the shared helpers did not move', () => {
  it('still write Arabic-Indic for every other module', () => {
    // The rule is Fleet's alone («انا عاوزك تعدل حاجات الحركة فقط»): HR, ATM, Operations and gold
    // keep the shared helpers exactly as they were.
    expect(formatNumber(1000, 'ar')).toMatch(/[٠-٩]/);
    expect(formatDate('2026-11-07', 'ar')).toMatch(/[٠-٩]/);
  });
});
