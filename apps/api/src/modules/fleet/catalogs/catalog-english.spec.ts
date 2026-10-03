import { describe, expect, it } from 'vitest';
import { englishName, hasArabicLetters, transliterate, withEnglishName } from './catalog-english';

describe('the English side of a catalog name', () => {
  it('uses the house’s translation, whatever the spelling of hamza, taa marbuta or spacing', () => {
    expect(englishName('سائق ب')).toBe('Driver B');
    expect(englishName('اولى')).toBe('First class');
    expect(englishName('أولى')).toBe('First class');
    expect(englishName('فيشة ضفيرة  ABS')).toBe('ABS harness connector');
    expect(englishName('نقل اموال')).toBe('Cash transport');
  });

  it('prefers a pair it is handed — the vocabulary’s — over its own list', () => {
    expect(englishName('فلتر زيت', [['فلتر زيت', 'Oil filter']])).toBe('Oil filter');
    // A pair whose English is still Arabic is no translation.
    expect(englishName('سائق ب', [['سائق ب', 'سائق ب']])).toBe('Driver B');
  });

  it('spells a name nobody has translated yet in Latin letters', () => {
    expect(transliterate('مصنع قادر')).toBe('Msna Qadr');
    expect(hasArabicLetters(englishName('ورشة الحاج سيد'))).toBe(false);
  });

  it('leaves an English name exactly as it is, and translates one that is still Arabic', () => {
    expect(withEnglishName({ ar: 'زيت', en: 'Oil' })).toEqual({ ar: 'زيت', en: 'Oil' });
    expect(withEnglishName({ ar: 'منسق جراج', en: 'منسق جراج' })).toEqual({
      ar: 'منسق جراج',
      en: 'Garage coordinator',
    });
  });

  it('counts only letters as Arabic — digits are not a script', () => {
    expect(hasArabicLetters('Sprinter ٥١٥')).toBe(false);
    expect(hasArabicLetters('Sprinter فلتر')).toBe(true);
  });
});
