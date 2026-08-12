// The D2 resolution rule as a pure function: among assignments covering a date, a BOUNDED
// interval beats the open one (an override is more specific than the standing assignment), and
// among bounded ones the later anchor wins. The engine's "which shift today?" hangs off this.
import { describe, expect, it } from 'vitest';
import { pickAssignmentForDate } from './shift-assignment.service';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const open = { fromDate: d('2026-01-01'), toDate: null, shift: 'GENERAL' };
const override = { fromDate: d('2026-07-15'), toDate: d('2026-07-15'), shift: 'NIGHT' };

describe('pickAssignmentForDate', () => {
  it('returns null when nothing covers the date', () => {
    expect(pickAssignmentForDate([open], d('2025-12-31'))).toBeNull();
    expect(pickAssignmentForDate([override], d('2026-07-16'))).toBeNull();
  });

  it('the open interval is the standing answer', () => {
    expect(pickAssignmentForDate([open], d('2026-07-14'))?.shift).toBe('GENERAL');
  });

  it('a one-day override wins over the open interval, on its day only', () => {
    const pool = [open, override];
    expect(pickAssignmentForDate(pool, d('2026-07-15'))?.shift).toBe('NIGHT');
    expect(pickAssignmentForDate(pool, d('2026-07-16'))?.shift).toBe('GENERAL');
  });

  it('among bounded intervals, the later anchor wins', () => {
    const week = { fromDate: d('2026-07-13'), toDate: d('2026-07-19'), shift: 'WEEK' };
    expect(pickAssignmentForDate([open, week, override], d('2026-07-15'))?.shift).toBe('NIGHT');
    expect(pickAssignmentForDate([open, week], d('2026-07-15'))?.shift).toBe('WEEK');
  });

  it('interval ends are inclusive on both sides', () => {
    const bounded = { fromDate: d('2026-07-10'), toDate: d('2026-07-20'), shift: 'B' };
    expect(pickAssignmentForDate([bounded], d('2026-07-10'))?.shift).toBe('B');
    expect(pickAssignmentForDate([bounded], d('2026-07-20'))?.shift).toBe('B');
  });
});
