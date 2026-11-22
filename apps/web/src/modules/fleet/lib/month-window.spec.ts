import { describe, expect, it } from 'vitest';
import { licenceMonthOptions, monthCountOptions } from './licence-months';

/** Any Arabic-Indic digit — what the Arabic options wrote their year and count in until 2026-11-22. */
const ARABIC_INDIC = /[\u0660-\u0669]/u;

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

  it('writes the year and the count in Latin digits, as the rest of the system does', () => {
    // Owner, 2026-11-22 («صلحهم»): «شهر انتهاء الترخيص» read «نوفمبر ٢٠٢٦ (١)» on «السيارات» and
    // «التراخيص», and «الإخطارات»'s «حسب الشهر» named its months the same way.
    const [option] = licenceMonthOptions([{ licenseExpiresAt: '2026-11-03T00:00:00.000Z' }], 'ar');
    expect(option?.label).toBe('نوفمبر 2026 (1)');
    expect(option?.label).not.toBe('نوفمبر ٢٠٢٦ (١)');
  });
});

describe('every month filter of the Fleet boards (monthCountOptions)', () => {
  const MONTHS = [
    { month: '2026-10', count: 12 },
    { month: '2027-01', count: 3 },
    { month: '2026-12', count: 1_250 },
  ];

  it('Arabic: the month named in Arabic, the year and the count in Latin digits', () => {
    expect(monthCountOptions([{ month: '2026-10', count: 12 }], 'ar')).toEqual([
      { value: '2026-10', label: 'أكتوبر 2026 (12)' },
    ]);
  });

  it('no Arabic label carries an Arabic-Indic digit, whatever the month or the count', () => {
    const labels = monthCountOptions(MONTHS, 'ar').map((option) => option.label);
    expect(labels).toEqual(['أكتوبر 2026 (12)', 'ديسمبر 2026 (1,250)', 'يناير 2027 (3)']);
    for (const label of labels) expect(label, label).not.toMatch(ARABIC_INDIC);
    // …over all twelve month names, too.
    const year = Array.from({ length: 12 }, (_unused, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      count: index + 1,
    }));
    for (const { label } of monthCountOptions(year, 'ar')) {
      expect(label, label).not.toMatch(ARABIC_INDIC);
      expect(label, label).toMatch(/^\p{Script=Arabic}+ 2026 \(\d+\)$/u);
    }
  });

  it('English is unchanged', () => {
    expect(monthCountOptions(MONTHS, 'en').map((option) => option.label)).toEqual([
      'October 2026 (12)',
      'December 2026 (1,250)',
      'January 2027 (3)',
    ]);
  });
});
