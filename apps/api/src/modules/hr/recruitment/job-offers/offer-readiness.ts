// Who is standing at the end of the checks with nothing left to pass.
//
// The pipeline's evaluation phases are INDEPENDENT of each other (the materializer says so: "phases
// are independent; the offer is HR's call"), so "they passed the medical" is not by itself a
// position in the pipeline — it is one of several answers, and the useful question is whether ALL
// the ones that apply to this person have come back approved.
//
// Asking it that way is also the safer reading of «بعد ما يتقبل فى الطبي»: a driver who cleared the
// medical but failed the security check has not finished the checks, and putting them in front of
// somebody about to write an offer would be inviting a mistake nobody meant to make.
//
// Pure, because every line of it is a rule rather than a lookup.

/** The half of a phase row these rules need. */
export interface PhaseFacts {
  id: string;
  applicability: 'all' | 'driversOnly';
  active: boolean;
}

/**
 * The phases THIS candidate has to clear.
 *
 * Driver-ness comes from the seat, exactly as it does everywhere else this question is asked — the
 * job title's `requiresDrivingTest`, never what the candidate typed into their form.
 */
export const phasesFor = (phases: readonly PhaseFacts[], isDriver: boolean): PhaseFacts[] =>
  phases.filter((phase) => phase.active && (phase.applicability === 'all' || isDriver));

/**
 * Has this candidate finished every check that applies to them?
 *
 * A candidate with NO applicable phases is not "finished" — they are a candidate nobody has asked
 * anything of yet, and treating an empty requirement as satisfied would put people in front of a
 * recruiter purely because the phase catalogue happened to be empty.
 */
export const clearedAllChecks = (
  applicable: readonly PhaseFacts[],
  approvedPhaseIds: ReadonlySet<string>,
): boolean =>
  applicable.length > 0 && applicable.every((phase) => approvedPhaseIds.has(phase.id));
