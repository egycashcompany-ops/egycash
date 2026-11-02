import { describe, expect, it } from 'vitest';
import { cityInAddressLine, placeInAddressLine } from './ApplicantForm';

// A card rarely prints the city on its own line; the form looks for it inside the address line so
// a scanned applicant is not stopped by an empty city picker.
describe('cityInAddressLine', () => {
  it('finds the markaz named in the line, not the governorate it ends with', () => {
    expect(cityInAddressLine('قنا', 'الحاج سلام مركز فرشوط قنا')).toBe('فرشوط');
  });

  it('prefers the longest name, so a new city beats its old one', () => {
    expect(cityInAddressLine('قنا', 'حي الزهور قنا الجديدة')).toBe('قنا الجديدة');
  });

  it('falls back to the capital when only the governorate is named', () => {
    expect(cityInAddressLine('قنا', 'شارع الجمهورية قنا')).toBe('قنا');
  });

  it('matches across hamza and ta-marbuta spellings, whole words only', () => {
    expect(cityInAddressLine('قنا', 'شارع النيل ابو تشت')).toBe('أبو تشت');
    expect(cityInAddressLine('قنا', 'قريه فرشوطيه')).toBeUndefined();
  });
});

describe('placeInAddressLine', () => {
  it('reads the governorate the line ends with, whatever the birth governorate was', () => {
    expect(placeInAddressLine('٢٠ ش رمضان فر غلى ش كمال حمزه المرج القاهره')).toEqual({
      governorate: 'القاهرة',
    });
    expect(cityInAddressLine('القاهرة', '٢٠ ش رمضان فر غلى ش كمال حمزه المرج القاهره')).toBe(
      'المرج',
    );
  });

  it('says nothing when no governorate is named', () => {
    expect(placeInAddressLine('شارع النيل')).toBeUndefined();
  });
});
