// Pure view logic for the operation grids — the two-group split and the live timer, ported from
// the legacy templates and kept out of the components so the behaviour is testable.
import { ATM_TIMER_THRESHOLD_HOURS } from '@ecms/contracts';

const CAIRO_TZ = 'Africa/Cairo';

const cairoDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the Cairo calendar day an instant falls on — the grouping day. */
export const cairoDay = (isoInstant: string | Date): string =>
  cairoDayFormatter.format(typeof isoInstant === 'string' ? new Date(isoInstant) : isoInstant);

/**
 * The legacy open grid renders TWO groups (atm_replenishment.ejs:1013 / :1086): rows opened
 * TODAY — live timer, close control, white — and open rows of any OTHER day — grey, no timer,
 * no close. The comparison is by calendar day of the open time.
 */
export const isOpenedToday = (openedAt: string, now: Date = new Date()): boolean =>
  cairoDay(openedAt) === cairoDay(now);

/** Whole seconds since open — the "Taken Time" the timer cell counts up. */
export const elapsedSeconds = (openedAt: string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(openedAt).getTime()) / 1000));

export const formatElapsed = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`;
};

/**
 * The colour ladder (atm_replenishment.ejs:1915-1921): <1h unpainted, ≥1h green, ≥2h yellow,
 * ≥3h crimson. Returned as a semantic level; the component maps levels to classes so the ladder
 * itself stays one testable fact.
 */
export type TimerLevel = 'none' | 'green' | 'yellow' | 'red';

export const timerLevel = (totalSeconds: number): TimerLevel => {
  const hours = totalSeconds / 3600;
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.red) return 'red';
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.yellow) return 'yellow';
  if (hours >= ATM_TIMER_THRESHOLD_HOURS.green) return 'green';
  return 'none';
};

/**
 * The done pages' "Taken Time": close − open as whole hours and minutes. The legacy added +3 to
 * the hours to bridge its own mixed-epoch storage (atm_replenishment_done.ejs:471-478, port doc
 * T1); over honest instants the plain difference IS the duration that display was reaching for.
 */
export const formatDuration = (openedAt: string, closedAt: string): string => {
  const ms = Math.max(0, new Date(closedAt).getTime() - new Date(openedAt).getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  return `${String(Math.floor(totalMinutes / 60))}h : ${String(totalMinutes % 60).padStart(2, '0')}m`;
};

/** Today's Cairo date string — the done pages' default range and the open form's default date. */
export const cairoToday = (): string => cairoDay(new Date());
