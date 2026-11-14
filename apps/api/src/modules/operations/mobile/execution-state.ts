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
  type OperationsShipmentLeg,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
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

/** The stop's side of the settled question — which leg it is, and how far the captain got on it. */
export interface StopSettlementFacts {
  leg: OperationsShipmentLeg;
  executionStatus: OperationsExecutionStatus;
}

/** The shipment's side — its type and its own BUSINESS status. */
export interface ShipmentSettlementFacts {
  shipmentType: OperationsShipmentType;
  status: OperationsShipmentStatus;
}

/**
 * SETTLED — the single predicate behind both the sequential lock and the mobile read's `progress`.
 *
 * It deliberately answers to TWO lifecycles, and that is the one genuinely subtle decision in this
 * slice, so it is stated plainly. A stop is settled when:
 *
 *   · the captain's execution reached a terminal state, OR
 *   · the shipment's own BUSINESS status is already `completed`, OR
 *   · (Round 13) it is the PICKUP leg of a SECURED shipment the vault already holds, and the
 *     captain never started it.
 *
 * The second clause exists because the back office can complete a shipment on its own authority
 * (`operationsShipment.complete`, the legacy receive toggle) without the captain touching it. If
 * that did not settle the stop, the shipment would sit `pending` in the captain's route forever and
 * every stop behind it would be locked behind a step nobody can perform — the route would deadlock
 * on a legitimate back-office action. Treating it as settled says the honest thing: there is
 * nothing left here for the captain to do.
 *
 * The third clause is the same reasoning for the vault. Round 13 — «واستلام الخزينه ممكن تستلم يكون
 * القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي» — lets the vault receive a
 * محصنة nobody recorded collecting. Once it has (the shipment is past `draft`), a pickup leg the
 * captain never STARTED asks him to fetch from the bank what is already in the vault: nothing is
 * left for him there, so it must not stand in front of his later stops. His leg is not rewritten —
 * it still says `pending`, which is the truth: he never went.
 *
 * A pickup leg he HAS started (`active`, `pickedUp`, `delivered`) is not settled by the vault: once
 * he has begun a stop he must be able to finish it (execution.service — the lock is on `start`
 * alone), and the usual path runs exactly that way — his ✓ at the bank, the vault's ✓, then his
 * «تم التسليم» at the vault's door and «تم». His ✓ on a shipment the vault already holds is his own
 * execution record only: the shipment's pickup record is written from a `draft` alone
 * (`recordCaptainPickup`), so the vault's direct receipt keeps saying «لم يتم الاستلام» for good.
 *
 * A cancelled receipt takes the shipment back to `draft`, and with it the third clause: the
 * shipment is collectable again, so his untouched pickup is his to do again — derived, never
 * stored, like everything here.
 *
 * ONE predicate serves the read and the write on purpose. If the lock and the display could
 * disagree, a captain would be shown an unlocked stop the server then refuses to start.
 */
export const isStopSettled = (
  stop: StopSettlementFacts,
  shipment: ShipmentSettlementFacts,
): boolean =>
  isExecutionDone(stop.executionStatus) ||
  shipment.status === 'completed' ||
  (stop.leg === 'pickup' &&
    shipment.shipmentType === 'secured' &&
    shipment.status !== 'draft' &&
    stop.executionStatus === 'pending');
