// The stretch of days an employee screen is showing, and the calendar it is measured on.
//
// WHY NOT `new Date()`. The company's calendar is Africa/Cairo (Leave design R10): a work date is
// a Cairo day, not the browser's. Reading "today" off the local clock gives the wrong day for
// anybody whose laptop is in another zone, and the wrong day for EVERYBODY between midnight Cairo
// and midnight UTC — two hours every night in winter, three in summer, during which the sheet
// would open on yesterday.
import { type Locale } from '@ecms/contracts';

/** The four periods the screens offer. `custom` carries its own two dates. */
export const PERIOD_KEYS = ['thisMonth', 'lastMonth', 'last30', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface PeriodRange {
  /** Inclusive `YYYY-MM-DD`, which is what the day endpoint's `from`/`to` expect. */
  from: string;
  to: string;
}

const CAIRO_TZ = 'Africa/Cairo';

/** One formatter, made once — `Intl` construction costs far more than use. */
const cairoDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today on the company's calendar, as `YYYY-MM-DD`.
 *
 * Assembled from parts rather than trusting one locale's ordering: `en-CA` renders ISO order
 * today, and a page that silently became `17/11/2026` would send a date the API rejects.
 */
export const cairoToday = (now: Date = new Date()): string => {
  const parts = cairoDayFormat.formatToParts(now);
  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/**
 * `YYYY-MM-DD` shifted by whole days. Parsed as UTC on purpose: a calendar day has no hours to
 * get wrong, and UTC has no daylight saving to lose one to.
 */
export const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The last day of the month `date` falls in, as `YYYY-MM-DD`. */
const endOfMonth = (date: string): string => {
  const [year, month] = date.split('-').map(Number) as [number, number];
  // Day 0 of the NEXT month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};

/** How many days `last30` spans, inclusive of today. */
const LAST_N_DAYS = 30;

/**
 * The dates a period key resolves to, on a given Cairo day.
 *
 * `thisMonth` ENDS TODAY rather than at the month's end, and that is deliberate: a period running
 * to the 30th while it is the 3rd pads the chart with twenty-seven empty columns and divides
 * every average by days nobody has lived yet.
 */
export const periodRange = (
  key: Exclude<PeriodKey, 'custom'>,
  today: string = cairoToday(),
): PeriodRange => {
  if (key === 'lastMonth') {
    const lastMonthDay = addDays(`${today.slice(0, 7)}-01`, -1);
    return { from: `${lastMonthDay.slice(0, 7)}-01`, to: endOfMonth(lastMonthDay) };
  }
  if (key === 'last30') return { from: addDays(today, -(LAST_N_DAYS - 1)), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
};

/** `Mon, 19 Oct 2026 – Tue, 17 Nov 2026` — the daily record's subtitle. */
export const rangeLabel = (range: PeriodRange, locale: Locale): string => {
  const format = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const at = (date: string): string => format.format(new Date(`${date}T00:00:00.000Z`));
  return `${at(range.from)} – ${at(range.to)}`;
};

/**
 * The longest stretch a screen will ask for in one request.
 *
 * It was 92 — the server's old cap, and also what one page of day rows could carry, so asking for
 * more did not fail loudly: it returned the first hundred days and left the rest out of the table
 * AND out of every figure computed from it.
 *
 * Neither limit applies now. `/days/employee-period` answers one entry per calendar date rather
 * than a page of rows, and its inputs are batched once for the whole span, so a year costs the
 * same handful of queries a month does. A year is what «did he come on the 1st of January?» needs,
 * and the server refuses more.
 */
export const MAX_PERIOD_DAYS = 366;

/**
 * The month `date` sits in, as a whole — the previous/next arrows' destination.
 *
 * `thisMonth` deliberately ends TODAY rather than at the month's end; stepping BACK from it has to
 * give the whole previous month, and stepping forward from there the whole next one, clamped to
 * today so an arrow never walks into days nobody has lived.
 */
export const monthAround = (date: string, today: string = cairoToday()): PeriodRange => {
  const first = `${date.slice(0, 7)}-01`;
  const last = endOfMonth(first);
  return { from: first, to: last > today ? today : last };
};

/** The whole month before the one `from` sits in, clamped to today at the far end. */
export const previousMonth = (from: string, today: string = cairoToday()): PeriodRange =>
  monthAround(addDays(`${from.slice(0, 7)}-01`, -1), today);

/**
 * The whole month after the one `from` sits in, or null when that would be the future.
 *
 * Null is what disables the arrow, and it is a real answer: there is no «next» from the month
 * being lived.
 */
export const nextMonth = (from: string, today: string = cairoToday()): PeriodRange | null => {
  const firstOfNext = addDays(endOfMonth(`${from.slice(0, 7)}-01`), 1);
  if (firstOfNext > today) return null;
  return monthAround(firstOfNext, today);
};
