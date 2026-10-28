// The custody register's status, return days and «متأخر» — one fact, never at odds: each pick moves
// or drops the others, and a link that contradicts itself is read without what cannot be met.
import { describe, expect, it } from 'vitest';
import {
  custodyStatusOf,
  overdueUpdates,
  readBackFilters,
  returnDayUpdates,
  statusUpdates,
} from './custody-filters';

/** What the page's `patch` does with a set of updates: null or '' removes the param. */
const apply = (query: string, updates: Record<string, string | null>): URLSearchParams => {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
};

/** Pick a return day, «متأخر» or a status on the URL as it stands. */
const pickDay = (sp: URLSearchParams, key: 'returnedFrom' | 'returnedTo', day: string) =>
  apply(sp.toString(), returnDayUpdates(custodyStatusOf(sp), key, day));
const pickOverdue = (sp: URLSearchParams, on: boolean) =>
  apply(sp.toString(), overdueUpdates(custodyStatusOf(sp), on));
const pickStatus = (sp: URLSearchParams, value: string) =>
  apply(sp.toString(), statusUpdates(value));

/**
 * A URL no interval could meet — a return day beside «still out» or beside «متأخر», «متأخر» beside
 * the returned — judged on the RAW params a pick leaves behind, not on how the page reads them
 * (which drops a contradiction, and so could never show one).
 */
const contradicts = (sp: URLSearchParams): boolean => {
  const status = custodyStatusOf(sp);
  const returnDays = sp.has('returnedFrom') || sp.has('returnedTo');
  const overdue = sp.get('overdue') === 'true';
  return (returnDays && (status === 'true' || overdue)) || (overdue && status === 'false');
};

describe('the judge of a contradiction', () => {
  it('sees one in the raw params — the cases the page itself reads away', () => {
    expect(contradicts(new URLSearchParams('returnedFrom=2026-10-01'))).toBe(true);
    expect(contradicts(new URLSearchParams('open=false&overdue=true'))).toBe(true);
    expect(contradicts(new URLSearchParams('open=all&overdue=true&returnedTo=2026-10-31'))).toBe(
      true,
    );
    expect(contradicts(new URLSearchParams('open=all&returnedTo=2026-10-31'))).toBe(false);
    expect(contradicts(new URLSearchParams('overdue=true'))).toBe(false);
  });
});

describe('picking the filters', () => {
  it('moves the status to the returned intervals when a return day is picked, and drops «متأخر»', () => {
    // The reviewer's (a): «متأخر» first, then a return day.
    const sp = pickDay(pickOverdue(new URLSearchParams(), true), 'returnedFrom', '2026-10-01');
    expect(sp.get('open')).toBe('false');
    expect(sp.get('overdue')).toBeNull();
    expect(readBackFilters(sp)).toEqual({
      returnedFrom: '2026-10-01',
      returnedTo: '',
      overdue: false,
    });
    expect(contradicts(sp)).toBe(false);
  });

  it('moves the status to the intervals still out when «متأخر» is picked, and drops the return days', () => {
    // The reviewer's (b): a return day first, then «متأخر».
    const sp = pickOverdue(pickDay(new URLSearchParams(), 'returnedTo', '2026-10-31'), true);
    expect(sp.get('open')).toBeNull(); // the default: still out
    expect(sp.get('returnedTo')).toBeNull();
    expect(readBackFilters(sp)).toEqual({ returnedFrom: '', returnedTo: '', overdue: true });
    expect(contradicts(sp)).toBe(false);
  });

  it('drops what a status rules out, and keeps what it allows', () => {
    const returned = pickDay(new URLSearchParams(), 'returnedFrom', '2026-10-01');
    expect(pickStatus(returned, 'true').get('returnedFrom')).toBeNull();
    expect(pickStatus(returned, 'all').get('returnedFrom')).toBe('2026-10-01');
    const late = pickOverdue(new URLSearchParams(), true);
    expect(pickStatus(late, 'false').get('overdue')).toBeNull();
    expect(pickStatus(late, 'all').get('overdue')).toBe('true');
  });

  it('leaves the status alone when a box is cleared, or already allows the pick', () => {
    const all = new URLSearchParams('open=all');
    expect(pickDay(all, 'returnedFrom', '2026-10-01').get('open')).toBe('all');
    expect(pickOverdue(all, true).get('open')).toBe('all');
    const returned = new URLSearchParams('open=false&returnedFrom=2026-10-01');
    expect(pickDay(returned, 'returnedFrom', '').toString()).toBe('open=false');
  });

  it('never reaches a contradiction, whatever order the boxes are used in', () => {
    const moves = [
      (sp: URLSearchParams) => pickDay(sp, 'returnedFrom', '2026-10-01'),
      (sp: URLSearchParams) => pickDay(sp, 'returnedTo', '2026-10-31'),
      (sp: URLSearchParams) => pickDay(sp, 'returnedFrom', ''),
      (sp: URLSearchParams) => pickOverdue(sp, true),
      (sp: URLSearchParams) => pickOverdue(sp, false),
      (sp: URLSearchParams) => pickStatus(sp, 'true'),
      (sp: URLSearchParams) => pickStatus(sp, 'false'),
      (sp: URLSearchParams) => pickStatus(sp, 'all'),
    ];
    for (const first of moves) {
      for (const second of moves) {
        for (const third of moves) {
          const sp = third(second(first(new URLSearchParams())));
          expect(contradicts(sp), sp.toString()).toBe(false);
        }
      }
    }
  });
});

describe('reading a link that contradicts itself', () => {
  it('reads return days beside «still out» as no return days', () => {
    expect(readBackFilters(new URLSearchParams('returnedFrom=2026-10-01'))).toEqual({
      returnedFrom: '',
      returnedTo: '',
      overdue: false,
    });
    expect(readBackFilters(new URLSearchParams('open=true&returnedTo=2026-10-31')).returnedTo).toBe(
      '',
    );
  });

  it('reads «متأخر» beside the returned intervals, or beside return days, as not set', () => {
    expect(readBackFilters(new URLSearchParams('open=false&overdue=true')).overdue).toBe(false);
    expect(
      readBackFilters(new URLSearchParams('open=all&overdue=true&returnedFrom=2026-10-01')),
    ).toEqual({ returnedFrom: '2026-10-01', returnedTo: '', overdue: false });
  });

  it('reads a consistent link exactly as written', () => {
    expect(readBackFilters(new URLSearchParams('overdue=true'))).toEqual({
      returnedFrom: '',
      returnedTo: '',
      overdue: true,
    });
    expect(
      readBackFilters(
        new URLSearchParams('open=false&returnedFrom=2026-10-01&returnedTo=2026-10-31'),
      ),
    ).toEqual({ returnedFrom: '2026-10-01', returnedTo: '2026-10-31', overdue: false });
  });
});
