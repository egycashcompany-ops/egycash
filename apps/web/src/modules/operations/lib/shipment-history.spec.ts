// The shipments history's own decisions — the range a visit opens on, what a URL may ask for, the
// two refusals, and the page of rows on screen. «عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون من
// الى … عشان اقدر امسك الhistory بتاع الشحنات».
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OperationsShipmentHistoryQuerySchema,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_TOO_LARGE,
  cairoToday,
  defaultHistoryRange,
  historyRangeProblem,
  isHistoryTooLarge,
  pageOfRows,
  resolveHistoryRange,
} from './shipment-history';

describe('cairoToday — the day the server calls «اليوم»', () => {
  it('is Cairo’s date, not the browser’s or UTC’s', () => {
    // 23:30 UTC on 10 Nov is 01:30 on 11 Nov in Cairo (UTC+2).
    expect(cairoToday(new Date('2026-11-10T23:30:00.000Z'))).toBe('2026-11-11');
    expect(cairoToday(new Date('2026-11-11T08:00:00.000Z'))).toBe('2026-11-11');
  });
});

describe('defaultHistoryRange — this month to date', () => {
  it('runs from the first of the month to today', () => {
    expect(defaultHistoryRange('2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
  });

  it('is the one day on the first of a month', () => {
    expect(defaultHistoryRange('2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-01' });
  });
});

describe('resolveHistoryRange — the URL’s ?from=&to=, per field', () => {
  const today = '2026-11-11';

  it('takes both bounds from the URL', () => {
    expect(resolveHistoryRange({ from: '2026-01-05', to: '2026-02-10' }, today)).toEqual({
      from: '2026-01-05',
      to: '2026-02-10',
    });
  });

  it('falls back to the default per field — half a range typed is half kept', () => {
    expect(resolveHistoryRange({ from: '2026-10-01', to: null }, today)).toEqual({
      from: '2026-10-01',
      to: today,
    });
    expect(resolveHistoryRange({ from: null, to: '2026-11-05' }, today)).toEqual({
      from: '2026-11-01',
      to: '2026-11-05',
    });
    expect(resolveHistoryRange({ from: null, to: null }, today)).toEqual(
      defaultHistoryRange(today),
    );
  });

  it('reads anything that is not a real day as absent', () => {
    for (const bad of ['', 'today', '2026-02-30', '11-11-2026', '2026-11-11T00:00:00Z']) {
      expect(resolveHistoryRange({ from: bad, to: bad }, today), bad).toEqual(
        defaultHistoryRange(today),
      );
    }
  });
});

describe('historyRangeProblem — the endpoint’s own two rules, checked before asking', () => {
  /** What the server would say about the same range. */
  const serverAccepts = (from: string, to: string): boolean =>
    OperationsShipmentHistoryQuerySchema.safeParse({ from, to }).success;

  it('accepts a range the server accepts — one day included', () => {
    for (const [from, to] of [
      ['2026-11-01', '2026-11-11'],
      ['2026-11-11', '2026-11-11'],
    ] as const) {
      expect(historyRangeProblem({ from, to })).toBeNull();
      expect(serverAccepts(from, to)).toBe(true);
    }
  });

  it('refuses an inverted range rather than swapping it', () => {
    expect(historyRangeProblem({ from: '2026-11-12', to: '2026-11-11' })).toBe('order');
    expect(serverAccepts('2026-11-12', '2026-11-11')).toBe(false);
  });

  it(`holds the line exactly at ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS)} days, both counted`, () => {
    // 2025-11-11 .. 2026-11-11 is 366 days inclusive; one more is refused, by both sides.
    expect(historyRangeProblem({ from: '2025-11-11', to: '2026-11-11' })).toBeNull();
    expect(serverAccepts('2025-11-11', '2026-11-11')).toBe(true);
    expect(historyRangeProblem({ from: '2025-11-10', to: '2026-11-11' })).toBe('tooLong');
    expect(serverAccepts('2025-11-10', '2026-11-11')).toBe(false);
  });
});

describe('isHistoryTooLarge — the server’s refusal of a range with too many shipments', () => {
  it('is that one business error, by its code', () => {
    expect(isHistoryTooLarge(new ApiError(HISTORY_TOO_LARGE, 'too many', 422))).toBe(true);
    expect(HISTORY_TOO_LARGE).toBe('OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE');
  });

  it('is not any other failure — those keep the table’s own error and retry', () => {
    expect(isHistoryTooLarge(new ApiError('VALIDATION_ERROR', 'bad', 400))).toBe(false);
    expect(isHistoryTooLarge(new ApiError('INTERNAL', 'boom', 500))).toBe(false);
    expect(isHistoryTooLarge(new TypeError('network'))).toBe(false);
    expect(isHistoryTooLarge(null)).toBe(false);
  });
});

describe('pageOfRows — the table’s page of the FILTERED rows', () => {
  const rows = Array.from({ length: 250 }, (_, i) => i + 1);

  it('slices a page and says where it is', () => {
    const second = pageOfRows(rows, 2, HISTORY_PAGE_SIZE);
    expect(second.rows[0]).toBe(101);
    expect(second.rows).toHaveLength(100);
    expect(second.meta).toEqual({ page: 2, pageSize: 100, totalItems: 250, totalPages: 3 });
    expect(pageOfRows(rows, 3, HISTORY_PAGE_SIZE).rows).toHaveLength(50);
  });

  it('lands on the last page when the filters leave fewer rows than the page asked', () => {
    const narrowed = pageOfRows(rows.slice(0, 30), 3, HISTORY_PAGE_SIZE);
    expect(narrowed.meta.page).toBe(1);
    expect(narrowed.rows).toHaveLength(30);
  });

  it('is one empty page for no rows, never page 0', () => {
    expect(pageOfRows([], 1, HISTORY_PAGE_SIZE).meta).toEqual({
      page: 1,
      pageSize: 100,
      totalItems: 0,
      totalPages: 1,
    });
  });

  it('reads a nonsense page or size as the defaults', () => {
    expect(pageOfRows(rows, 0, HISTORY_PAGE_SIZE).meta.page).toBe(1);
    expect(pageOfRows(rows, Number.NaN, HISTORY_PAGE_SIZE).meta.page).toBe(1);
    expect(pageOfRows(rows, 1, 0).meta.pageSize).toBe(HISTORY_PAGE_SIZE);
  });
});
