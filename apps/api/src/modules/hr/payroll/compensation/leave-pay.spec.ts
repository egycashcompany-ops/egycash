// The leave shortfall, exercised without a database (PY-5).
//
// The arithmetic is small and the consequences are not: this is the first thing in the system that
// turns `payRate` into money, and getting the direction wrong pays somebody for an absence. So the
// cases below state the figure they expect rather than recomputing it.
import { describe, expect, it } from 'vitest';
import {
  isChargeable,
  leaveFactsOf,
  shortfallMinor,
  shortfallsOf,
  type FrozenLeave,
  type LeaveSliceFacts,
} from './leave-pay';

const leave = (slices: LeaveSliceFacts[]): FrozenLeave => ({
  runId: 'run1',
  snapshotAt: '2026-04-01T09:00:00.000Z',
  slices,
});

// 10,000.00 in minor units — the basic salary every figure below is a fraction of.
const BASIC = 1_000_000;
const MARCH = 31;

describe('grouping the snapshot into shortfalls', () => {
  it('keeps one group per rate and never averages two', () => {
    const groups = shortfallsOf(
      leave([{ typeCode: 'SICK', days: 10, breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] }]),
    );
    expect(groups).toEqual([
      { typeCode: 'SICK', payRate: 100, days: 7 },
      { typeCode: 'SICK', payRate: 50, days: 3 },
    ]);
  });

  it('adds days of the same type and rate across separate slices', () => {
    const groups = shortfallsOf(
      leave([
        { typeCode: 'SICK', days: 3, breakdown: [{ days: 3, payRate: 75 }] },
        { typeCode: 'SICK', days: 2, breakdown: [{ days: 2, payRate: 75 }] },
      ]),
    );
    expect(groups).toEqual([{ typeCode: 'SICK', payRate: 75, days: 5 }]);
  });

  it('keeps two TYPES apart even at the same rate — a line has to name its own absence', () => {
    const groups = shortfallsOf(
      leave([
        { typeCode: 'UNPAID', days: 2, breakdown: [{ days: 2, payRate: 0 }] },
        { typeCode: 'ABSENCE', days: 1, breakdown: [{ days: 1, payRate: 0 }] },
      ]),
    );
    expect(groups).toEqual([
      { typeCode: 'ABSENCE', payRate: 0, days: 1 },
      { typeCode: 'UNPAID', payRate: 0, days: 2 },
    ]);
  });

  it('orders by rate descending, then by type code', () => {
    const groups = shortfallsOf(
      leave([
        { typeCode: 'UNPAID', days: 1, breakdown: [{ days: 1, payRate: 0 }] },
        { typeCode: 'SICK', days: 1, breakdown: [{ days: 1, payRate: 50 }] },
        { typeCode: 'ANNUAL', days: 1, breakdown: [{ days: 1, payRate: 100 }] },
      ]),
    );
    expect(groups.map((g) => g.payRate)).toEqual([100, 50, 0]);
  });

  it('answers an empty snapshot with no groups at all', () => {
    expect(shortfallsOf(leave([]))).toEqual([]);
  });
});

describe('which groups cost anything', () => {
  it('charges nothing for leave paid in full — no line, not a zero one', () => {
    expect(isChargeable({ typeCode: 'ANNUAL', payRate: 100, days: 5 })).toBe(false);
  });

  it('charges a partially paid group', () => {
    expect(isChargeable({ typeCode: 'SICK', payRate: 75, days: 5 })).toBe(true);
  });

  it('charges an unpaid group', () => {
    expect(isChargeable({ typeCode: 'UNPAID', payRate: 0, days: 1 })).toBe(true);
  });

  it('charges nothing for a group with no days', () => {
    expect(isChargeable({ typeCode: 'UNPAID', payRate: 0, days: 0 })).toBe(false);
  });
});

