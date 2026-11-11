// The shipments history's own decisions — «عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون من الى
// زياده يعنى عشان اقدر امسك الhistory بتاع الشحنات».
//
// The history IS the day board over a range of days (the same rows, filters, figures and table —
// `components/ShipmentsBoard.tsx`), so what is left to decide here is only what a range adds: which
// range a visit opens on, what a URL may ask for, when to refuse a range before asking the server,
// how to recognise the server's own refusal, and which slice of a long list is on screen. Pure, so
// each is pinned in `shipment-history.spec.ts` rather than through a rendered page.
import {
  ErrorCodes,
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  cairoYmd,
  daysBetweenYmd,
  isYmd,
  nextCairoMidnight,
  type PageMeta,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

/** Both bounds INCLUSIVE, as the endpoint reads them (`OperationsShipmentHistoryQuerySchema`). */
export interface HistoryRange {
  from: string;
  to: string;
}

/**
 * Today in Cairo — the desk's own day, asked in the desk's zone rather than the browser's. Both
 * screens name it explicitly: the history's endpoint takes two explicit days, and the day board
 * («اليوم التشغيلي … هو هيجيب بتاعت اليوم») shows today and nothing else. The day board used to
 * leave "today" to the server (`?date=` empty), which resolves it as the UTC day — so for the first
 * two or three hours after a Cairo midnight it still opened on the day before.
 */
export const cairoToday = (now: Date = new Date()): string => cairoYmd(now);

/**
 * How long until Cairo's next day begins, in ms — when a screen that shows "today" has to look
 * again. One timer set for that moment, rather than a clock ticking all day. DST-aware: Cairo's
 * day is 23 or 25 hours long on the two change days, which `nextCairoMidnight` knows.
 */
export const msUntilNextCairoDay = (now: Date = new Date()): number =>
  Math.max(0, nextCairoMidnight(now).getTime() - now.getTime());

/**
 * The range a bare visit opens on: the first day of this month, to today. A month to date is the
 * question "what happened lately" asks, and it is a range the server will always answer.
 */
export const defaultHistoryRange = (today: string): HistoryRange => ({
  from: `${today.slice(0, 7)}-01`,
  to: today,
});

/**
 * The range a URL asks for — per FIELD, falling back to the default: a reader who typed only the
 * start has said half of what they want, and resetting the whole range would throw that half away.
 * A value that is not a real day (`2026-02-30`, `today`) reads as absent, never as a request.
 */
export const resolveHistoryRange = (
  params: { from: string | null; to: string | null },
  today: string,
): HistoryRange => {
  const fallback = defaultHistoryRange(today);
  return {
    from: params.from !== null && isYmd(params.from) ? params.from : fallback.from,
    to: params.to !== null && isYmd(params.to) ? params.to : fallback.to,
  };
};

/**
 * Why a range cannot be asked for, or null when it can. The SAME two rules the endpoint enforces
 * (`from <= to`, at most `OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS` days, both counted inclusive) —
 * checked here first so a reader is told at once, in words, instead of waiting for a refusal. An
 * inverted range is refused rather than swapped: swapping would show a period nobody asked for
 * under the two dates they typed.
 */
export type HistoryRangeProblem = 'order' | 'tooLong';

export const historyRangeProblem = (range: HistoryRange): HistoryRangeProblem | null => {
  if (range.from > range.to) return 'order';
  return daysBetweenYmd(range.from, range.to) + 1 > OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS
    ? 'tooLong'
    : null;
};

/**
 * The server refused the range for holding too many shipments
 * (`OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS`). It refuses rather than cutting the list short, because
 * figures over a silently truncated list would be wrong figures — so the screen says what to do
 * (narrow the range) instead of showing a generic failure.
 */
export const HISTORY_TOO_LARGE = ErrorCodes.OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE;

export const isHistoryTooLarge = (error: unknown): boolean =>
  error instanceof ApiError && error.code === HISTORY_TOO_LARGE;

/**
 * A history range is thousands of rows; the table shows a page of them at a time. The page is of
 * the FILTERED rows — the filters and the figures run over everything the range returned, so a
 * bank filter answers for the whole range, and only the drawing is cut into pages.
 */
export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_PAGE_SIZES = [50, 100, 200];

/**
 * One page of `rows`, and the pager's meta. A page past the end (the filters just removed most
 * rows) lands on the last page that exists rather than on an empty table under a pager that says
 * there are rows.
 */
export const pageOfRows = <T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { rows: T[]; meta: PageMeta } => {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : HISTORY_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), totalPages);
  return {
    rows: rows.slice((current - 1) * size, current * size),
    meta: { page: current, pageSize: size, totalItems: rows.length, totalPages },
  };
};
