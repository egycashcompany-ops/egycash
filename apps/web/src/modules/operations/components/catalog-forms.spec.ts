// The catalog forms' pure decisions — the parts that carry LEGACY BEHAVIOUR rather than layout.
//
// These are extracted as named functions precisely so they can be asserted here: the finance-area
// default is a documented legacy quirk (Q24, PRESERVE), not an accident, and a future reader who
// "tidies" it away should fail a test that says why it exists.
import { describe, expect, it } from 'vitest';
import { branchLocation, financeAreaDefault, orNull, parseAliases } from './CatalogDialogs';

describe('orNull', () => {
  it('turns blank and whitespace-only input into null, not an empty string', () => {
    expect(orNull('')).toBeNull();
    expect(orNull('   ')).toBeNull();
  });

  it('trims a real value', () => {
    expect(orNull('  المهندسين  ')).toBe('المهندسين');
  });
});

describe('financeAreaDefault — legacy `area2 = area2 || area` (contad_app.js:1909, Q24)', () => {
  it('falls back to the operations area when finance is left blank', () => {
    expect(financeAreaDefault('الجيزة', '')).toBe('الجيزة');
    expect(financeAreaDefault('الجيزة', '   ')).toBe('الجيزة');
  });

  it('keeps an explicit finance area — the fallback is a default, not an override', () => {
    expect(financeAreaDefault('الجيزة', 'القاهرة')).toBe('القاهرة');
  });

  it('is null when neither is given — legacy stored nothing rather than an empty string', () => {
    expect(financeAreaDefault('', '')).toBeNull();
  });
});

describe('parseAliases — the legacy currency synonym lists as editable data', () => {
  it('splits on commas and newlines, trimming each', () => {
    expect(parseAliases('مصري, جنيه\nEGP')).toEqual(['مصري', 'جنيه', 'EGP']);
  });

  it('drops empties so a trailing separator cannot create a blank alias', () => {
    expect(parseAliases('EGP,,  ,\n')).toEqual(['EGP']);
  });

  it('is an empty list for empty input, never [""]', () => {
    expect(parseAliases('')).toEqual([]);
    expect(parseAliases('   ')).toEqual([]);
  });
});

describe('branchLocation — the field that was being erased on every save', () => {
  const POINT = { lat: 30.0444196, lng: 31.2357116 };

  // The dialog hard-coded `location: null` in its submit. `location` has existed on the contract,
  // the model and the captain's read model since B1 — so editing a branch's NAME silently threw
  // away its coordinates, and nothing anywhere said so.
  it('keeps a point that was already set', () => {
    expect(branchLocation('', POINT)).toEqual({ addressLine: null, coordinates: POINT });
  });

  it('keeps an address with no point, and a point with no address', () => {
    expect(branchLocation('١٥ شارع التحرير', null)).toEqual({
      addressLine: '١٥ شارع التحرير',
      coordinates: null,
    });
    expect(branchLocation('  ', POINT)).toEqual({ addressLine: null, coordinates: POINT });
  });

  it('carries both when both are given', () => {
    expect(branchLocation('١٥ شارع التحرير', POINT)).toEqual({
      addressLine: '١٥ شارع التحرير',
      coordinates: POINT,
    });
  });

  // An empty shell would read as "this branch HAS a location" to every consumer, and the captain's
  // screen branches on exactly that.
  it('is null — not an empty shell — when neither is given', () => {
    expect(branchLocation('', null)).toBeNull();
    expect(branchLocation('   ', null)).toBeNull();
  });
});