describe('what a shortfall costs', () => {
  // The property that makes the divisor defensible: a whole month of unpaid leave costs exactly
  // the basic salary, in a 31-day month and a 28-day one alike.
  it('costs the whole basic salary for a whole month unpaid', () => {
    expect(shortfallMinor({ typeCode: 'UNPAID', payRate: 0, days: 31 }, BASIC, 31)).toBe(BASIC);
    expect(shortfallMinor({ typeCode: 'UNPAID', payRate: 0, days: 28 }, BASIC, 28)).toBe(BASIC);
  });

  it('costs one day of basic salary for one unpaid day', () => {
    // 10,000 ÷ 31 = 322.5806… → 322.58
    expect(shortfallMinor({ typeCode: 'UNPAID', payRate: 0, days: 1 }, BASIC, MARCH)).toBe(32_258);
  });

  it('costs half of that at 50%', () => {
    // 10,000 × 50% ÷ 31 = 161.29
    expect(shortfallMinor({ typeCode: 'SICK', payRate: 50, days: 1 }, BASIC, MARCH)).toBe(16_129);
  });

  it('costs a quarter day at 75% for half a day taken', () => {
    // 10,000 × 25% × 0.5 ÷ 31 = 40.3225… → 40.32
    expect(shortfallMinor({ typeCode: 'SICK', payRate: 75, days: 0.5 }, BASIC, MARCH)).toBe(4032);
  });

  // ONE rounding step: the percentage and the day fraction are multiplied before they touch the
  // salary. Rounding each in turn would give 10,000 × 0.25 = 2,500.00 then ×3/31 → 241.94 —
  // the same here, but the difference bites on rates that do not divide evenly, and a line that
  // rounds twice loses a piastre no total can put back.
  it('rounds exactly once', () => {
    // 10,000 × 25% × 3 ÷ 31 = 241.935… → 241.94, never 241.93
    expect(shortfallMinor({ typeCode: 'SICK', payRate: 75, days: 3 }, BASIC, MARCH)).toBe(24_194);
  });

  it('costs nothing at all when the rate is full', () => {
    expect(shortfallMinor({ typeCode: 'ANNUAL', payRate: 100, days: 10 }, BASIC, MARCH)).toBe(0);
  });
});

describe('the facts behind the lines', () => {
  it('splits every day between paid and unpaid, and the two sum back', () => {
    const facts = leaveFactsOf(
      leave([{ typeCode: 'SICK', days: 10, breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] }]),
    );
    expect(facts.totalDays).toBe(10);
    expect(facts.paidDays).toBe(8.5); // 7 + 1.5
    expect(facts.unpaidDays).toBe(1.5);
    expect(facts.paidDays + facts.unpaidDays).toBe(facts.totalDays);
  });

  it('groups days by rate across types — these are facts, not lines', () => {
    const facts = leaveFactsOf(
      leave([
        { typeCode: 'SICK', days: 2, breakdown: [{ days: 2, payRate: 50 }] },
        { typeCode: 'UNPAID', days: 1, breakdown: [{ days: 1, payRate: 50 }] },
      ]),
    );
    expect(facts.byRate).toEqual([{ payRate: 50, days: 3 }]);
  });

  it('carries the run and the stamp the figures were read from', () => {
    const facts = leaveFactsOf(leave([]));
    expect(facts.runId).toBe('run1');
    expect(facts.snapshotAt).toBe('2026-04-01T09:00:00.000Z');
    expect(facts.totalDays).toBe(0);
  });

  it('handles the fractional days a straddling entry leaves behind', () => {
    // The `chronological` case rounds its slice to two decimals, so the tiers arriving here can
    // be things like 3.23 — carried, never re-rounded into a different number of days.
    const facts = leaveFactsOf(
      leave([{ typeCode: 'SICK', days: 3.23, breakdown: [{ days: 3.23, payRate: 50 }] }]),
    );
    expect(facts.totalDays).toBe(3.23);
    expect(facts.paidDays).toBe(1.62); // 1.615 → 1.62
    // …and the remainder is the SUBTRACTION, not a second independent rounding — otherwise both
    // halves round up and 1.62 + 1.62 claims 3.24 days were taken.
    expect(facts.unpaidDays).toBe(1.61);
    // Close, not identical: 1.62 + 1.61 is 3.2300000000000004 in binary floating point. The
    // reconciliation these figures owe a reader is at their own two decimals, not at the bit.
    expect(facts.paidDays + facts.unpaidDays).toBeCloseTo(facts.totalDays, 10);
  });
});
