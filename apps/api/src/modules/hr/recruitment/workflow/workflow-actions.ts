// What the caller may do next (I6) — PURE, like the rulebook and the event catalog beside it.
//
// `WorkflowStateDto.availableActions` is where capability lives and nowhere else (I10): there is no
// `placementEditable` boolean and no `canDecide` flag, because a second representation of "may I?"
// is a second thing that can disagree with the rulebook. An action is available when the rulebook
// declares the move AND the caller holds the permission the route enforces — the same permission,
// read from one table, so the button the UI renders and the gate the request meets cannot drift.
import { type WorkflowActionDto } from '@ecms/contracts';
import {
  transitionsFrom,
  WORKFLOW_TRANSITIONS,
  type TransitionDef,
  type WorkflowObject,
  type WorkflowStatus,
} from './workflow-transitions';

/**
 * The permission each business action demands, per object. These MIRROR the `authorize(...)` calls
 * on the routes; `workflow-actions.spec.ts` pins every entry against the rulebook so a transition
 * added without naming its permission fails the test run rather than shipping an ungated button.
 */
const ACTION_PERMISSIONS: Record<WorkflowObject, Record<string, string>> = {
  applicant: {
    hire: 'employee.create',
    reject: 'applicant.edit',
    withdraw: 'applicant.edit',
    reactivate: 'applicant.edit',
    restore: 'applicant.edit',
  },
  screening: {
    accept: 'screening.decide',
    reject: 'screening.decide',
    redecide: 'screening.decide',
    // A lifecycle exit closes the record; nobody "does" it from a screening screen.
    close: 'applicant.edit',
  },
  interview: {
    schedule: 'interview.create',
    start: 'interview.create',
    decide: 'interview.decide',
    redecide: 'interview.decide',
    cancel: 'interview.cancel',
  },
  evaluation: {
    approve: 'evaluation.manage',
    reject: 'evaluation.manage',
    redecide: 'evaluation.manage',
    reopen: 'evaluation.manage',
    close: 'applicant.edit',
  },
  offer: {
    draft: 'jobOffer.create',
    send: 'jobOffer.send',
    accept: 'jobOffer.respond',
    reject: 'jobOffer.respond',
    withdraw: 'jobOffer.withdraw',
    // Set by a return-to-stage, never chosen directly.
    supersede: 'applicant.returnToStage',
    // The scheduled sweep expires an offer; no human action exists for it.
    expire: 'jobOffer.send',
  },
};

/** The permission an action demands, or null when the object/action pair is not declared. */
export const permissionForAction = (object: WorkflowObject, action: string): string | null =>
  ACTION_PERMISSIONS[object][action] ?? null;

/** Every action the rulebook declares must name its permission — asserted by the unit tests. */
export const unmappedActions = (): string[] => {
  const missing: string[] = [];
  for (const object of Object.keys(WORKFLOW_TRANSITIONS) as WorkflowObject[]) {
    for (const t of WORKFLOW_TRANSITIONS[object]) {
      if (permissionForAction(object, t.action) === null) missing.push(`${object}:${t.action}`);
    }
  }
  return [...new Set(missing)];
};

/**
 * The actions available from a state, in rulebook order. An action the caller cannot perform is
 * still LISTED, with `enabled: false` and the permission it needs as the reason — a UI that hides
 * what it cannot explain teaches the user nothing, and the frontend needs the same list either way.
 *
 * `extra` carries the moves that are not stage transitions (reassignment, return-to-stage), so the
 * client asks one place what it may do rather than assembling capability from several.
 */
export const availableActions = (
  object: WorkflowObject,
  from: WorkflowStatus,
  permissions: Record<string, string>,
  extra: { key: string; permission: string; enabled: boolean; reason: string | null }[] = [],
): WorkflowActionDto[] => {
  const held = (permission: string): boolean => permissions[permission] !== undefined;
  const fromTransitions = transitionsFrom(object, from).map((t: TransitionDef) => {
    const permission = permissionForAction(object, t.action) ?? 'applicant.edit';
    return {
      key: t.action,
      permission,
      enabled: held(permission),
      reason: held(permission) ? null : `requires ${permission}`,
    };
  });
  // A status can declare the same action twice (two `redecide` edges); the caller wants one button.
  const seen = new Set<string>();
  const deduped = fromTransitions.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
  return [...deduped, ...extra.filter((a) => !seen.has(a.key))];
};
