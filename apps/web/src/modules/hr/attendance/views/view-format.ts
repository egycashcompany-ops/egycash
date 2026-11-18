import { store } from '../../../../store';
// Figures for the attendance views. One digit style on every screen: Western digits, the same as
// the counters, the codes and the rest of ECMS's tables, so a row never mixes ٠٩:٠٠ with 128.

const pad = (n: number): string => String(n).padStart(2, '0');

/** The screen's language, read from the store so every figure helper follows it. */
const lang = (): 'ar' | 'en' => (store.getState().locale.locale === 'en' ? 'en' : 'ar');

/** Minutes after midnight → 12-hour clock «5:00 م» / «5:00 PM». Past midnight wraps. */
export const clock = (minutes: number | null): string => {
  if (minutes === null) return '—';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pm = h24 >= 12;
  const mark = lang() === 'en' ? (pm ? 'PM' : 'AM') : pm ? 'م' : 'ص';
  return `${h12}:${pad(m % 60)} ${mark}`;
};

/** «8:52 ص ← 5:05 م» — the arrow follows the reading direction. */
export const arrow = (): string => (lang() === 'en' ? '→' : '←');

/** «9:00 ص – 5:00 م», plain text that flows correctly inside a sentence in either language. */
export const timeSpan = (a: number, b: number): string => `${clock(a)} – ${clock(b)}`;

/** A whole hour for a chart axis: «9 ص» / «9 AM». */
export const hourTick = (minutes: number): string => {
  const h24 = Math.floor((((Math.round(minutes) % 1440) + 1440) % 1440) / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pm = h24 >= 12;
  return `${h12} ${lang() === 'en' ? (pm ? 'PM' : 'AM') : pm ? 'م' : 'ص'}`;
};

/** A duration as hours:minutes «7:49» — one shape in both languages, no mixed-direction units. */
export const duration = (minutes: number | null, _h?: string, _m?: string): string => {
  if (minutes === null) return '—';
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};

/** «0:42» for a short lateness cell. */
export const shortDuration = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${pad(Math.round(minutes) % 60)}`;

export const num = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** «الاثنين، 16 نوفمبر» / «Mon, 16 Nov» with Western digits. */
export const dayLabel = (iso: string, locale: 'ar' | 'en'): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The first letters of the first two words.
 *
 * It takes a missing name rather than assuming one: the name on these screens comes from an
 * employee record that a login may not be linked to, and a screen that goes blank because
 * somebody has no file is a worse answer than a circle with nothing in it.
 */
export const initials = (name: string | null | undefined): string =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('');
