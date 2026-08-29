// The goal's state machine, argued without a database (P-HR-PRF §4, D9).
import { describe, expect, it } from 'vitest';
import { PERFORMANCE_GOAL_STATUSES } from '@ecms/contracts';
import { canTransition, isOpen } from './goal-rules';

describe('the goal state machine', () => {
  it('goes from active to each of the three ends and nowhere else', () => {
    const allowed = PERFORMANCE_GOAL_STATUSES.flatMap((from) =>
      PERFORMANCE_GOAL_STATUSES.filter((to) => canTransition(from, to)).map(
        (to) => `${from}→${to}`,
      ),
    );
    expect(allowed).toEqual(['active→achieved', 'active→missed', 'active→dropped']);
  });

  /**
   * The one that carries the record's weight. A goal that ended did not un-end: re-opening one
   * would let a closed round's account of itself change after the fact.
   */
  it('never leaves a closed state', () => {
    for (const from of ['achieved', 'missed', 'dropped'] as const) {
      for (const to of PERFORMANCE_GOAL_STATUSES) {
        expect(canTransition(from, to), `${from}→${to}`).toBe(false);
      }
    }
  });

  it('accepts writes only while active', () => {
    expect(PERFORMANCE_GOAL_STATUSES.filter(isOpen)).toEqual(['active']);
  });
});
