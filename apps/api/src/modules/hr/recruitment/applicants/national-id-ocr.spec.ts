import { afterEach, describe, expect, it } from 'vitest';
import {
  extractNationalIdFields,
  nullNationalIdOcrProvider,
  resetNationalIdOcrProvider,
  setNationalIdOcrProvider,
} from './national-id-ocr';

afterEach(() => resetNationalIdOcrProvider());

describe('national-id OCR seam (OQ-30 abstraction)', () => {
  it('reports unavailable and extracts nothing with the default null stub', async () => {
    const result = await extractNationalIdFields({ frontFileId: 'x' });
    expect(result).toEqual({
      available: false,
      nationalId: null,
      fullNameAr: null,
      fullNameEn: null,
      address: null,
      city: null,
      maritalStatus: null,
      religion: null,
      nationalIdExpiry: null,
      derived: null,
    });
  });

  it('the null stub is the default provider', () => {
    expect(nullNationalIdOcrProvider.available).toBe(false);
  });

  it('derives birth date / gender / governorate from a read number (real, no dependency)', async () => {
    // 29001011500018 → century 2 = 19xx, born 1990-01-01, governorate 15 = Kafr El Sheikh,
    // gender digit (index 12) = 1 (odd) = male.
    setNationalIdOcrProvider({
      id: 'test',
      available: true,
      extract: () =>
        Promise.resolve({ nationalId: { value: '29001011500018', confidence: 'high' } }),
    });
    const result = await extractNationalIdFields({ frontFileId: 'f' });
    expect(result.available).toBe(true);
    expect(result.nationalId?.value).toBe('29001011500018');
    expect(result.derived).not.toBeNull();
    expect(result.derived?.gender).toBe('male');
    expect(result.derived?.governorate).toBe('Kafr El Sheikh');
    expect(result.derived?.birthDate.startsWith('1990-01-01')).toBe(true);
  });

  it('leaves derived null when the provider returns an unparseable number', async () => {
    setNationalIdOcrProvider({
      id: 'test',
      available: true,
      extract: () => Promise.resolve({ nationalId: { value: '000', confidence: 'low' } }),
    });
    const result = await extractNationalIdFields({ frontFileId: 'f' });
    expect(result.derived).toBeNull();
  });

  it('passes through the back-of-card fields a provider reads (name, marital, religion, expiry)', async () => {
    setNationalIdOcrProvider({
      id: 'test',
      available: true,
      extract: () =>
        Promise.resolve({
          fullNameAr: { value: 'محمد أحمد', confidence: 'high' },
          fullNameEn: { value: 'Mohamed Ahmed', confidence: 'medium' },
          maritalStatus: { value: 'متزوج', confidence: 'medium' },
          religion: { value: 'مسلم', confidence: 'low' },
          city: { value: 'طنطا', confidence: 'medium' },
          nationalIdExpiry: { value: '2030-01-01T00:00:00.000Z', confidence: 'medium' },
        }),
    });
    const result = await extractNationalIdFields({ frontFileId: 'f', backFileId: 'b' });
    expect(result.available).toBe(true);
    expect(result.fullNameAr?.value).toBe('محمد أحمد');
    expect(result.fullNameEn?.value).toBe('Mohamed Ahmed');
    expect(result.maritalStatus?.value).toBe('متزوج');
    expect(result.religion?.value).toBe('مسلم');
    expect(result.city?.value).toBe('طنطا');
    expect(result.nationalIdExpiry?.value).toBe('2030-01-01T00:00:00.000Z');
    // No number read → no derivation.
    expect(result.derived).toBeNull();
  });
});
