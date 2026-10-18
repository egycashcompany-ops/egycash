// The map's result toasts (spec §8.10): the shared Toaster cuts a title to one line, so every
// sentence the person needs in full is the description, under a title that fits on that line.
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { locatedToast, noticeToast, syncDoneToast } from './map-toasts';
import { NOTICE_KEYS } from './zone-editor';

const tr =
  (locale: Locale) =>
  (key: string, params?: Record<string, string | number>): string =>
    translate(locale, key, params);

/** About what one line of the toast's title holds (a 384 px card, 14 px text). */
const TITLE_MAX = 40;

describe('map toasts', () => {
  for (const locale of ['ar', 'en'] as const) {
    const t = tr(locale);

    it(`the sync result keeps all three counts, in the description (${locale})`, () => {
      const words = syncDoneToast({ located: 82, review: 14, unlocated: 20 }, t, locale);
      expect(words.title.length).toBeLessThanOrEqual(TITLE_MAX);
      const n = (v: number): string =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(v);
      for (const count of [82, 14, 20]) expect(words.description).toContain(n(count));
    });

    it(`a placed pin names its machine, its zone and the audit, in the description (${locale})`, () => {
      const words = locatedToast('4083', 'قطاع تجريبي 1', t);
      expect(words.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(words.description).toContain('4083');
      expect(words.description).toContain('قطاع تجريبي 1');
    });

    it(`the editor's long notices get a short title, the short ones stay titles (${locale})`, () => {
      for (const key of [NOTICE_KEYS.added, NOTICE_KEYS.tooSmall, NOTICE_KEYS.geometry]) {
        const words = noticeToast(key, t);
        expect(words.title.length, key).toBeLessThanOrEqual(TITLE_MAX);
        expect(words.description).toBe(t(key));
      }
      expect(noticeToast(NOTICE_KEYS.cancelled, t)).toEqual({ title: t(NOTICE_KEYS.cancelled) });
    });
  }
});
