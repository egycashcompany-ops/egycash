// «حذف العملية» — what a delete does to «إجمالي العهدة», at the level that needs no database: the
// fold's own rule (only what is `done` ever moved the fund), to the piastre, negatives allowed.
import { describe, expect, it } from 'vitest';
import { deletionEffectPiastres, fundAfterDeleteOf } from './custody-fund-delete';

describe('the fund after a delete', () => {
  it('a charge comes off the fund; a settlement goes back into it', () => {
    expect(deletionEffectPiastres({ kind: 'charge', status: 'done', amount: 150000 })).toBe(
      -15000000,
    );
    expect(fundAfterDeleteOf(150000, { kind: 'charge', status: 'done', amount: 150000 })).toBe(0);
    expect(
      fundAfterDeleteOf(175260.54, { kind: 'settle', status: 'done', amount: 124139.46 }),
    ).toBe(299400);
  });

  it('a replenishment moves it only when it counted: transferred, or from before the hold', () => {
    const replenish = { kind: 'replenish', amount: 81908 } as const;
    expect(fundAfterDeleteOf(99400, { ...replenish, status: 'done' })).toBe(17492);
    // No status at all: a row from before the statuses reads as `done`.
    expect(fundAfterDeleteOf(99400, { kind: 'replenish', amount: 81908 })).toBe(17492);
    expect(fundAfterDeleteOf(17492, { ...replenish, status: 'held' })).toBe(17492);
    expect(fundAfterDeleteOf(17492, { ...replenish, status: 'cancelled' })).toBe(17492);
  });

  it('is exact to the piastre and may go negative — never -0', () => {
    expect(fundAfterDeleteOf(0.3, { kind: 'charge', status: 'done', amount: 0.1 })).toBe(0.2);
    expect(fundAfterDeleteOf(6, { kind: 'charge', status: 'done', amount: 5000 })).toBe(-4994);
    expect(
      Object.is(fundAfterDeleteOf(0.1, { kind: 'charge', status: 'done', amount: 0.1 }), 0),
    ).toBe(true);
  });
});
