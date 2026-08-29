// The review's state machine and the two «who» questions, argued without a database (§4, D5, D6).
import { describe, expect, it } from 'vitest';
import { PERFORMANCE_REVIEW_STATUSES, TERMINAL_REVIEW_STATUSES } from '@ecms/contracts';
import { canTransition, isAssignedEvaluator, isTerminal, mayEvaluate } from './review-rules';

describe('the review state machine', () => {
  it('allows exactly the transitions §4 describes', () => {
    const allowed = PERFORMANCE_REVIEW_STATUSES.flatMap((from) =>
      PERFORMANCE_REVIEW_STATUSES.filter((to) => canTransition(from, to)).map(
        (to) => `${from}→${to}`,
      ),
    );
    expect(allowed).toEqual([
      'draft→submitted',
      'draft→excused',
      'submitted→draft',
      'submitted→finalized',
      'submitted→excused',
    ]);
  });

  /**
   * The return, as a transition rather than a state. A review sent back is INDISTINGUISHABLE from
   * one never written — which is the point: the evaluator's queue has one word for «this is yours».
   */
  it('sends a submitted review back to draft', () => {
    expect(canTransition('submitted', 'draft')).toBe(true);
    expect(canTransition('draft', 'draft')).toBe(false);
  });

  it('never leaves a terminal state', () => {
    for (const from of TERMINAL_REVIEW_STATUSES) {
      for (const to of PERFORMANCE_REVIEW_STATUSES) {
        expect(canTransition(from, to), `${from}→${to}`).toBe(false);
      }
    }
  });

  /** The machine's own answer, so the close guard and the contract cannot drift apart. */
  it('agrees with the contract about which states are terminal', () => {
    expect(PERFORMANCE_REVIEW_STATUSES.filter(isTerminal)).toEqual([...TERMINAL_REVIEW_STATUSES]);
  });

  it('excuses somebody from either open state', () => {
    expect(canTransition('draft', 'excused')).toBe(true);
    expect(canTransition('submitted', 'excused')).toBe(true);
  });
});

describe('who may write (D5)', () => {
  it('refuses the subject as their own evaluator', () => {
    expect(mayEvaluate('emp-1', 'emp-1')).toBe(false);
    expect(mayEvaluate('emp-1', 'emp-2')).toBe(true);
  });

  it('recognises the assigned evaluator and nobody else', () => {
    expect(isAssignedEvaluator('emp-2', 'emp-2')).toBe(true);
    expect(isAssignedEvaluator('emp-2', 'emp-3')).toBe(false);
  });

  /**
   * Null on either side is FALSE, and both cases are real: a review nobody has been assigned to,
   * and a caller with no employee record. Either treated as a match would let the wrong person —
   * or anybody at all — submit an assessment.
   */
  it('treats a missing assignment or a missing employee as no', () => {
    expect(isAssignedEvaluator(null, 'emp-2')).toBe(false);
    expect(isAssignedEvaluator('emp-2', null)).toBe(false);
    expect(isAssignedEvaluator(null, null)).toBe(false);
  });
});
