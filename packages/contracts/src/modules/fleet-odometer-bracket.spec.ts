// The bracket rule, exhaustively — it is the ONE comparison both the API's alarm projection and
// the maintenance dialogs run, so a drift here is a drift everywhere.
import { describe, expect, it } from 'vitest';
import {
  odometerBracketBreach,
  odometerBracketSatisfied,
  type FleetOdometerBracketBounds,
} from './fleet-odometer-bracket.js';

const LOWER = 100_000;
const UPPER = 120_000;
const BOTH: FleetOdometerBracketBounds = { lowerBound: LOWER, upperBound: UPPER };

describe('the boundary is INCLUSIVE on both sides', () => {
  it('equal to the lower bound is inside', () => {
    expect(odometerBracketBreach(LOWER, BOTH)).toBeNull();
  });
  it('equal to the upper bound is inside', () => {
    expect(odometerBracketBreach(UPPER, BOTH)).toBeNull();
  });
  it('one below the lower bound is out', () => {
    expect(odometerBracketBreach(LOWER - 1, BOTH)).toBe('belowChain');
  });
  it('one above the upper bound is out', () => {
    expect(odometerBracketBreach(UPPER + 1, BOTH)).toBe('aboveChain');
  });
});

describe('an absent bound constrains nothing', () => {
  it('no lower bound ⇒ the low side can never fire', () => {
    const bounds = { lowerBound: null, upperBound: UPPER };
    for (const counter of [0, 1, LOWER, UPPER]) {
      expect(odometerBracketBreach(counter, bounds), String(counter)).toBeNull();
    }
    expect(odometerBracketBreach(UPPER + 1, bounds)).toBe('aboveChain');
  });

  it('no upper bound ⇒ the high side can never fire', () => {
    const bounds = { lowerBound: LOWER, upperBound: null };
    for (const counter of [LOWER, UPPER, 9_999_999]) {
      expect(odometerBracketBreach(counter, bounds), String(counter)).toBeNull();
    }
    expect(odometerBracketBreach(LOWER - 1, bounds)).toBe('belowChain');
  });

  it('neither bound ⇒ silence for every possible counter', () => {
    const bounds = { lowerBound: null, upperBound: null };
    for (const counter of [0, 1, LOWER, UPPER, Number.MAX_SAFE_INTEGER]) {
      expect(odometerBracketBreach(counter, bounds), String(counter)).toBeNull();
    }
  });

  it('absent is ABSENT — never a bound of zero', () => {
    // The distinction a `?? 0` default would erase. It hides for as long as every counter happens
    // to be non-negative, which is true of odometer readings and NOT true of this function: it is
    // exported, total, and takes any finite number. A negative counter with no lower bound has
    // nothing to be below, and answering `belowChain` would be inventing the bound.
    expect(odometerBracketBreach(-1, { lowerBound: null, upperBound: null })).toBeNull();
    expect(odometerBracketBreach(-1, { lowerBound: null, upperBound: UPPER })).toBeNull();
    expect(odometerBracketBreach(-1_000_000, { lowerBound: null, upperBound: null })).toBeNull();
    // …and a bound that IS zero still constrains, which is what makes the two distinguishable.
    expect(odometerBracketBreach(-1, { lowerBound: 0, upperBound: null })).toBe('belowChain');
    expect(odometerBracketBreach(0, { lowerBound: 0, upperBound: null })).toBeNull();
  });
});

describe('an unknown counter is never a violation', () => {
  it('null, NaN and Infinity all answer null', () => {
    for (const counter of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(odometerBracketBreach(counter, BOTH), String(counter)).toBeNull();
    }
  });
});

describe('an inverted bracket still answers deterministically', () => {
  it('the low side is tested first, so every counter gets one stable answer', () => {
    // `lowerBound > upperBound` cannot arise from a monotonic chain, but it is representable, and
    // an impossible input must not depend on evaluation order. Below the low bound wins outright;
    // between the two inverted bounds, the high side answers. Every counter is covered, once.
    const inverted = { lowerBound: UPPER, upperBound: LOWER };
    expect(odometerBracketBreach(UPPER - 1, inverted)).toBe('belowChain');
    expect(odometerBracketBreach(LOWER - 1, inverted)).toBe('belowChain');
    expect(odometerBracketBreach(UPPER + 1, inverted)).toBe('aboveChain');
    // …and it is stable: the same input always answers the same way.
    for (const counter of [0, LOWER, UPPER, UPPER + 1000]) {
      expect(odometerBracketBreach(counter, inverted)).toBe(
        odometerBracketBreach(counter, inverted),
      );
    }
  });
});

describe('exhaustive sweep — the rule is exactly the two comparisons it claims to be', () => {
  it('agrees with an independent restatement across the whole range and every bound shape', () => {
    const expected = (counter: number, b: FleetOdometerBracketBounds): string | null => {
      if (b.lowerBound !== null && counter < b.lowerBound) return 'belowChain';
      if (b.upperBound !== null && counter > b.upperBound) return 'aboveChain';
      return null;
    };
    const shapes: FleetOdometerBracketBounds[] = [
      BOTH,
      { lowerBound: LOWER, upperBound: null },
      { lowerBound: null, upperBound: UPPER },
      { lowerBound: null, upperBound: null },
      { lowerBound: LOWER, upperBound: LOWER },
    ];
    let breaches = 0;
    for (const bounds of shapes) {
      for (let counter = LOWER - 2000; counter <= UPPER + 2000; counter += 137) {
        const actual = odometerBracketBreach(counter, bounds);
        expect(actual, `${counter} against ${JSON.stringify(bounds)}`).toBe(
          expected(counter, bounds),
        );
        if (actual !== null) breaches += 1;
        expect(odometerBracketSatisfied(counter, bounds)).toBe(actual === null);
      }
    }
    // The sweep must actually exercise both outcomes, or it proves nothing.
    expect(breaches).toBeGreaterThan(0);
  });
});
