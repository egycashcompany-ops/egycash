// Minutes as a human reads them. Attendance is quantities only (§1), so a duration is rendered
// as h:mm and NEVER as a value — no rate, no multiplier, no money anywhere on these screens.
import { type Locale } from '@ecms/contracts';

const DIGITS: Record<Locale, string> = { ar: 'ar-EG', en: 'en-GB' };

export const formatMinutes = (minutes: number, locale: Locale): string => {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const nf = new Intl.NumberFormat(DIGITS[locale], { useGrouping: false });
  // LTR-locked: a duration is a number pair, and it must not reorder inside an Arabic sentence.
  return `${nf.format(hours)}:${nf.format(rest).padStart(2, nf.format(0))}`;
};

/** The Cairo clock time of an instant — the business calendar, never the browser's zone (R10). */
export const cairoTime = (iso: string | null, locale: Locale): string =>
  iso === null
    ? '—'
    : new Intl.DateTimeFormat(DIGITS[locale], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Cairo',
      }).format(new Date(iso));
