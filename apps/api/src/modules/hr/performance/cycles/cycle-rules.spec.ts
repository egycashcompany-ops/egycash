// The state machine and the scope, argued without a database (P-HR-PRF §4, D1, D2, D3, D8).
import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_CYCLE_STATUSES,
  type PerformanceCycleScope,
  type PerformanceCycleStatus,
} from '@ecms/contracts';
import { canTransition, isEditable, isOnScale, scopeFilterOf } from './cycle-rules';

describe('the cycle state machine', () => {
  it('goes draft → open → closed and nowhere else', () => {
    const allowed = PERFORMANCE_CYCLE_STATUSES.flatMap((from) =>
      PERFORMANCE_CYCLE_STATUSES.filter((to) => canTransition(from, to)).map(
        (to) => `${from}→${to}`,
      ),
    );
    expect(allowed).toEqual(['draft→open', 'open→closed']);
  });

  /**
   * The one that matters. Re-opening a closed round would return finalized reviews to a state that
   * accepts writes — which is what «finalized» exists to rule out — and would run the materializer
   * a second time over a scope whose people have moved since.
   */
  it('never leaves closed', () => {
    for (const to of PERFORMANCE_CYCLE_STATUSES) {
      expect(canTransition('closed', to), `closed→${to}`).toBe(false);
    }
  });

  it('has no way back to draft', () => {
    for (const from of PERFORMANCE_CYCLE_STATUSES) {
      expect(canTransition(from, 'draft'), `${from}→draft`).toBe(false);
    }
  });

  it('lets only a draft be edited', () => {
    const editable = PERFORMANCE_CYCLE_STATUSES.filter((status: PerformanceCycleStatus) =>
      isEditable(status),
    );
    expect(editable).toEqual(['draft']);
  });
});

describe('the scope (D3)', () => {
  it('turns "everyone" into no filter at all', () => {
    expect(scopeFilterOf({ kind: 'everyone' })).toEqual({});
  });

  /**
   * The two lists are ANDed, and both survive. A filter that dropped one would be a round quietly
   * wider than the one somebody described — the failure this codebase has now had twice under a
   * different name.
   */
  it('keeps both axes of a filter', () => {
    expect(
      scopeFilterOf({ kind: 'filter', branchIds: ['b1'], departmentIds: ['d1', 'd2'] }),
    ).toEqual({ branchIds: ['b1'], departmentIds: ['d1', 'd2'] });
  });

  it('omits the axis that was not given rather than emptying it', () => {
    const filter = scopeFilterOf({ kind: 'filter', departmentIds: ['d1'] });
    expect(filter).toEqual({ departmentIds: ['d1'] });
    expect('branchIds' in filter).toBe(false);
  });

  it('copies the arrays, so a caller cannot mutate the cycle through the filter', () => {
    const scope: PerformanceCycleScope = { kind: 'filter', branchIds: ['b1'] };
    const filter = scopeFilterOf(scope);
    filter.branchIds?.push('b2');
    expect(scope.kind === 'filter' && scope.branchIds).toEqual(['b1']);
  });
});

describe('the scale (D8)', () => {
  const scale = { min: 1, max: 5 };

  it('accepts both ends', () => {
    expect(isOnScale(1, scale)).toBe(true);
    expect(isOnScale(5, scale)).toBe(true);
  });

  it('refuses a point outside it', () => {
    expect(isOnScale(0, scale)).toBe(false);
    expect(isOnScale(6, scale)).toBe(false);
  });

  /**
   * A FRACTION IS NOT A POINT ON THE SCALE, and this is D8 rather than fussiness: 3.4 is what a
   * weighted average produces. A rating is a judgement somebody made, and the scale says which
   * judgements were on offer.
   */
  it('refuses a fraction', () => {
    expect(isOnScale(3.5, scale)).toBe(false);
  });

  it('reads the bounds off the cycle rather than a constant', () => {
    expect(isOnScale(9, { min: 1, max: 10 })).toBe(true);
    expect(isOnScale(9, scale)).toBe(false);
  });
});
