// Who an evaluation phase applies to — ONE answer, read by everyone who asks.
//
// THE QUESTION HAD THREE ANSWERS, which is a different problem from having the wrong one.
//
//   the materializer, which OPENS a phase:  `phase.applicability === 'driversOnly'`
//   the gate, which decides who has CLEARED: `phase.driversOnly`
//   the mapper, which shows it on screen:    `applicability === 'driversOnly' || driversOnly`
//
// `hasClearedRequiredEvaluations` leans on the opener — "a phase that was never opened was never
// theirs to pass" — and that reasoning is only sound while the gate and the opener answer the
// same question the same way. They did not. Should a phase ever carry `applicability:
// 'driversOnly'` with the legacy flag still `false`, the materializer would skip it for every
// non-driver while the gate demanded an approval that would never exist: nobody who is not a
// driver would ever clear their checks, and nobody would appear in the offers queue. The screen
// would show the phase as drivers-only throughout, because the mapper reads it a third way.
//
// TODAY THEY AGREE, and this changes no current behaviour. `newPhaseFields` writes both from one
// value, `update` keeps them in step, the seed states both, and the migration backfills the
// typed field from the flag. That is four places that must all keep agreeing forever — which is
// the argument for asking the question once, here, rather than the argument against it.
//
// The precedence is the migration's: the TYPED field wins where it exists, and the legacy boolean
// is consulted only for a document written before the field did.
import { type EvaluationApplicability } from '@ecms/contracts';

/** The shape of the answer, as it may be found on a document of any vintage. */
export interface PhaseApplicabilityFields {
  applicability?: EvaluationApplicability | undefined;
  driversOnly?: boolean | undefined;
}

/**
 * The phase's applicability, resolved.
 *
 * Returns the vocabulary rather than a boolean because `EVALUATION_APPLICABILITIES` is a closed
 * enum that a third value could join: a helper returning `true`/`false` would have to be found and
 * rewritten that day, and a `switch` on this will not compile until the new case is handled.
 */
export const applicabilityOf = (phase: PhaseApplicabilityFields): EvaluationApplicability =>
  phase.applicability ?? (phase.driversOnly === true ? 'driversOnly' : 'all');

/** Whether this phase is asked only of candidates whose seat requires a driving test. */
export const isDriversOnlyPhase = (phase: PhaseApplicabilityFields): boolean =>
  applicabilityOf(phase) === 'driversOnly';
