// «قبل 5 دقائق», «أمس», «in 2 hours» — how long ago (or until) an instant is, in the page's
// language, with Western digits as everywhere in the app.
import { type Locale } from '@ecms/contracts';

const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

// One formatter per language: a table writes this once per row, every few seconds.
const FORMATS = new Map<Locale, Intl.RelativeTimeFormat>();

export const relativeTimeText = (at: number, now: number, locale: Locale): string => {
  const seconds = Math.round((at - now) / 1000);
  let format = FORMATS.get(locale);
  if (format === undefined) {
    format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
    FORMATS.set(locale, format);
  }
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
};
