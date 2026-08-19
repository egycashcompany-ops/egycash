// The captain's execution state machine — a pure decision, testable without a database. Same
// precedent as `shipment-status.ts`, and deliberately in its own file for the same reason: the
// rule that matters most in this module should be readable without reading a service.
//
// NEW ECMS CAPABILITY. There is NO legacy counterpart to any of this — the legacy system had no
// captain execution at all, so nothing below is measured against legacy behaviour. The status
// vocabulary itself was declared in OP-1 (`OPERATIONS_EXECUTION_STATUSES`); this slice gives it
// its transitions rather than inventing a second one.
//
// ── THE MACHINE ────────────────────────────────────────────────────────────────────────────────
//
//   pending ──start──▶ active ──confirmPickup──▶ pickedUp ──confirmDelivery──▶ delivered
//                                                                                  │
//                                                                             complete
//                                                                                  ▼
//                                                                             completed  (terminal)
//
// Every action has exactly ONE legal predecessor. That single fact is what makes the forbidden
// behaviours impossible rather than merely checked for:
//   · completing something never started  — `complete` only accepts `delivered`
//   · moving backward                     — no action names an earlier state as its target
//   · completing the same stop twice      — `completed` is nobody's `from`
//   · skipping a step within a stop       — there is no action from `pending` to `pickedUp`
//
// `cancelled` is part of the OP-1 vocabulary but has NO transition here on purpose: nothing in the
// approved scope cancels a stop, and inventing an abandonment path (who may, what happens to the
// cash, does it unlock the next stop) would be a business rule nobody asked for. It stays
// unreachable until that decision is made — and `isExecutionDone` already accounts for it so the
// day it gains a transition, the sequencing rule does not have to change.
import {
  type OperationsExecutionStatus,
  type OperationsShipmentStatus,
} from '@ecms/contracts';

export const OPERATIONS_EXECUTION_ACTIONS = [
  'start',
  'confirmPickup',
  'confirmDelivery',
  'complete',
] as const;
export type OperationsExecutionAction = (typeof OPERATIONS_EXECUTION_ACTIONS)[number];

interface Transition {
  readonly from: OperationsExecutionStatus;
  readonly to: OperationsExecutionStatus;
  /** The timestamp field this transition stamps — the execution trail, one field per step. */
  readonly stamps: 'startedAt' | 'pickedUpAt' | 'deliveredAt' | 'completedAt';
}

const TRANSITIONS: Readonly<Record<OperationsExecutionAction, Transition>> = {
  start: { from: 'pending', to: 'active', stamps: 'startedAt' },
  confirmPickup: { from: 'active', to: 'pickedUp', stamps: 'pickedUpAt' },
  confirmDelivery: { from: 'pickedUp', to: 'delivered', stamps: 'deliveredAt' },
  complete: { from: 'delivered', to: 'completed', stamps: 'completedAt' },
};

export const executionTransition = (action: OperationsExecutionAction): Transition =>
  TRANSITIONS[action];

/** True when `action` is legal from `from`. The whole legality question, in one place. */
export const canExecute = (
  action: OperationsExecutionAction,
  from: OperationsExecutionStatus,
): boolean => TRANSITIONS[action].from === from;

/** A stop the captain has finished with — nothing further is expected of him on it. */
export const isExecutionDone = (status: OperationsExecutionStatus): boolean =>
  status === 'completed' || status === 'cancelled';

/**
 * SETTLED — the single predicate behind both the sequential lock and the mobile read's `progress`.
 *
 * It deliberately answers to TWO lifecycles, and that is the one genuinely subtle decision in this
 * slice, so it is stated plainly:
 *
 *   · the captain's execution reached a terminal state, OR
 *   · the shipment's own BUSINESS status is already `completed`.
 *
 * The second clause exists because the back office can complete a shipment on its own authority
 * (`operationsShipment.complete`, the legacy receive toggle) without the captain touching it. If
 * that did not settle the stop, the shipment would sit `pending` in the captain's route forever and
 * every stop behind it would be locked behind a step nobody can perform — the route would deadlock
 * on a legitimate back-office action. Treating it as settled says the honest thing: there is
 * nothing left here for the captain to do.
 *
 * ONE predicate serves the read and the write on purpose. If the lock and the display could
 * disagree, a captain would be shown an unlocked stop the server then refuses to start.
 */
export const isStopSettled = (
  executionStatus: OperationsExecutionStatus,
  shipmentStatus: OperationsShipmentStatus,
): boolean => isExecutionDone(executionStatus) || shipmentStatus === 'completed';
