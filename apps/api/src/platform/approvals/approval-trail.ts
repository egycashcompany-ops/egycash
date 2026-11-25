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

/**
 * Where a request stands as a whole.
 *
 * `unstaffed` and `noChain` are answers of their own, never `approved` (ADR-041 decision 2): a
 * request nobody can decide, or one no chain applies to, is a fact the host acts on with its own
 * policy, and an engine that folded either into «approved» would approve it for every host that
 * read the word.
 */
export type ChainStatus = 'pending' | 'approved' | 'rejected' | 'unstaffed' | 'noChain';

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
 *
 * Approved only when every rung is settled. «Nothing is waiting» has two readings, and only one of
 * them is a finished chain: the other is rungs left that nobody holds, which is `unstaffed` — the
 * request is stuck, not done, and only an override within reach moves it.
 */
export const statusOf = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
): ChainStatus => {
  if (decisions.some((entry) => entry.outcome === 'rejected')) return 'rejected';
  if (steps.length === 0) return 'noChain';
  const progress = progressOf(decisions);
  if (liveStep(steps, progress) !== null) return 'pending';
  return progress >= steps.length ? 'approved' : 'unstaffed';
};

/**
 * The rung a decision on this request settles now, or null when there is none to settle.
 *
 * On a `pending` chain it is the waiting rung. On an `unstaffed` one it is the first unsettled
 * rung, which only an override can decide: the rungs above it are not its to pass, because each
 * one asks for its own level, and an override that settled several at once would settle rungs it
 * may not reach (ADR-041 decision 3).
 */
export const rungToDecide = (
  steps: readonly ResolvedStep[],
  decisions: readonly DecidedEntry[],
): number | null => {
  const status = statusOf(steps, decisions);
  if (status === 'pending') return liveStep(steps, progressOf(decisions))?.index ?? null;
  return status === 'unstaffed' ? progressOf(decisions) : null;
};

/**
 * The entries one decision writes — its own rung, and every rung between.
 *
 * The in-between rungs are not silently dropped: each is written with the reason it was passed,
 * which is `skipped` when nobody could have stood on it and `covered` when somebody could have and
 * a superior answered first. Telling those two apart is the difference between «مفيش مدير فرع» and
 * «المدير العام وافق قبله», and a reader who cannot tell them apart cannot audit either.
 *
 * Nothing ABOVE the decided rung is written, whatever the decision. An empty rung is passed only on
 * the way to a staffed one that decides — «يتخطى المستوى ده ويروح للـGeneral Department Manager» —
 * so an approval that leaves only empty rungs above it leaves the chain `unstaffed`, waiting for an
 * override, instead of finishing it over rungs nobody reached (ADR-041 decision 2).
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
  return written;
};

/**
 * Which rung this reader would decide, and what it would cancel — or null when none is his.
 *
 * `ownSteps` are the rungs whose key and level he actually satisfies, resolved live against roles
 * and delegations by the caller. Someone who satisfies a rung ABOVE the one that is waiting may
 * still decide, and cancels what is below him: «لو المدير العام وافق مش محتاج مدير الفرع». What
 * comes after him is untouched.
 *
 * Null for everybody unless the chain is `pending`. On an `unstaffed` chain nobody stands on a
 * rung that is left, so the one way forward is an override, which is not a decision of one's own.
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
