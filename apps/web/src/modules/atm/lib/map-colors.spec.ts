// Map colours (spec §9.4): the suggested colour, the casing rule (WCAG non-text contrast against the
// map), and the bank colours — the catalog's since DEC-35 — with their grey for «بنك غير محدد».
import { describe, expect, it } from 'vitest';
import { ATM_BANK_SEED, ATM_MAP_ZONE_PALETTE } from '@ecms/contracts';
import { NO_ZONE_GREY, ZONE_PALETTE, contrastRatio, needsCasing, suggestColor } from './map-colors';
import { makeBankLookup, type LookupBank } from './bank-catalog';
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

describe('banks (through the catalog lookup)', () => {
  const seeds = makeBankLookup();
  // A synthetic seventh bank in a pale colour, and NXT curated to a lighter blue.
  const catalog: LookupBank[] = [
    ...ATM_BANK_SEED.map((seed) => ({ ...seed, isActive: true })),
    {
      code: 'QNB',
      name: { ar: 'بنك تجريبي', en: 'SYN Bank' },
      color: '#92D050',
      sortOrder: 70,
      isActive: true,
    },
  ].map((bank) => (bank.code === 'NXT' ? { ...bank, color: '#B4C7E7' } : bank));
  const lookup = makeBankLookup(catalog);

  it('a dot is the catalog colour, and grey without a bank (DM-17)', () => {
    for (const seed of ATM_BANK_SEED) expect(seeds.color(seed.code)).toBe(seed.color);
    expect(lookup.color('QNB')).toBe('#92D050');
    expect(lookup.color('NXT')).toBe('#B4C7E7');
    expect(lookup.color(null)).toBe(NO_ZONE_GREY);
  });

  it('the ring is decided by contrast against the map, not by a list of three', () => {
    expect(seeds.codes.filter((code) => seeds.isPale(code))).toEqual(['CIB', 'HDB', 'BRK']);
    // A seventh bank's pale green and a curated pale NXT get the ring; grey never does.
    expect(lookup.isPale('QNB')).toBe(true);
    expect(lookup.isPale('NXT')).toBe(true);
    expect(lookup.isPale(null)).toBe(false);
    for (const bank of catalog) {
      expect(lookup.isPale(bank.code)).toBe(contrastRatio(bank.color, '#f2efe9') < 3);
    }
  });
});
