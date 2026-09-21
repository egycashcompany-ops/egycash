// What a chain has become so far, and what one decision does to it — all of it pure.
//
// The host module (leave requests, regularizations, requisitions) stores a list of `DecidedEntry`
// and nothing else. It does not store a status, a «current step», or a next approver: all three are
// READ BACK from the entries against the chain, every time, because all three go stale. A stored
// `pendingHr` is a claim about the org chart, and the org chart changes without asking the request.
//
// Two facts are recorded that a naive engine would throw away, and both are here because an auditor
// asks about them by name:
//
//   • A rung nobody stood on is still written down, with WHY nobody stood on it — empty, cancelled
//     from above, or never reached because the request died lower down. A trail that simply omits
//     the rung answers none of the three questions, and «لماذا راح الطلب للموارد البشرية مباشرة؟»
//     is exactly the question a reader brings to it.
//   • The chain is written from `progress` forward in one go, so the entries are contiguous from
//     rung 0. A gap in the list would make every later read guess, and two readers would guess
//     differently.
import {
  type ApprovalOutcome,
  type ApprovalDecision,
  type ApprovalTrailEntryDto,
} from '@ecms/contracts';
import { decisionFor, liveStep, type ResolvedStep } from './approval-chain';

/** One rung's fate, as the host module stores it. */
export interface DecidedEntry {
  stepIndex: number;
  /** Never `pending`: an entry exists only once the rung's fate is settled. */
  outcome: Exclude<ApprovalOutcome, 'pending'>;
  /** Null for every outcome nobody stood on — skipped, covered, unreached. */
  deciderUserId: string | null;
  decidedAt: Date;
  comment: string | null;
  /** The permission used to step into a chain the decider was not on. Null otherwise. */
  overriddenWith: string | null;
}

/** Where a request stands as a whole. */
export type ChainStatus = 'pending' | 'approved' | 'rejected';

/**
 * How far the chain has been settled — the first rung with no entry.
 *
 * Read as «one past the highest settled rung» rather than «how many entries», so a list that a
 * migration left with a gap still moves forward instead of re-asking a rung somebody already
 * answered.
 */
export const progressOf = (decisions: readonly DecidedEntry[]): number =>
  decisions.reduce((max, entry) => Math.max(max, entry.stepIndex + 1), 0);

/**
 * Where the request stands.
 *
 * Rejected the moment any rung rejects, and that is final: no rung above may overturn it here.
 * Overturning a rejection is a different act with a different name — the requester files again, or
 * somebody with `approval.override` decides explicitly and is recorded doing it — and folding it
 * into "the next approver said yes" would make a rejection something a chain quietly forgets.
 */
export const statusOf = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
): ChainStatus => {
  if (decisions.some((entry) => entry.outcome === 'rejected')) return 'rejected';
  return liveStep(steps, progressOf(decisions)) === null ? 'approved' : 'pending';
};

/**
 * The entries one decision writes — its own rung, and every rung between.
 *
 * The in-between rungs are not silently dropped: each is written with the reason it was passed,
 * which is `skipped` when nobody could have stood on it and `covered` when somebody could have and
 * a superior answered first. Telling those two apart is the difference between «مفيش مدير فرع» and
 * «المدير العام وافق قبله», and a reader who cannot tell them apart cannot audit either.
 *
 * Returns the entries to APPEND, in rung order. The caller concatenates; nothing here mutates.
 */
export const entriesForDecision = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
  at: {
    stepIndex: number;
    decision: ApprovalDecision;
    deciderUserId: string;
    comment: string | null;
    overriddenWith: string | null;
  },
  now: Date,
): DecidedEntry[] => {
  const passed = (index: number): DecidedEntry => ({
    stepIndex: index,
    outcome: steps[index]?.staffed === true ? 'covered' : 'skipped',
    deciderUserId: null,
    decidedAt: now,
    comment: null,
    overriddenWith: null,
  });

  const written: DecidedEntry[] = [];
  for (let i = progressOf(decisions); i < at.stepIndex; i += 1) written.push(passed(i));
  written.push({
    stepIndex: at.stepIndex,
    outcome: at.decision,
    deciderUserId: at.deciderUserId,
    decidedAt: now,
    comment: at.comment,
    overriddenWith: at.overriddenWith,
  });

  // An approval that finishes the chain closes the rungs above it too, all of them unstaffed by
  // the definition of «no live rung left». Writing them now rather than leaving them blank is what
  // makes a finished trail readable a year later, when the rung may have somebody in it again and
  // an empty row would look like an oversight.
  if (at.decision === 'approved') {
    const after = [...decisions, ...written];
    if (liveStep(steps, progressOf(after)) === null) {
      for (let i = at.stepIndex + 1; i < steps.length; i += 1) {
        written.push({
          stepIndex: i,
          outcome: 'skipped',
          deciderUserId: null,
          decidedAt: now,
          comment: null,
          overriddenWith: null,
        });
      }
    }
  }
  return written;
};

/**
 * Which rung this reader would decide, and what it would cancel — or null when none is his.
 *
 * `ownSteps` are the rungs whose key and level he actually satisfies, resolved live against roles
 * and delegations by the caller. Someone who satisfies a rung ABOVE the one that is waiting may
 * still decide, and cancels what is below him: «لو المدير العام وافق مش محتاج مدير الفرع». What
 * comes after him is untouched.
 */
export const viewerDecision = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
  ownSteps: readonly number[],
): { step: number; covers: number[] } | null => {
  if (statusOf(steps, decisions) !== 'pending') return null;
  const live = liveStep(steps, progressOf(decisions));
  if (live === null) return null;
  return decisionFor(ownSteps, live.index);
};

/**
 * The trail as a reader sees it: one row per rung of the chain, in order, none omitted.
 *
 * A rung with no entry yet is `pending` whatever its position, EXCEPT after a rejection, where it
 * is `unreached` — staffed, willing, and simply never asked. Reporting those as `pending` would
 * leave a dead request looking like it was still waiting on somebody.
 */
export const buildTrail = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
  nameOf: (userId: string) => { id: string; name: string } | null,
): ApprovalTrailEntryDto[] => {
  const byIndex = new Map(decisions.map((entry) => [entry.stepIndex, entry]));
  const rejected = statusOf(steps, decisions) === 'rejected';
  return steps.map((step, index) => {
    const entry = byIndex.get(index);
    const outcome: ApprovalOutcome =
      entry?.outcome ?? (rejected ? 'unreached' : 'pending');
    return {
      permissionKey: step.permissionKey,
      level: step.level,
      label: step.label,
      outcome,
      decidedBy: entry?.deciderUserId != null ? nameOf(entry.deciderUserId) : null,
      decidedAt: entry?.decidedAt.toISOString() ?? null,
      comment: entry?.comment ?? null,
      overriddenWith: entry?.overriddenWith ?? null,
    };
  });
};
