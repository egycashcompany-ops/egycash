// What a cycle may do next, and what a scope means — the two questions with no database in them
// (P-HR-PRF §4, D1, D2, D3).
//
// PURE ON PURPOSE, the same posture `session-rules.ts`, `loan-schedule.ts` and `leave-pay.ts` take:
// the state machine and the scope's meaning are arguable without a Mongo instance, so they are
// argued here and the service is left with reading, writing and saying what happened.
import { type PerformanceCycleScope, type PerformanceCycleStatus } from '@ecms/contracts';

/**
 * §4 — the cycle's state machine, written out rather than inferred.
 *
 * `closed` is terminal in the strong sense. Re-opening a closed round would return finalized
 * reviews (D7) to a state that accepts writes, which is precisely what finalizing rules out — and
 * a second opening would run the materializer again over a scope whose people have moved since.
 *
 * There is no `cancelled`. A round that should not have been opened is closed, and its reviews are
 * excused; deleting it would remove the only record that people were asked and the round was
 * abandoned, which is a thing an employee is entitled to see.
 */
const NEXT: Readonly<Record<PerformanceCycleStatus, readonly PerformanceCycleStatus[]>> = {
  draft: ['open'],
  open: ['closed'],
  closed: [],
};

export const canTransition = (from: PerformanceCycleStatus, to: PerformanceCycleStatus): boolean =>
  NEXT[from].includes(to);

/**
 * Whether the round's definition may still be edited.
 *
 * ONLY IN DRAFT, and this is D2 doing work rather than a convention. Once opened, the reviews
 * exist: moving the scope underneath them would leave rows for people the cycle no longer names,
 * and changing the scale would mean two reviews in one round rated on different rulers.
 */
export const isEditable = (status: PerformanceCycleStatus): boolean => status === 'draft';

/**
 * D3 — the scope, as a filter over employees. NOTHING IS INFERRED.
 *
 * `everyone` returns `{}` deliberately and that is safe HERE, where it is the explicitly chosen
 * branch of a discriminated union — never something a caller reaches by clearing a field. The
 * contract refuses a `filter` with neither list, so the widening this returns is always one
 * somebody typed.
 *
 * The two lists are ANDed, which is the sentence a person means: «the drivers in Maadi and Giza»
 * is one department across two branches, not every driver plus everybody in those branches.
 */
export const scopeFilterOf = (
  scope: PerformanceCycleScope,
): { branchIds?: string[]; departmentIds?: string[] } => {
  if (scope.kind === 'everyone') return {};
  const filter: { branchIds?: string[]; departmentIds?: string[] } = {};
  if (scope.branchIds !== undefined) filter.branchIds = [...scope.branchIds];
  if (scope.departmentIds !== undefined) filter.departmentIds = [...scope.departmentIds];
  return filter;
};

/**
 * Whether a rating is a point on the cycle's scale (D8).
 *
 * Integers only, and the bound check is inclusive at both ends. The scale is the CYCLE's, so this
 * takes it as an argument rather than reading a constant — which is the whole reason the scale is
 * stored on the round instead of compiled in.
 *
 * P4 is what calls this. It lives here because it is a question about the scale, and the scale is
 * the cycle's; putting it beside the review would make the review the authority on a rule the
 * cycle owns.
 */
export const isOnScale = (rating: number, scale: { min: number; max: number }): boolean =>
  Number.isInteger(rating) && rating >= scale.min && rating <= scale.max;
