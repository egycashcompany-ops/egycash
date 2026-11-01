// Which day an open board shows — «هنا يظهر فقط الماكينات اللى المفروض يتغذى أو يتعمله صيانه في
// اليوم دا مش عموماً · وتعمل زرار Toggle يظهر اللى المفروض يتغذى أو يتعمله صيانه اليوم اللى بعده أو
// متجدول في المستقبل عموماً» (2026-10-27).
//
// A board used to show every open operation at once, in two groups: today's, and every other day's
// (grey). It now shows ONE day view at a time, today's by default:
//
//   · today     — opened (or scheduled) for today, the live timer running;
//   · tomorrow  — scheduled for tomorrow (a replenishment's force date, a maintenance's datetime);
//   · upcoming  — everything scheduled after today, tomorrow included;
//   · earlier   — left open on an earlier day and never closed. Since the rule became per day such a
//                 row no longer blocks its machine, but it is still open, so it keeps a home where
//                 it can be closed or deleted (the owner's answer: «أيام سابقة»).
//
// The day is the Cairo calendar day of the open time — the day the rule counts by. The board is
// still read whole; the view only chooses which of its rows the table holds.
import { cairoDay } from './operation-view';

export const BOARD_DAY_VIEWS = ['today', 'tomorrow', 'upcoming', 'earlier'] as const;
export type BoardDayView = (typeof BOARD_DAY_VIEWS)[number];

/** The address bar's `?day=`; anything else — absent, misspelt, an old link — is today. */
export const readBoardDayView = (raw: string | null): BoardDayView =>
  (BOARD_DAY_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as BoardDayView) : 'today';

/** `YYYY-MM-DD` moved by whole calendar days — date arithmetic only, no clock involved. */
export const addDays = (day: string, days: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Does a row opened at `openedAt` belong to `view`, on the Cairo day `now` falls on? */
export const isInDayView = (openedAt: string, view: BoardDayView, now: Date): boolean => {
  const day = cairoDay(openedAt);
  const today = cairoDay(now);
  switch (view) {
    case 'today':
      return day === today;
    case 'tomorrow':
      return day === addDays(today, 1);
    case 'upcoming':
      return day > today;
    case 'earlier':
      return day < today;
  }
};

/** The rows of one view, in the board's own order. */
export const rowsInDayView = <T extends { openedAt: string }>(
  rows: readonly T[],
  view: BoardDayView,
  now: Date,
): T[] => rows.filter((row) => isInDayView(row.openedAt, view, now));

/** How many rows each view holds — the count on its button. */
export const dayViewCounts = (
  rows: readonly { openedAt: string }[],
  now: Date,
): Record<BoardDayView, number> => {
  const counts: Record<BoardDayView, number> = { today: 0, tomorrow: 0, upcoming: 0, earlier: 0 };
  for (const view of BOARD_DAY_VIEWS) counts[view] = rowsInDayView(rows, view, now).length;
  return counts;
};

/**
 * The days a view's statement is «عن» — what its printed title says. Today and tomorrow are one
 * day each. The other two span the days their rows actually fall on; with no rows they fall back
 * to the day next to today on their side, so an empty statement still names a day.
 */
export const dayViewRange = (
  view: BoardDayView,
  rows: readonly { openedAt: string }[],
  now: Date,
): { from: string; to: string } => {
  const today = cairoDay(now);
  if (view === 'today') return { from: today, to: today };
  if (view === 'tomorrow') return { from: addDays(today, 1), to: addDays(today, 1) };
  const days = rows.map((row) => cairoDay(row.openedAt)).sort();
  const fallback = view === 'upcoming' ? addDays(today, 1) : addDays(today, -1);
  return { from: days[0] ?? fallback, to: days[days.length - 1] ?? fallback };
};
