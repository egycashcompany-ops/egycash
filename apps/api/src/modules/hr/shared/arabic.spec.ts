import { describe, expect, it } from 'vitest';
import { escapeRegExp, normalizeArabic } from './arabic';

describe('normalizeArabic', () => {
  it('folds all hamza-carrier alef variants to bare alef', () => {
    for (const v of ['أحمد', 'إحمد', 'آحمد', 'ٱحمد']) {
      expect(normalizeArabic(v)).toBe('احمد');
    }
  });

  it('folds alef maqsura → yaa and taa marbuta → haa', () => {
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفي'));
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'));
  });

  it('strips diacritics (tashkeel) and tatweel', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabic('محـــمد')).toBe('محمد');
  });

  it('collapses whitespace, trims, and lowercases mixed content', () => {
    expect(normalizeArabic('  Ahmed   ALI  ')).toBe('ahmed ali');
  });

  it('is idempotent', () => {
    const once = normalizeArabic('أحمد مصطفى');
    expect(normalizeArabic(once)).toBe(once);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so user input is a literal', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
    expect(new RegExp(escapeRegExp('01[0]')).test('01[0]')).toBe(true);
  });
});
