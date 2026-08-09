import { describe, expect, it } from 'vitest';
import { canIssue, crossedBelowMin } from './stock-rules';

const level = (onHandQty: number, minQty: number | null = null) => ({ onHandQty, minQty });

describe('crossedBelowMin', () => {
  it('fires on the edge — the movement that reached the minimum', () => {
    expect(crossedBelowMin(level(5, 3), level(3, 3))).toBe(true);
  });

  it('fires when the movement jumped clean past the minimum', () => {
    expect(crossedBelowMin(level(5, 3), level(1, 3))).toBe(true);
  });

  // The whole reason it is an edge and not a state: a part sitting below its minimum must not warn
  // on every consumption, or the warning stops meaning anything.
  it('stays silent when the part was already at or below the minimum', () => {
    expect(crossedBelowMin(level(3, 3), level(2, 3))).toBe(false);
    expect(crossedBelowMin(level(1, 3), level(0, 3))).toBe(false);
  });

  it('stays silent while the level is still above the minimum', () => {
    expect(crossedBelowMin(level(9, 3), level(4, 3))).toBe(false);
  });

  // "Not set" means there is no minimum, not that the minimum is zero.
  it('never fires for a part with no minimum', () => {
    expect(crossedBelowMin(level(5, null), level(0, null))).toBe(false);
  });

  it('reads the minimum from the state AFTER the movement — an edit mid-flight still counts', () => {
    expect(crossedBelowMin(level(5, 10), level(4, 4))).toBe(true);
  });
});

describe('canIssue', () => {
  it('issues exactly what is on hand, and not one more', () => {
    expect(canIssue(level(3), 3)).toBe(true);
    expect(canIssue(level(3), 4)).toBe(false);
  });

  it('refuses to issue from an empty shelf (FR-9: on-hand never goes negative)', () => {
    expect(canIssue(level(0), 1)).toBe(false);
  });

  // A zero or negative "issue" is a movement in the wrong direction wearing the wrong name; the
  // ledger has one way to add stock and it is a receipt.
  it('refuses a non-positive quantity', () => {
    expect(canIssue(level(5), 0)).toBe(false);
    expect(canIssue(level(5), -2)).toBe(false);
  });
});
