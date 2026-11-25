// The one Arabic name fold (fold-name.ts): two spellings of one name fold to one key, and two
// different names do not.
import { describe, expect, it } from 'vitest';
import { foldName } from './fold-name.js';

describe('foldName', () => {
  it('folds the hamza forms, taa marbuta, alef maqsura and spacing', () => {
    expect(foldName('الأسكندرية')).toBe(foldName('الاسكندرية'));
    expect(foldName('إدارة')).toBe(foldName('ادارة'));
    expect(foldName('آلة')).toBe(foldName('الة'));
    expect(foldName('قطعة')).toBe(foldName('قطعه'));
    expect(foldName('مستشفى')).toBe(foldName('مستشفي'));
    expect(foldName('لاب توب')).toBe(foldName('لابتوب'));
  });

  it('drops diacritics and tatweel', () => {
    expect(foldName('مُحَمَّد')).toBe(foldName('محمد'));
    expect(foldName('مـحـمـد')).toBe(foldName('محمد'));
  });

  it('ignores case and compatibility forms in Latin names', () => {
    expect(foldName('HP LaserJet')).toBe(foldName('hp laserjet'));
    expect(foldName('ＨＰ')).toBe(foldName('hp'));
  });

  it('keeps different names apart', () => {
    expect(foldName('طابعة')).not.toBe(foldName('شاشة'));
    expect(foldName('ورق A4')).not.toBe(foldName('ورق A3'));
  });
});
