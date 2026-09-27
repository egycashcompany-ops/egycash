import { describe, expect, it } from 'vitest';
import { planTakes } from './accident-transfer-plan';

const car = (vehicleId: string, available: number) => ({ vehicleId, code: vehicleId, available });

describe('planTakes — the first car to zero before the next', () => {
  it('empties the first car picked, then takes the rest from the second', () => {
    const plan = planTakes([car('214', 300), car('305', 1000)], 500);
    expect(plan.rows.map((r) => [r.vehicleId, r.take, r.left])).toEqual([
      ['214', 300, 0],
      ['305', 200, 800],
    ]);
    expect(plan.total).toBe(1300);
    expect(plan.short).toBe(false);
  });

  it('follows the order PICKED, not the order of the codes', () => {
    const plan = planTakes([car('305', 1000), car('214', 300)], 500);
    expect(plan.rows.map((r) => r.take)).toEqual([500, 0]);
  });

  it('says so when the cars together have less than the amount', () => {
    expect(planTakes([car('214', 300), car('305', 1000)], 1300.01).short).toBe(true);
    expect(planTakes([car('214', 300), car('305', 1000)], 1300).short).toBe(false);
  });

  it('adds up to the piastre', () => {
    const plan = planTakes([car('a', 0.1), car('b', 0.2)], 0.3);
    expect(plan.rows.map((r) => r.take)).toEqual([0.1, 0.2]);
    expect(plan.short).toBe(false);
  });
});
