import { describe, expect, it } from 'vitest';
import {
  maskNationalId,
  normalizeEgyptianPhone,
  parseNationalId,
  NationalIdSchema,
  PhoneNumberSchema,
} from './value-objects.js';

describe('parseNationalId', () => {
  it('decodes a valid 20th-century id', () => {
    // 2 980101 12 34567 → born 1998-01-01, Dakahlia (12), serial digit 6 → female
    const parts = parseNationalId('29801011234567');
    expect(parts).not.toBeNull();
    expect(parts?.birthDate.toISOString().slice(0, 10)).toBe('1998-01-01');
    expect(parts?.governorate).toBe('Dakahlia');
    expect(parts?.gender).toBe('female');
  });

  it('decodes a valid 21st-century id with male serial', () => {
    const parts = parseNationalId('30503150101512');
    expect(parts).not.toBeNull();
    expect(parts?.birthDate.toISOString().slice(0, 10)).toBe('2005-03-15');
    expect(parts?.governorate).toBe('Cairo');
    expect(parts?.gender).toBe('male');
  });

  it.each([
    ['too short', '2980101123456'],
    ['non-digits', '2980101123456x'],
    ['bad century', '19801011234567'],
    ['bad month', '29813011234567'],
    ['bad day', '29802301234567'],
    ['unknown governorate', '29801019934567'],
    ['future date', '39912311234567'],
  ])('rejects %s', (_label, value) => {
    expect(parseNationalId(value)).toBeNull();
    expect(NationalIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('maskNationalId', () => {
  it('masks the middle digits for list views', () => {
    expect(maskNationalId('29801011234567')).toBe('298*******4567');
  });
});

describe('normalizeEgyptianPhone', () => {
  it.each([
    ['01012345678', '01012345678'],
    ['+201012345678', '01012345678'],
    ['00201112345678', '01112345678'],
    ['010 1234 5678', '01012345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toBe(expected);
    expect(PhoneNumberSchema.parse(input)).toBe(expected);
  });

  it.each([['0212345678'], ['01312345678'], ['+3512345678'], ['abc']])('rejects %s', (input) => {
    expect(normalizeEgyptianPhone(input)).toBeNull();
    expect(PhoneNumberSchema.safeParse(input).success).toBe(false);
  });
});
