// «الضمان» on the asset register — the window read from a link, the bar's options, and the window
// in the reader's words, the days counted as Arabic counts them.
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import { warrantyWindowOf, warrantyWindowOptions, warrantyWithin } from './warranty-window';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const en = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);

describe('the window in the URL', () => {
  it('reads a whole number of days the API takes', () => {
    expect(warrantyWindowOf('30')).toBe(30);
    expect(warrantyWindowOf('365')).toBe(365);
    expect(warrantyWindowOf(' 90 ')).toBe(90);
  });

  it('reads anything the API would refuse as no filter, rather than a register that fails', () => {
    for (const raw of [null, '', '0', '366', '-5', '12.5', 'abc', '1e2']) {
      expect(warrantyWindowOf(raw), String(raw)).toBeNull();
    }
  });
});

describe('the bar’s options', () => {
  it('are 30 and 90 days — and a linked window beside them, in order', () => {
    expect(warrantyWindowOptions(null)).toEqual([30, 90]);
    expect(warrantyWindowOptions(30)).toEqual([30, 90]);
    expect(warrantyWindowOptions(45)).toEqual([30, 45, 90]);
  });
});

describe('the window in words', () => {
  it('counts the days as Arabic does, in the app’s digits', () => {
    expect(warrantyWithin(ar, 'ar', 30)).toBe('ينتهي خلال ٣٠ يومًا');
    expect(warrantyWithin(ar, 'ar', 90)).toBe('ينتهي خلال ٩٠ يومًا');
    expect(warrantyWithin(ar, 'ar', 1)).toBe('ينتهي خلال يوم واحد');
    expect(warrantyWithin(ar, 'ar', 2)).toBe('ينتهي خلال يومين');
    expect(warrantyWithin(ar, 'ar', 7)).toBe('ينتهي خلال ٧ أيام');
    expect(warrantyWithin(ar, 'ar', 100)).toBe('ينتهي خلال ١٠٠ يوم');
  });

  it('and in English', () => {
    expect(warrantyWithin(en, 'en', 30)).toBe('ending within 30 days');
    expect(warrantyWithin(en, 'en', 1)).toBe('ending within a day');
  });
});
