// Mechanical enforcement of two invariants the stage repositories cannot be trusted to remember.
//
// I13 — the workflow engine is the ONLY component that may move a record between states. `status`,
// `attempt` and the supersede/placement-snapshot markers are WORKFLOW-MANAGED: a stage service
// updating its own domain data (panel membership, files, offer terms, notes) never touches them,
// and if it tries the update throws, naming the engine method to use instead. The engine writes
// them through `applyTransition()`, which demands a token only it holds.
//
// I1 — a superseded attempt is read-only forever, whatever the fields. See below.
import { ErrorCodes } from '@ecms/contracts';
import { AppError, BusinessRuleError } from '../../../../shared/errors';

/** A bypass attempt is a PROGRAMMING error, not a business failure: 500, logged at error level. */
const bypassError = (message: string): AppError =>
  new AppError(ErrorCodes.INTERNAL, 500, message, { expected: false });

/**
 * Fields no stage service may write. `status` is the workflow's whole point; `attempt` and the
 * supersede markers belong to the return-to-stage mechanism (RW13/I12); the placement snapshot is
 * immutable history (RW4).
 */
export const WORKFLOW_MANAGED_FIELDS = [
  'status',
  'attempt',
  'supersededAt',
  'supersededBy',
  'supersededByReturnId',
  'placementSnapshot',
  'placementSnapshotLabel',
] as const;

/**
 * The engine's capability token. Deliberately NOT exported from the feature barrel: only modules
 * that import this file directly can obtain it, and the only one that does is the engine itself.
 * Repositories compare by identity, so a forged object cannot stand in for it.
 */
export const WORKFLOW_ENGINE_TOKEN: unique symbol = Symbol('recruitment.workflow.engine');
export type WorkflowEngineToken = typeof WORKFLOW_ENGINE_TOKEN;

/**
 * Run by every stage repository's ordinary update seam. Throws when a caller tries to set a
 * workflow-managed field, so bypassing the engine fails loudly in development and in tests rather
 * than silently corrupting the pipeline in production.
 */
export const assertNotWorkflowManaged = (patch: object, entity: string): void => {
  const offending = Object.keys(patch).filter((key) =>
    (WORKFLOW_MANAGED_FIELDS as readonly string[]).includes(key),
  );
  if (offending.length > 0) {
    throw bypassError(
      `${entity}: ${offending.join(', ')} ${offending.length === 1 ? 'is' : 'are'} owned by the ` +
        'recruitment workflow engine (I13) — call recruitmentWorkflowEngine.transition() instead ' +
        'of writing the status directly',
    );
  }
};

/** Guards `applyTransition()`: without the engine's own token the write is refused. */
export const assertEngineToken = (token: unknown, entity: string): void => {
  if (token !== WORKFLOW_ENGINE_TOKEN) {
    throw bypassError(
      `${entity}: applyTransition() may only be called by the recruitment workflow engine (I13)`,
    );
  }
};

// ── A retired attempt is read-only, forever (I1) ────────────────────────────
//
// I13 above stops a stage service writing the WRONG FIELDS. I1 is the other half: once a return to
// an earlier stage has superseded an attempt, that record is history, and history is not edited —
// not its panel, not its files, not its notes, not its terms. Without this, an id from the timeline
// or a stale browser tab was enough to write into a retired round.
//
// Exactly two writers still reach a superseded row, and I1 names both:
//   • the supersede marker itself, written by `recruitmentWorkflowEngine.supersede()` straight at
//     the model — the one write a retired attempt will ever receive;
//   • the denormalized SCOPE field, synced across a candidate's whole history by a reassignment
//     (RW2) through `updateMany`, so a branch-scoped user keeps seeing the records they already
//     could. That is a scoping mirror, not domain data, and I1 lists it as such.
// Neither goes through the `updateById` seam, which is what makes this guard total for everything
// that does.

/** The condition every stage repository adds to its writes: a retired attempt matches nothing. */
export const LIVE_ATTEMPT_ONLY = { supersededAt: null } as const;

/**
 * Why the write matched nothing. A user CAN arrive here honestly — a deep link into an old round,
 * a tab opened before the return happened — so this is a business-rule refusal (422), the same
 * answer and the same wording the engine already gives for a transition on a retired attempt.
 */
export const assertNotSuperseded = (current: { supersededAt: Date | null }, entity: string): void => {
  if (current.supersededAt !== null) {
    throw new BusinessRuleError(
      `${entity}: this attempt was superseded by a return to an earlier stage and is read-only (I1)`,
    );
  }
};
