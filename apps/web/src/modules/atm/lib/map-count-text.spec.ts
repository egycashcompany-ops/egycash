// Machine counts in words (spec §9.4, DM-21): the five forms by `n % 100`, in both locales.
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { machineCountForm, machineCountText } from './map-count-text';

const text = (n: number, locale: Locale): string =>
  machineCountText(n, (key, params) => translate(locale, key, params), locale);

describe('machineCountText', () => {
  it('chooses the form by DM-21’s rule', () => {
    const forms = [0, 1, 2, 3, 10, 11, 100, 101, 102, 103, 111, 1003].map(machineCountForm);
    expect(forms).toEqual([
      'zero',
      'one',
      'two',
      'few',
      'few',
      'many',
      'many',
      'many',
      'many',
      'few',
      'many',
      'few',
    ]);
  });

  it('reads in Arabic, with Arabic-Indic digits', () => {
    expect([0, 1, 2, 3, 10, 11, 100, 101, 102, 103, 111, 1003].map((n) => text(n, 'ar'))).toEqual([
      'لا ماكينات',
      'ماكينة واحدة',
      'ماكينتان',
      '٣ ماكينات',
      '١٠ ماكينات',
      '١١ ماكينة',
      '١٠٠ ماكينة',
      '١٠١ ماكينة',
      '١٠٢ ماكينة',
      '١٠٣ ماكينات',
      '١١١ ماكينة',
      '١٬٠٠٣ ماكينات',
    ]);
  });

  it('reads in English', () => {
    expect([0, 1, 2, 3, 10, 11, 100, 101, 102, 103, 111, 1003].map((n) => text(n, 'en'))).toEqual([
      'No machines',
      '1 machine',
      '2 machines',
      '3 machines',
      '10 machines',
      '11 machines',
      '100 machines',
      '101 machines',
      '102 machines',
      '103 machines',
      '111 machines',
      '1,003 machines',
    ]);
  });
});
