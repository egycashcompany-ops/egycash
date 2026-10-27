// The days, times and stamps the settlement pages and papers print
// (docs/12-planning/atm-settlements-phase1.md §9.3, DS-18, DS-25).
//
// THE CAIRO DAY IS `operation-view.ts`'s — `cairoDay` / `cairoToday` are re-exported, never
// redeclared, so «اليوم» on these pages is the same day the boards group by.
//
// THE PAPERS' FORMATS, from the papers themselves:
//   · a date prints `d/m/yyyy` — the papers' only explicit date format (`سيلزات!D1`,
//     `[$-1010000]d/m/yyyy`); Western digits, no padding;
//   · the Note's print stamp keeps its own explicit `m/d/yy h:mm:ss` (`Print!G72`, `=NOW()`): Excel's
//     `h` with no AM/PM is the 24-hour clock;
//   · a run's time is the 12-hour clock with «ص» / «م» on an Arabic paper, AM / PM in English.
import { type AtmPlanRun, type Locale } from '@ecms/contracts';
import { cairoDay, cairoToday } from './operation-view';

export { cairoDay, cairoToday };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = (day: string): [number, number, number] => {
  const match = DAY.exec(day);
  if (match === null) throw new RangeError(`not a calendar day: ${day}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** The calendar day after `day` ('YYYY-MM-DD'), across month and year ends. */
export const nextDay = (day: string): string => {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Tomorrow in Cairo — the plan page's default (DS-25: plans are built the evening before). */
export const cairoTomorrow = (now: Date = new Date()): string => nextDay(cairoDay(now));

/** 'YYYY-MM-DD' → 'd/m/yyyy', the papers' date. */
export const formatPaperDate = (day: string): string => {
  const [y, m, d] = parts(day);
  return `${String(d)}/${String(m)}/${String(y)}`;
};

const cairoStamp = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: '2-digit',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** An instant → 'm/d/yy h:mm:ss' on the Cairo clock — the Note's print stamp (`Print!G72`). */
export const formatPaperTimestamp = (instant: string | Date): string => {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    cairoStamp.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${pick('month')}/${pick('day')}/${pick('year')} ${String(Number(pick('hour')))}:${pick('minute')}:${pick('second')}`;
};

/** The Arabic papers' 12-hour markers: «ص» before noon, «م» after. */
const AR_MARKERS = { am: 'ص', pm: 'م' } as const;

/** 'HH:mm' → '9:00 م' (ar) / '9:00 PM' (en); null or anything else → ''. */
export const formatTime12 = (time: string | null, locale: Locale): string => {
  const match = time === null ? null : /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (match === null) return '';
  const hour = Number(match[1]);
  const pm = hour >= 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const marker = locale === 'ar' ? AR_MARKERS[pm ? 'pm' : 'am'] : pm ? 'PM' : 'AM';
  return `${String(h12)}:${match[2] ?? '00'} ${marker}`;
};

/**
 * The run in the seals sheet's narrow column: «2 · 9:00 م» — the run number, a middle dot, the
 * 12-hour time; the run alone without a time (§8.4). Arabic unless told otherwise: it is a paper's.
 */
export const runCompact = (run: AtmPlanRun, time: string | null, locale: Locale = 'ar'): string => {
  const at = formatTime12(time, locale);
  return at === '' ? String(run) : `${String(run)} · ${at}`;
};
