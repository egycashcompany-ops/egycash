// Mechanical enforcement of I13: the workflow engine is the ONLY component that may move a
// record between states. Not a convention a future module could forget — a guard the stage
// repositories run on every update, plus a token only the engine holds.
//
// The rule: `status`, `attempt` and the supersede/placement-snapshot markers are WORKFLOW-MANAGED.
// A stage service updating its own domain data (panel membership, files, offer terms, notes) never
// touches them; if it tries, the update throws with a message naming the engine method to use
// instead. The engine writes them through `applyTransition()`, which demands the token.
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';

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
