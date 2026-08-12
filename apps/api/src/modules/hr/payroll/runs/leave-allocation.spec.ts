// Cutting a leave consumption to a period (PY-6), without a database.
//
// The cases that matter are the boundary ones — an entry that straddles a month end, a rate change
// that falls on the wrong side of it, a request that starts at midday — and every one of them is
// arithmetic over values.
import { describe, expect, it } from 'vitest';
import { sliceForPeriod, takeBreakdown, type ConsumedLeave } from './leave-allocation';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const MARCH = { from: d('2026-03-01'), to: d('2026-03-31') };
const APRIL = { from: d('2026-04-01'), to: d('2026-04-30') };

const consumed = (over: Partial<ConsumedLeave> = {}): ConsumedLeave => ({
  from: d('2026-03-10'),
  to: d('2026-03-14'),
  days: 5,
  breakdown: [{ days: 5, payRate: 100 }],
  ...over,
});

describe('an entry that lies wholly inside the period', () => {
  it('is copied verbatim, and says nothing was inferred', () => {
    const slice = sliceForPeriod(consumed(), MARCH);
    expect(slice?.allocation).toBe('whole');
    expect(slice?.days).toBe(5);
    expect(slice?.breakdown).toEqual([{ days: 5, payRate: 100 }]);
    expect(slice?.from).toEqual(d('2026-03-10'));
    expect(slice?.to).toEqual(d('2026-03-14'));
  });

  it('keeps a multi-tier split exactly as the ledger wrote it', () => {
    const slice = sliceForPeriod(
      consumed({ days: 10, from: d('2026-03-05'), to: d('2026-03-14'), breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] }),
      MARCH,
    );
    expect(slice?.allocation).toBe('whole');
    expect(slice?.breakdown).toEqual([{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }]);
  });

  it('is null when the entry does not reach the period at all', () => {
    expect(sliceForPeriod(consumed(), APRIL)).toBeNull();
    expect(sliceForPeriod(consumed({ from: d('2026-01-02'), to: d('2026-01-06') }), MARCH)).toBeNull();
  });
});

describe('an entry that straddles the boundary', () => {
  // 28 March → 6 April, ten days, seven at full pay then three at half.
  const straddling = consumed({
    from: d('2026-03-28'),
    to: d('2026-04-06'),
    days: 10,
    breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }],
  });

  it('gives March its four days, at the rate that applied to them', () => {
    const slice = sliceForPeriod(straddling, MARCH);
    expect(slice?.allocation).toBe('chronological');
    expect(slice?.from).toEqual(d('2026-03-28'));
    expect(slice?.to).toEqual(d('2026-03-31'));
    expect(slice?.days).toBe(4);
    // The first four days are inside the first tier, so March sees only the full rate.
    expect(slice?.breakdown).toEqual([{ days: 4, payRate: 100 }]);
  });

  it('gives April the rest, including the rate change that falls in it', () => {
    const slice = sliceForPeriod(straddling, APRIL);
    expect(slice?.allocation).toBe('chronological');
    expect(slice?.days).toBe(6);
    // Days 5–7 at full, days 8–10 at half — the change lands inside April.
    expect(slice?.breakdown).toEqual([{ days: 3, payRate: 100 }, { days: 3, payRate: 50 }]);
  });

  // The property the reconciliation test in the integration suite depends on.
  it('splits without losing or inventing a day', () => {
    const march = sliceForPeriod(straddling, MARCH);
    const april = sliceForPeriod(straddling, APRIL);
    expect((march?.days ?? 0) + (april?.days ?? 0)).toBe(straddling.days);

    const dayTotal = (slice: typeof march): number =>
      (slice?.breakdown ?? []).reduce((sum, tier) => sum + tier.days, 0);
    expect(dayTotal(march) + dayTotal(april)).toBe(straddling.days);
  });

  it('carries only the tail rate when the whole slice is past the change', () => {
    const slice = sliceForPeriod(
      consumed({
        from: d('2026-03-25'),
        to: d('2026-04-03'),
        days: 10,
        breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }],
      }),
      APRIL,
    );
    expect(slice?.days).toBe(3);
    expect(slice?.breakdown).toEqual([{ days: 3, payRate: 50 }]);
  });
});

describe('half days (D2 — carried on their own calendar day, never rounded away)', () => {
  // 30 March → 2 April with a half day at each end: 3 days over 4 calendar days.
  const halved = consumed({
    from: d('2026-03-30'),
    to: d('2026-04-02'),
    days: 3,
    breakdown: [{ days: 3, payRate: 100 }],
  });

  it('spreads the days across the calendar days in proportion', () => {
    const march = sliceForPeriod(halved, MARCH);
    const april = sliceForPeriod(halved, APRIL);
    expect(march?.days).toBe(1.5); // two calendar days of four
    expect(april?.days).toBe(1.5);
    expect((march?.days ?? 0) + (april?.days ?? 0)).toBe(3);
  });
});

describe('takeBreakdown', () => {
  const tiers = [
    { days: 7, payRate: 100 },
    { days: 3, payRate: 50 },
  ];

  it('takes from the front when nothing is skipped', () => {
    expect(takeBreakdown(tiers, 0, 4)).toEqual([{ days: 4, payRate: 100 }]);
  });

  it('skips into a later tier', () => {
    expect(takeBreakdown(tiers, 7, 3)).toEqual([{ days: 3, payRate: 50 }]);
    expect(takeBreakdown(tiers, 8, 2)).toEqual([{ days: 2, payRate: 50 }]);
  });

  it('spans a rate change, preserving the order the rates applied in', () => {
    expect(takeBreakdown(tiers, 5, 4)).toEqual([
      { days: 2, payRate: 100 },
      { days: 2, payRate: 50 },
    ]);
  });

  it('is empty past the end, and takes nothing for no days', () => {
    expect(takeBreakdown(tiers, 10, 5)).toEqual([]);
    expect(takeBreakdown(tiers, 0, 0)).toEqual([]);
  });

  // The proportion above can leave a sliver; a hundredth of a day is noise, not a tier.
  it('drops an arithmetic sliver rather than emitting a zero-day tier', () => {
    expect(takeBreakdown(tiers, 6.999, 0.001)).toEqual([]);
  });
});
