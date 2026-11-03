// «قبل 5 دقائق», «أمس», «in 2 hours» — how long ago (or until) an instant is, in the page's
// language, with Western digits as everywhere in the app.
import { type Locale } from '@ecms/contracts';

const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

export const relativeTimeText = (at: number, now: number, locale: Locale): string => {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
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
