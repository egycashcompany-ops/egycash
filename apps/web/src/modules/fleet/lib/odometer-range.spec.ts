// What "this month" means, pinned against fixed dates rather than against today.
import { describe, expect, it } from 'vitest';
import {
  currentMonthRange,
  dateBoundPatch,
  odometerRange,
  WHOLE_HISTORY,
  WIDER_RANGE_MONTHS,
  widerRange,
} from './odometer-range';

const at = (iso: string): Date => new Date(iso);

describe('currentMonthRange', () => {
  it('spans the first to the LAST day of the month, both inclusive', () => {
    expect(currentMonthRange(at('2026-08-19T11:00:00.000Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('gets a 30-day month right', () => {
    expect(currentMonthRange(at('2026-09-15T00:00:00.000Z'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('gets February right in a leap year and a common one', () => {
    expect(currentMonthRange(at('2028-02-10T00:00:00.000Z')).to).toBe('2028-02-29');
    expect(currentMonthRange(at('2026-02-10T00:00:00.000Z')).to).toBe('2026-02-28');
  });

  it('does not roll off the end of the year', () => {
    expect(currentMonthRange(at('2026-12-31T23:00:00.000Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('reads the month in UTC, so a late-evening instant stays in its own month', () => {
    // 23:30 on the 31st is already the 1st in a positive offset; a local-time reading would
    // return September here and silently ask the server for the wrong days.
    expect(currentMonthRange(at('2026-08-31T23:30:00.000Z')).from).toBe('2026-08-01');
    // …and the first instant of the month is not dragged back into the previous one.
    expect(currentMonthRange(at('2026-08-01T00:00:00.000Z')).from).toBe('2026-08-01');
  });
});

describe('odometerRange', () => {
  const now = at('2026-08-19T11:00:00.000Z');

  it('fills in the month when the URL asks for NEITHER bound', () => {
    expect(odometerRange({ from: '', to: '' }, now)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
      defaulted: true,
    });
  });

  it('leaves a FROM-only request open-ended — the month must not cap it', () => {
    // The server reads this as `>= from` with no upper bound. Filling `to` in would hide every
    // row after this month from someone who asked for everything since July.
    expect(odometerRange({ from: '2026-07-01', to: '' }, now)).toEqual({
      from: '2026-07-01',
      to: '',
      defaulted: false,
    });
  });

  it('leaves a TO-only request open at the start', () => {
    expect(odometerRange({ from: '', to: '2026-07-31' }, now)).toEqual({
      from: '',
      to: '2026-07-31',
      defaulted: false,
    });
  });

  it('passes both bounds through untouched', () => {
    expect(odometerRange({ from: '2026-01-01', to: '2026-03-31' }, now)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      defaulted: false,
    });
  });

  it('passes a single DAY through — the server covers the whole of it', () => {
    expect(odometerRange({ from: '2026-08-18', to: '2026-08-18' }, now)).toEqual({
      from: '2026-08-18',
      to: '2026-08-18',
      defaulted: false,
    });
  });
});

describe('odometerRange — `period=all`, the car’s whole history («تاريخ العربيه كله»)', () => {
  const now = at('2026-08-19T11:00:00.000Z');

  it('is spelled `all` — the word the vehicle profile’s link puts in the URL', () => {
    expect(WHOLE_HISTORY).toBe('all');
  });

  it('sends NO bound at all — not the month, and not a made-up first day', () => {
    expect(odometerRange({ from: '', to: '', period: WHOLE_HISTORY }, now)).toEqual({
      from: '',
      to: '',
      // Asked for, not the page's own default: the reset is offered, the «widen» hint is not.
      defaulted: false,
    });
  });

  it('gives way to a date in the URL — a picked day is the more specific question', () => {
    expect(odometerRange({ from: '2026-07-01', to: '', period: WHOLE_HISTORY }, now)).toEqual({
      from: '2026-07-01',
      to: '',
      defaulted: false,
    });
    expect(
      odometerRange({ from: '2026-01-01', to: '2026-03-31', period: WHOLE_HISTORY }, now),
    ).toEqual({ from: '2026-01-01', to: '2026-03-31', defaulted: false });
  });

  it('ignores any other value — the month fills in as before', () => {
    for (const period of ['', 'ALL', 'month', 'yes']) {
      expect(odometerRange({ from: '', to: '', period }, now), period).toEqual({
        from: '2026-08-01',
        to: '2026-08-31',
        defaulted: true,
      });
    }
  });
});

describe('dateBoundPatch — picking a date lets go of `period=all`', () => {
  const now = at('2026-08-19T11:00:00.000Z');

  /** The URL after a patch, written the way the screen's `patch` writes it: null deletes. */
  const applied = (query: string, updates: Record<string, string | null>): URLSearchParams => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    return next;
  };
  const rangeOf = (sp: URLSearchParams) =>
    odometerRange(
      { from: sp.get('from') ?? '', to: sp.get('to') ?? '', period: sp.get('period') ?? '' },
      now,
    );

  it('writes the picked bound and drops `period`', () => {
    expect(dateBoundPatch('from', '2026-01-01')).toEqual({ from: '2026-01-01', period: null });
    expect(dateBoundPatch('to', '2026-03-31')).toEqual({ to: '2026-03-31', period: null });
  });

  it('a cleared box deletes its bound — and still drops `period`', () => {
    expect(dateBoundPatch('from', '')).toEqual({ from: null, period: null });
    expect(dateBoundPatch('to', '')).toEqual({ to: null, period: null });
  });

  it('from the profile’s whole history: pick a day, clear it — the month, not the whole log', () => {
    const fromProfile = `vehicleCodes=150&period=${WHOLE_HISTORY}`;
    expect(rangeOf(new URLSearchParams(fromProfile)).defaulted).toBe(false);

    const picked = applied(fromProfile, dateBoundPatch('from', '2026-01-01'));
    expect(picked.has('period'), 'the picked day replaced the whole history').toBe(false);
    expect(picked.get('vehicleCodes'), 'the car stays').toBe('150');
    expect(rangeOf(picked)).toEqual({ from: '2026-01-01', to: '', defaulted: false });

    const cleared = applied(picked.toString(), dateBoundPatch('from', ''));
    expect(cleared.toString()).toBe('vehicleCodes=150');
    expect(rangeOf(cleared)).toEqual({ from: '2026-08-01', to: '2026-08-31', defaulted: true });
  });
});

describe('widerRange — what the «اعرض آخر ١٢ شهر» button asks for', () => {
  it('starts at the FIRST of the month a year back and ends where this month does', () => {
    expect(widerRange(at('2026-09-13T11:00:00.000Z'))).toEqual({
      from: '2025-09-01',
      to: '2026-09-30',
    });
  });

  it('is the same answer from any day of the same month — so pressing it twice is one request', () => {
    const early = widerRange(at('2026-09-01T00:00:00.000Z'));
    const late = widerRange(at('2026-09-30T23:59:59.000Z'));
    expect(early).toEqual(late);
  });

  it('walks back across the turn of the year without landing in month 13', () => {
    expect(widerRange(at('2026-02-10T00:00:00.000Z'))).toEqual({
      from: '2025-02-01',
      to: '2026-02-28',
    });
    expect(widerRange(at('2026-01-05T00:00:00.000Z')).from).toBe('2025-01-01');
  });

  it('ends at the END of the current month, not at today', () => {
    // A closing reading can be filed for a day that has not happened yet. Stopping at today would
    // hide exactly the rows the reader pressed the button to find.
    const range = widerRange(at('2026-09-13T11:00:00.000Z'));
    expect(range.to, 'past today').toBe('2026-09-30');
  });

  it('covers a whole year — twelve months back plus the month it is in', () => {
    const { from, to } = widerRange(at('2026-09-13T11:00:00.000Z'));
    const months =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
    expect(months, 'twelve whole months back').toBe(WIDER_RANGE_MONTHS);
  });
});
