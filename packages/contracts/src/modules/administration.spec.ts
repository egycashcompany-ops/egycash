// The master codes (design §2.8, §19.7; OD-05 A): «ITM-00001» formats and parses, one spelling per
// number, and no number a counter never hands out — 0, a negative, a fraction, an overflow — makes
// or reads a code (the `consumable-number.spec.ts` shape).
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_MASTER_CODE_DIGITS,
  ADMINISTRATION_MASTER_CODE_PREFIXES,
  formatAdministrationMasterCode,
  parseAdministrationMasterCode,
} from './administration.js';

describe('the master codes', () => {
  it('codes an item «ITM-00001», five digits, generated (OD-05 A)', () => {
    expect(ADMINISTRATION_MASTER_CODE_PREFIXES).toEqual({ item: 'ITM' });
    expect(ADMINISTRATION_MASTER_CODE_DIGITS).toBe(5);
    expect(formatAdministrationMasterCode('item', 1)).toBe('ITM-00001');
    expect(formatAdministrationMasterCode('item', 4321)).toBe('ITM-04321');
  });

  it('grows wider past five digits rather than cutting the number', () => {
    expect(formatAdministrationMasterCode('item', 99_999)).toBe('ITM-99999');
    expect(formatAdministrationMasterCode('item', 123_456)).toBe('ITM-123456');
  });

  it.each([
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['an overflow', Number.MAX_SAFE_INTEGER + 1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('refuses to format %s', (_label, seq) => {
    expect(() => formatAdministrationMasterCode('item', seq)).toThrow(RangeError);
  });

  it('parses what it formats, back to the same number', () => {
    for (const seq of [1, 42, 99_999, 100_000, Number.MAX_SAFE_INTEGER]) {
      const code = formatAdministrationMasterCode('item', seq);
      expect(parseAdministrationMasterCode(code), code).toEqual({ kind: 'item', seq });
    }
  });

  it.each([
    ['zero', 'ITM-00000'],
    ['a negative', 'ITM--0001'],
    ['a fraction', 'ITM-00001.5'],
    ['an overflow', 'ITM-99999999999999999999'],
    ['too few digits', 'ITM-1'],
    ['a padding the formatter never writes', 'ITM-000001'],
    ['an unknown prefix', 'ABC-00001'],
    ['lower case', 'itm-00001'],
    ['a space', 'ITM- 00001'],
    ['nothing after the dash', 'ITM-'],
    ['Arabic-Indic digits', 'ITM-٠٠٠٠١'],
    ['an empty string', ''],
  ])('reads %s as no code', (_label, code) => {
    expect(parseAdministrationMasterCode(code)).toBeNull();
  });
});
