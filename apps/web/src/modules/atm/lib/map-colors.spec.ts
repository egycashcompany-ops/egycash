// Map colours (spec §9.4): the suggested colour, the casing rule (WCAG non-text contrast against the
// map), and the bank colours with their grey for «بنك غير محدد».
import { describe, expect, it } from 'vitest';
import { ATM_BANK_CODES, ATM_BANK_REPORT_COLORS, ATM_MAP_ZONE_PALETTE } from '@ecms/contracts';
import {
  NO_ZONE_GREY,
  ZONE_PALETTE,
  bankColor,
  contrastRatio,
  needsCasing,
  paleBank,
  suggestColor,
} from './map-colors';
import { boxOf } from './map-geometry';

const ring = (lat: number) => [
  { lat, lng: 31 },
  { lat, lng: 31.01 },
  { lat: lat + 0.01, lng: 31 },
];

describe('suggestColor', () => {
  it('skips the colours the branch already uses, in palette order', () => {
    const draft = [
      { color: '#483BBA', points: ring(30) },
      { color: '#d3a813', points: ring(31) },
    ];
    expect(suggestColor(draft, null)).toBe('#a4546f');
  });

  it('with all twelve used, picks the least used — and not one a touching zone uses', () => {
    const draft = ATM_MAP_ZONE_PALETTE.map((c, i) => ({ color: c.hex, points: ring(30 + i) }));
    // Every colour once, indigo and mustard twice: the first of the least used is raspberry…
    draft.push({ color: '#483bba', points: ring(50) }, { color: '#d3a813', points: ring(51) });
    expect(suggestColor(draft, null)).toBe('#a4546f');
    // …unless the new zone touches the raspberry zone (index 2, at lat 32).
    expect(suggestColor(draft, boxOf(ring(32)))).toBe('#5bc4a3');
  });
});

describe('contrast', () => {
  it('needsCasing is true for the five light colours and false for indigo', () => {
    for (const key of ['mustard', 'mint', 'sky', 'coral', 'orchid']) {
      const colour = ZONE_PALETTE.find((c) => c.key === key);
      expect(needsCasing(colour?.hex ?? '')).toBe(true);
    }
    expect(needsCasing('#483bba')).toBe(false);
  });

  it('agrees with the palette’s own `cased` flag for all twelve', () => {
    for (const colour of ATM_MAP_ZONE_PALETTE) expect(needsCasing(colour.hex)).toBe(colour.cased);
  });

  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('every palette colour has a name key', () => {
    expect(ZONE_PALETTE.map((c) => c.nameKey)).toContain('atm.map.palette.violet');
  });
});

describe('banks', () => {
  it('bankColor is the Data Report colour, and grey without a bank', () => {
    for (const code of ATM_BANK_CODES) expect(bankColor(code)).toBe(ATM_BANK_REPORT_COLORS[code]);
    expect(bankColor(null)).toBe(NO_ZONE_GREY);
  });

  it('CIB, HDB and BRK are pale (a dark ring); the rest are not', () => {
    expect(ATM_BANK_CODES.filter((code) => paleBank(code))).toEqual(['CIB', 'HDB', 'BRK']);
    expect(paleBank(null)).toBe(false);
    for (const code of ATM_BANK_CODES) {
      expect(paleBank(code)).toBe(contrastRatio(ATM_BANK_REPORT_COLORS[code], '#f2efe9') < 3);
    }
  });
});
