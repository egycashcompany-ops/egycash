// «لو 122 فهيبقا مئة اثنان وعشرون جنيها لا غير».
import { describe, expect, it } from 'vitest';
import { amountInArabicWords as words } from './arabic-amount.js';

describe('an amount in Egyptian pounds, written out in Arabic', () => {
  /** The owner's own example — with the «و» Arabic requires between every part. */
  it('writes 122 the way the owner asked, joined properly', () => {
    expect(words(122)).toBe('مائة واثنان وعشرون جنيهًا لا غير');
  });

  it.each([
    [1, 'جنيه واحد لا غير'],
    [2, 'جنيهان لا غير'],
    [3, 'ثلاثة جنيهات لا غير'],
    [10, 'عشرة جنيهات لا غير'],
    [11, 'أحد عشر جنيهًا لا غير'],
    [21, 'واحد وعشرون جنيهًا لا غير'],
    [100, 'مائة جنيه لا غير'],
    [105, 'مائة وخمسة جنيهات لا غير'],
    [1000, 'ألف جنيه لا غير'],
    [7000, 'سبعة آلاف جنيه لا غير'],
    [10000, 'عشرة آلاف جنيه لا غير'],
    [12750, 'اثنا عشر ألفًا وسبعمائة وخمسون جنيهًا لا غير'],
    [1500000, 'مليون وخمسمائة ألف جنيه لا غير'],
  ])('the counted noun agrees with %s', (amount, expected) => {
    expect(words(amount)).toBe(expected);
  });

  /** A dual or a scale word standing directly before the noun takes its construct form. */
  it.each([
    [200, 'مائتا جنيه لا غير'],
    [1200, 'ألف ومائتا جنيه لا غير'],
    [2000, 'ألفا جنيه لا غير'],
    [11000, 'أحد عشر ألف جنيه لا غير'],
    [200000, 'مائتا ألف جنيه لا غير'],
    [2000000, 'مليونا جنيه لا غير'],
  ])('uses the construct form before the noun: %s', (amount, expected) => {
    expect(words(amount)).toBe(expected);
  });

  /** …and the free form when more follows it. */
  it('uses the free form when more follows', () => {
    expect(words(2500)).toBe('ألفان وخمسمائة جنيه لا غير');
  });

  it('writes piastres after the pounds', () => {
    expect(words(85.4)).toBe('خمسة وثمانون جنيهًا وأربعون قرشًا لا غير');
    expect(words(7692.31)).toBe('سبعة آلاف وستمائة واثنان وتسعون جنيهًا وواحد وثلاثون قرشًا لا غير');
  });

  it('refuses what is not a salary rather than writing something wrong', () => {
    expect(words(-5)).toBe('');
    expect(words(Number.NaN)).toBe('');
    expect(words(1_000_000_000)).toBe('');
  });
});
