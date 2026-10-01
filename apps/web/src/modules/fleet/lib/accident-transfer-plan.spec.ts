import { describe, expect, it } from 'vitest';
import { coverDeficit, planTakes } from './accident-transfer-plan';

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

describe('coverDeficit — the amount is worked out, never typed', () => {
  it('covers -2300 from 100, 200, 500 and 1800 picked in that order', () => {
    const plan = coverDeficit(
      [car('100', 100), car('200', 200), car('500', 500), car('1800', 1800)],
      -2300,
    );
    expect(plan.amount).toBe(2300);
    expect(plan.rows.map((r) => [r.take, r.left])).toEqual([
      [100, 0],
      [200, 0],
      [500, 0],
      [1500, 300],
    ]);
    expect(plan.short).toBe(false);
  });

  it('takes everything the cars have when they cannot reach zero', () => {
    const plan = coverDeficit([car('a', 100), car('b', 200)], -2300);
    expect(plan.amount).toBe(300);
    expect(plan.rows.map((r) => r.left)).toEqual([0, 0]);
  });

  it('leaves a car picked after the accident reached zero untouched', () => {
    const plan = coverDeficit([car('a', 500), car('b', 200)], -400);
    expect(plan.rows.map((r) => [r.take, r.left])).toEqual([
      [400, 100],
      [0, 200],
    ]);
  });

  it('takes nothing from an accident that is not negative', () => {
    expect(coverDeficit([car('a', 500)], 0).amount).toBe(0);
    expect(coverDeficit([car('a', 500)], 250).amount).toBe(0);
  });

  it('adds up to the piastre', () => {
    expect(coverDeficit([car('a', 0.1), car('b', 0.25)], -0.3).amount).toBe(0.3);
  });
});
