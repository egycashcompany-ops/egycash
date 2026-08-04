import { describe, expect, it } from 'vitest';
import {
  EGYPT_GOVERNORATES,
  NationalIdSchema,
  PostalCodeSchema,
  asciiDigits,
  normalizeEgyptianPhone,
  parseNationalId,
  EGYPT_GOVERNORATE_CODES,
  citiesOfGovernorate,
  findGovernorate,
  isArabicName,
  isCityOfGovernorate,
  isEmail,
  isEnglishName,
  isPostalCode,
  normalizeReligion,
} from './index.js';

describe('name rules', () => {
  it('accepts an Arabic name and rejects anything that is not Arabic letters', () => {
    expect(isArabicName('أحمد محمد علي')).toBe(true);
    expect(isArabicName('عبد الرحمن')).toBe(true);
    expect(isArabicName('محمد ٢')).toBe(false); // Arabic-Indic digit — inside the Arabic block
    expect(isArabicName('محمد 2')).toBe(false);
    expect(isArabicName('Ahmed محمد')).toBe(false);
    expect(isArabicName('Ahmed')).toBe(false);
  });

  it('accepts a Latin name and rejects Arabic or digits in it', () => {
    expect(isEnglishName('Ahmed Mohamed Ali')).toBe(true);
    expect(isEnglishName("O'Brien-Smith")).toBe(true);
    expect(isEnglishName('Ahmed 2')).toBe(false);
    expect(isEnglishName('أحمد')).toBe(false);
  });
});

describe('email rule', () => {
  it('requires an @ and a dotted domain', () => {
    expect(isEmail('a.b+tag@example.co.uk')).toBe(true);
    expect(isEmail('user@example')).toBe(false); // valid per RFC, useless as a contact
    expect(isEmail('user@.com')).toBe(false);
    expect(isEmail('user example@x.com')).toBe(false);
    expect(isEmail('مستخدم@example.com')).toBe(false); // ASCII only
  });
});

describe('postal code rule', () => {
  it('takes five digits and nothing else', () => {
    expect(isPostalCode('11511')).toBe(true);
    expect(isPostalCode('1151')).toBe(false);
    expect(isPostalCode('11511a')).toBe(false);
    expect(isPostalCode('١١٥١١')).toBe(true); // Arabic digits are the same digits
  });
});

describe('religion', () => {
  it('folds the spellings a card or an OCR read produces', () => {
    expect(normalizeReligion('مسلم')).toBe('مسلم');
    expect(normalizeReligion('مسلمة')).toBe('مسلم');
    expect(normalizeReligion('مسيحى')).toBe('مسيحي');
    expect(normalizeReligion('مسيحية')).toBe('مسيحي');
    expect(normalizeReligion('بوذي')).toBeUndefined();
  });
});

describe('Egyptian geography', () => {
  it('covers every governorate the National-ID number can decode to', () => {
    // '88' is "born abroad" — a valid ID code, not a governorate, so it is deliberately absent.
    const fromIds = Object.entries(EGYPT_GOVERNORATE_CODES)
      .filter(([code]) => code !== '88')
      .map(([code]) => code);
    expect(EGYPT_GOVERNORATES.map((g) => g.code).sort()).toEqual(fromIds.sort());
  });

  it('resolves a governorate by Arabic name, English name, or ID code', () => {
    expect(findGovernorate('القاهرة')?.code).toBe('01');
    expect(findGovernorate('Cairo')?.code).toBe('01');
    expect(findGovernorate('cairo')?.code).toBe('01');
    expect(findGovernorate('01')?.ar).toBe('القاهرة');
    expect(findGovernorate('Atlantis')).toBeUndefined();
  });

  it('scopes cities to their governorate', () => {
    expect(citiesOfGovernorate('الجيزة')).toContain('الدقي');
    expect(citiesOfGovernorate('Giza')).toContain('الدقي');
    expect(isCityOfGovernorate('الجيزة', 'الدقي')).toBe(true);
    expect(isCityOfGovernorate('القاهرة', 'الدقي')).toBe(false);
    expect(citiesOfGovernorate('Atlantis')).toEqual([]);
  });

  it('has no empty city list and no duplicate city inside one governorate', () => {
    for (const g of EGYPT_GOVERNORATES) {
      expect(g.cities.length, g.ar).toBeGreaterThan(0);
      expect(new Set(g.cities).size, g.ar).toBe(g.cities.length);
    }
  });
});

// Numbers arrive formatted, or typed on an Arabic keyboard. Everything numeric folds to ASCII and
// drops its separators BEFORE the shape is judged — and what is stored is the folded form, so one
// identity never ends up recorded in two encodings.
describe('digit folding and separator cleaning', () => {
  it('folds both Arabic-Indic digit ranges', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(asciiDigits('۰۱۲۳')).toBe('0123');
    expect(asciiDigits('abc 12')).toBe('abc 12');
  });

  it('accepts a phone with separators, an international prefix, or Arabic digits', () => {
    expect(normalizeEgyptianPhone('010 1234 5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('010-1234-5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('(010) 1234 5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('+20 10 1234 5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('0020 101 234 5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    // Cleaning is not permission: a wrong network is still wrong however it is spaced.
    expect(normalizeEgyptianPhone('013 1234 5678')).toBeNull();
  });

  it('reads a national ID typed in Arabic and stores it in ASCII', () => {
    expect(parseNationalId('٢٩٠٠١٠١١٢٠١٢٣٤')?.governorate).toBe('Dakahlia'); // code 12
    const parsed = NationalIdSchema.safeParse('٢٩٠٠١٠١١٢٠١٢٣٤');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe('29001011201234');
    expect(NationalIdSchema.safeParse(' 29001011201234 ').success).toBe(true);
  });

  it('reads a postal code typed in Arabic and stores it in ASCII', () => {
    expect(isPostalCode('١١٥١١')).toBe(true);
    const parsed = PostalCodeSchema.safeParse('١١٥١١');
    expect(parsed.success && parsed.data).toBe('11511');
  });
});
