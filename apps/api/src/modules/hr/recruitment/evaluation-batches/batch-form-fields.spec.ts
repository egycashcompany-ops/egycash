import { describe, expect, it } from 'vitest';
import { DRIVING_GRADE_LABELS, formatAddress } from './batch-form-fields';
import { DRIVING_TEST_GRADES } from '@ecms/contracts';

describe('an address as one printed line', () => {
  it('reads street, district, city, governorate', () => {
    expect(
      formatAddress({ line1: 'شارع 9', line2: 'المعادي', city: 'القاهرة', governorate: 'القاهرة' }),
    ).toBe('شارع 9، المعادي، القاهرة، القاهرة');
  });

  it('drops an empty part instead of leaving a stray separator', () => {
    expect(formatAddress({ line1: 'شارع 9', city: 'القاهرة', governorate: 'الجيزة' })).toBe(
      'شارع 9، القاهرة، الجيزة',
    );
    expect(formatAddress({ line1: 'شارع 9', line2: '   ', city: 'س', governorate: 'ج' })).toBe(
      'شارع 9، س، ج',
    );
  });

  it('omits the postal code — a five-digit code is noise on a handwritten row', () => {
    const line = formatAddress({
      line1: 'شارع 9',
      city: 'القاهرة',
      governorate: 'القاهرة',
      postalCode: '11431',
    });
    expect(line).not.toContain('11431');
  });

  it('answers null for nothing to print, rather than an empty string', () => {
    expect(formatAddress(null)).toBeNull();
    expect(formatAddress(undefined)).toBeNull();
  });
});

describe('the driving grades', () => {
  it('labels every grade the contract declares, in both languages', () => {
    for (const grade of DRIVING_TEST_GRADES) {
      expect(DRIVING_GRADE_LABELS[grade].ar.length).toBeGreaterThan(0);
      expect(DRIVING_GRADE_LABELS[grade].en.length).toBeGreaterThan(0);
    }
  });

  it('runs weakest first, the order the official form prints its columns', () => {
    expect(DRIVING_TEST_GRADES).toEqual(['weak', 'good', 'veryGood', 'excellent']);
  });
});
