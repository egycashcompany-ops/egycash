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
      address: null,
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
});
