import { describe, expect, it } from 'vitest';
import { licenceMonthOptions } from './licence-months';

describe('the licence-expiry months offered on the vehicles screen', () => {
  it('lists each month a licence runs out in, oldest first, with its count of cars', () => {
    const options = licenceMonthOptions(
      [
        { licenseExpiresAt: '2027-01-31T00:00:00.000Z' },
        { licenseExpiresAt: '2026-11-03T00:00:00.000Z' },
        { licenseExpiresAt: '2026-11-30T00:00:00.000Z' },
        { licenseExpiresAt: null },
      ],
      'en',
    );
    expect(options.map((option) => option.value)).toEqual(['2026-11', '2027-01']);
    expect(options[0]?.label).toBe('November 2026 (2)');
    expect(options[1]?.label).toBe('January 2027 (1)');
  });

  it('names the months in Arabic on an Arabic screen', () => {
    const [option] = licenceMonthOptions([{ licenseExpiresAt: '2026-11-03T00:00:00.000Z' }], 'ar');
    expect(option?.label).toContain('نوفمبر');
  });
});
