// The schedule generator (P-HR-05 / D5) — pure, so all of it is arguable without a database.
//
// ONE ASSERTION MATTERS MORE THAN THE REST: `sum(installments) === principal`, exactly, in integer
// minor units. D10 froze that a loan is its principal and nothing else — no interest, no fee, no
// penalty — so a schedule that does not add up is not a rounding artefact, it is a different amount
// of money. It is therefore stated over hundreds of shapes rather than over one convenient one.
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '../../../shared/errors';
import {
  accelerateTail,
  assertScheduleTotals,
  generateSchedule,
  nextPeriod,
  periodOfDate,
  periodsFrom,
  totalMinor,
} from './loan-schedule';

describe('the months a schedule occupies', () => {
  it('runs forward one month at a time', () => {
    expect(nextPeriod('2026-01')).toBe('2026-02');
    expect(nextPeriod('2026-09')).toBe('2026-10');
  });

  // The year boundary, which is the only interesting case: string arithmetic rather than a Date,
  // so that no timezone can move a month to the one before it.
  it('crosses the year without a Date', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(periodsFrom('2026-11', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('refuses something that is not a period', () => {
    expect(() => nextPeriod('2026-13')).toThrow(BusinessRuleError);
    expect(() => nextPeriod('2026')).toThrow(BusinessRuleError);
  });

  // The UTC parts of a business date, so no server timezone can name the month before it.
  it('names the month a business date falls in', () => {
    expect(periodOfDate(new Date('2026-03-17T00:00:00.000Z'))).toBe('2026-03');
    expect(periodOfDate(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
    expect(periodOfDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12');
  });
});

describe('a schedule adds up to the principal, always', () => {
  it('splits evenly when it divides', () => {
    const schedule = generateSchedule(600_000, 6, '2026-03');
    expect(schedule.map((row) => row.amountMinor)).toEqual([
      100_000, 100_000, 100_000, 100_000, 100_000, 100_000,
    ]);
    expect(totalMinor(schedule)).toBe(600_000);
  });

  // 100.00 over three months is 33.33 + 33.33 + 33.34 — never 33.33 × 3, which would quietly
  // forgive a piastre, and never 33.34 × 3, which would charge one that was never lent.
  it('puts the remainder on the LAST instalment', () => {
    const schedule = generateSchedule(10_000, 3, '2026-01');
    expect(schedule.map((row) => row.amountMinor)).toEqual([3_333, 3_333, 3_334]);
    expect(totalMinor(schedule)).toBe(10_000);
  });

  it('numbers and dates every row in order', () => {
    const schedule = generateSchedule(30_000, 3, '2026-11');
    expect(schedule).toEqual([
      { seq: 1, period: '2026-11', amountMinor: 10_000 },
      { seq: 2, period: '2026-12', amountMinor: 10_000 },
      { seq: 3, period: '2027-01', amountMinor: 10_000 },
    ]);
  });

  it('an advance is a loan with one instalment', () => {
    expect(generateSchedule(250_000, 1, '2026-05')).toEqual([
      { seq: 1, period: '2026-05', amountMinor: 250_000 },
    ]);
  });

  /**
   * The invariant, over every shape a caller can reach rather than the three above.
   *
   * If this ever fails it fails on a specific pair, and the message names it — which is the whole
   * reason to sweep rather than to pick.
   */
  it('holds for every principal and count in a wide sweep', () => {
    for (let principalMinor = 1; principalMinor <= 400; principalMinor += 1) {
      for (let count = 1; count <= Math.min(principalMinor, 24); count += 1) {
        const schedule = generateSchedule(principalMinor, count, '2026-01');
        expect(totalMinor(schedule), `${String(principalMinor)}/${String(count)}`).toBe(
          principalMinor,
        );
        expect(schedule, `${String(principalMinor)}/${String(count)}`).toHaveLength(count);
        for (const row of schedule) {
          expect(row.amountMinor, `${String(principalMinor)}/${String(count)}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('and over amounts a real salary would carry', () => {
    for (const principalMinor of [1_000_000, 1_234_567, 999_999, 5_000_001]) {
      for (const count of [1, 2, 3, 7, 12, 13, 24, 120]) {
        expect(totalMinor(generateSchedule(principalMinor, count, '2026-06'))).toBe(principalMinor);
      }
    }
  });
});

describe('what the generator refuses', () => {
  // An instalment of zero is not an instalment — it is a month the schedule pretends to occupy.
  // Rounding it away would silently shorten the repayment instead of refusing the request.
  it('a count larger than the principal has minor units', () => {
    expect(() => generateSchedule(500, 501, '2026-01')).toThrow(BusinessRuleError);
    expect(() => generateSchedule(500, 500, '2026-01')).not.toThrow();
  });

  it('a principal that is not a positive integer of minor units', () => {
    expect(() => generateSchedule(0, 1, '2026-01')).toThrow(BusinessRuleError);
    expect(() => generateSchedule(-100, 1, '2026-01')).toThrow(BusinessRuleError);
    expect(() => generateSchedule(100.5, 1, '2026-01')).toThrow(BusinessRuleError);
  });

  it('a count below one', () => {
    expect(() => generateSchedule(100, 0, '2026-01')).toThrow(BusinessRuleError);
  });
});

describe('paying more this month finishes it earlier (D7-2)', () => {
  const later = [
    { period: '2026-04', amountMinor: 10_000 },
    { period: '2026-05', amountMinor: 10_000 },
    { period: '2026-06', amountMinor: 10_000 },
  ];
  const target = { period: '2026-03', amountMinor: 10_000 };

  // The extra comes off the END, so the loan ends sooner and the total never moves.
  it('removes whole months from the end', () => {
    const after = accelerateTail(target, later, 20_000);
    expect(after).toEqual([
      { period: '2026-03', amountMinor: 30_000 },
      { period: '2026-04', amountMinor: 10_000 },
    ]);
    expect(totalMinor(after)).toBe(40_000);
  });

  it('and reduces the month the extra runs out inside', () => {
    const after = accelerateTail(target, later, 15_000);
    expect(after).toEqual([
      { period: '2026-03', amountMinor: 25_000 },
      { period: '2026-04', amountMinor: 10_000 },
      { period: '2026-05', amountMinor: 5_000 },
    ]);
    expect(totalMinor(after)).toBe(40_000);
  });

  // Paying the whole remainder forward is legal, and it leaves exactly one month.
  it('collapses to a single month when the extra is everything left', () => {
    const after = accelerateTail(target, later, 30_000);
    expect(after).toEqual([{ period: '2026-03', amountMinor: 40_000 }]);
  });

  /**
   * THE assertion this operation exists to keep. Whatever the extra is, the schedule still totals
   * what it did before — an acceleration repays FASTER, it does not repay MORE.
   */
  it('never changes the total, for any extra it accepts', () => {
    for (let extra = 1; extra <= 30_000; extra += 137) {
      const after = accelerateTail(target, later, extra);
      expect(totalMinor(after), String(extra)).toBe(40_000);
    }
  });

  it('refuses to take more than the later instalments hold', () => {
    expect(() => accelerateTail(target, later, 30_001)).toThrow(BusinessRuleError);
    // …and refuses on the last instalment, where there is nothing after it to bring forward.
    expect(() => accelerateTail(target, [], 1)).toThrow(BusinessRuleError);
  });

  it('and refuses an extra that is not a positive amount', () => {
    for (const extra of [0, -100, 10.5]) {
      expect(() => accelerateTail(target, later, extra), String(extra)).toThrow(BusinessRuleError);
    }
  });
});

describe('a reschedule moves instalments, not the debt (D6)', () => {
  it('passes when the totals match to the minor unit', () => {
    expect(() => assertScheduleTotals(10_000, generateSchedule(10_000, 7, '2026-02'))).not.toThrow();
  });

  it('refuses when they do not', () => {
    expect(() => assertScheduleTotals(10_001, generateSchedule(10_000, 7, '2026-02'))).toThrow(
      BusinessRuleError,
    );
  });
});
