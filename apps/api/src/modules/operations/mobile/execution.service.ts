// Captain execution — a NEW ECMS capability with NO legacy counterpart.
//
// The legacy system had no captain surface, so nothing here is legacy parity: captain-driven
// execution, the sequential lock, pickup/delivery confirmation from a phone and server-enforced
// progression are all new. What IS legacy-derived is everything underneath — the shipment, its
// two legs, the (day, vehicle) crew row and the persisted `sequence` — and none of it is changed
// by this slice.
//
// ── THE AUTHORITY BOUNDARY ─────────────────────────────────────────────────────────────────────
// The SERVER decides what is actionable. The client sends an act on a stop and is told what
// happened; it never computes the lock, never proposes an order, never names a captain. That is
// why every method below takes a `userId` (from the token) and an `assignmentId`, and nothing else
// that could carry identity or ordering.
//
// ── TWO LIFECYCLES, NEVER WRITTEN FROM ONE ANOTHER ─────────────────────────────────────────────
// Shipment BUSINESS status (`draft/inVault/dispatched/completed`) is the back office's ladder,
// legacy-derived, moved with `operationsShipment.complete`. Captain EXECUTION status
// (`pending→active→pickedUp→delivered→completed`) is how far the captain got on ONE leg, moved
// with `operationsExecution.own`. Completing execution does NOT complete the shipment, deliberately:
//   1. it would let a captain drive a back-office ladder he holds no permission for;
//   2. a secured shipment has TWO legs carried by two captains on two days — neither leg finishing
//      means the shipment is business-complete;
//   3. the business ladder has legacy reopen semantics (quirk Q30) that execution must not disturb.
// The one place the two meet is `isStopSettled`, and it is a READ: a shipment the back office has
// already completed leaves the captain nothing to do, so it stops blocking his route.
import {
  OperationsEvents,
  type OperationsExecutionBody,
  type OperationsExecutionResultDto,
  type OperationsExecutionStatus,
} from '@ecms/contracts';
import { type ClientSession } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { ErrorCodes } from '@ecms/contracts';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';
import {
  canExecute,
  executionTransition,
  isStopSettled,
  type OperationsExecutionAction,
} from './execution-state';
import { orderedCaptainRoute } from './route-order';
import { resolveSelfEmployee } from './mobile.service';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipmentAssignment',
  entityId: id,
});

/** An OP-5 row predates the field; it has plainly not been started. */
const statusOf = (row: OperationsShipmentAssignmentDoc): OperationsExecutionStatus =>
  row.executionStatus ?? 'pending';

const iso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : new Date(value).toISOString();

/**
 * Prove the caller may act on this stop — the identity chain of design §20-هـ, walked in full and
 * entirely from the token:
 *
 *   authenticated user → employee → captain assignment for the operating day → this stop
 *
 * Both of the last two links are checked, and they are not the same check. The stop naming him as
 * captain is not enough on its own: captaincy is the DAY'S CREW ROW, so if the plan was re-captained
 * out from under an already-assigned shipment, the crew row wins and the old captain is refused.
 * That is the approved constraint — "shipment assignment does not determine captaincy" — enforced
 * rather than assumed.
 */
const authorizeStop = async (
  userId: string,
  assignmentId: string,
  session?: ClientSession,
): Promise<{ row: OperationsShipmentAssignmentDoc; captainEmployeeId: string }> => {
  const employee = await resolveSelfEmployee(userId);

  const row = await operationsShipmentAssignmentRepository.findById(assignmentId);
  if (row === null) throw new NotFoundError('assignment not found');

  // Another captain's stop — refused before anything about its state is revealed.
  if (String(row.captainEmployeeId) !== employee.employeeId) {
    throw new ForbiddenError('this stop belongs to another captain');
  }

  // ...and he must still be A CAPTAIN on that stop's operating day, on that stop's crew row. This
  // is also what rejects a wrong day / wrong vehicle / wrong crew: the crew row is (day, vehicle),
  // so a stop whose crew row he does not hold that day is not his to execute.
  const crewRows = await operationsCrewAssignmentRepository.findForCaptainDay(
    row.operationsDayId,
    employee.employeeId,
    session,
  );
  const holdsCrew = crewRows.some((crew) => String(crew._id) === String(row.crewAssignmentId));
  if (!holdsCrew) {
    throw new ForbiddenError('you are not the captain of this stop\'s crew assignment on that day');
  }

  return { row, captainEmployeeId: employee.employeeId };
};

class OperationsExecutionService {
  /**
   * Perform one transition. Every guard, in the order that gives the caller the truest reason:
   *
   *   1. authorization  — is this stop yours today?            → 403
   *   2. settled        — is there anything left to do?        → 422
   *   3. sequence       — may you START this one yet?          → 422   (start only, see below)
   *   4. transition     — is this act legal from here?         → 422
   *   5. compare-and-swap — did somebody beat you to it?       → 409
   *
   * WHY THE SEQUENCE GUARD IS ON `start` ALONE. The lock answers "which stop may the captain
   * BEGIN", and once he has begun one he must be able to finish it. Running it on every step would
   * mean a back-office reopen of an earlier shipment could strand a captain mid-stop, holding cash,
   * unable to complete — punishing him for someone else's action. Beginning is the only moment the
   * order can actually be violated, because a stop can only leave `pending` through `start`.
   */
  private async transition(
    action: OperationsExecutionAction,
    userId: string,
    assignmentId: string,
    input: OperationsExecutionBody,
    by: string,
  ): Promise<OperationsExecutionResultDto> {
    const { row, captainEmployeeId } = await authorizeStop(userId, assignmentId);
    const { from, to, stamps } = executionTransition(action);

    const outcome = await unitOfWork(async (session) => {
      const shipment = await operationsShipmentRepository.findById(String(row.shipmentId));
      if (shipment === null) throw new NotFoundError('shipment not found');

      const current = statusOf(row);
      if (isStopSettled(current, shipment.status)) {
        throw new BusinessRuleError(
          'this stop is already settled — there is nothing left to execute',
          ErrorCodes.OPERATIONS_EXECUTION_ALREADY_SETTLED,
        );
      }

      if (action === 'start') {
        await this.assertNothingUnfinishedBefore(row, captainEmployeeId, session);
      }

      if (!canExecute(action, current)) {
        throw new BusinessRuleError(
          `cannot ${action} a stop that is ${current} — ${action} requires ${from}`,
          ErrorCodes.OPERATIONS_INVALID_EXECUTION_TRANSITION,
        );
      }

      // THE atomic step. The expected state is in the filter, so of two racing callers exactly one
      // document matches and exactly one transition happens; the loser gets null, not a second win.
      const moved = await operationsShipmentAssignmentRepository.advanceExecution(
        assignmentId,
        from,
        { executionStatus: to, [stamps]: new Date() },
        { by, version: input.version, session },
      );
      if (moved === null) {
        throw new ConflictError(
          'this stop moved while you were acting on it — refetch your day and retry',
          ErrorCodes.OPERATIONS_EXECUTION_CONFLICT,
        );
      }
      return moved;
    });

    await auditService.record({
      entityRef: entityRef(assignmentId),
      action: 'update',
      changes: diffChanges({ executionStatus: from }, { executionStatus: to }),
    });
    await emit(EVENT_BY_ACTION[action], {
      assignmentId,
      shipmentId: String(outcome.shipmentId),
      operationsDayId: String(outcome.operationsDayId),
      captainEmployeeId,
      vehicleId: String(outcome.vehicleId),
      leg: outcome.leg,
      sequence: outcome.sequence,
      from,
      to,
    });

    return {
      assignmentId,
      shipmentId: String(outcome.shipmentId),
      leg: outcome.leg,
      sequence: outcome.sequence,
      from,
      executionStatus: statusOf(outcome),
      startedAt: iso(outcome.startedAt),
      pickedUpAt: iso(outcome.pickedUpAt),
      deliveredAt: iso(outcome.deliveredAt),
      completedAt: iso(outcome.completedAt),
      version: outcome.__v,
      currentAssignmentId: await this.currentAssignmentId(outcome, captainEmployeeId),
    };
  }

  /**
   * THE SEQUENTIAL INVARIANT. Every stop before this one on the captain's ordered day must be
   * settled. Order is PR 5's persisted `sequence`, read through the SAME helper the mobile day
   * read uses — there is no second ordering mechanism, and the lock cannot drift from the display.
   *
   * Note what makes this safe under concurrency without any lock of its own: "unlocked" is DERIVED,
   * never stored, so there is no unlock flag two requests could both flip. Two captains' requests
   * racing to start different future stops both evaluate this predicate against committed state and
   * both fail; only the genuine next stop can pass it.
   */
  private async assertNothingUnfinishedBefore(
    row: OperationsShipmentAssignmentDoc,
    captainEmployeeId: string,
    session: ClientSession,
  ): Promise<void> {
    const route = await orderedCaptainRoute(row.operationsDayId, captainEmployeeId, session);
    for (const prior of route) {
      if (String(prior._id) === String(row._id)) return; // reached this stop — everything before it passed
      const shipment = await operationsShipmentRepository.findById(String(prior.shipmentId));
      const settled =
        shipment === null ? true : isStopSettled(statusOf(prior), shipment.status);
      if (!settled) {
        throw new BusinessRuleError(
          `stop ${String(prior.sequence)} (${prior.leg}) is not finished — finish it before starting this one`,
          ErrorCodes.OPERATIONS_EXECUTION_OUT_OF_SEQUENCE,
        );
      }
    }
  }

  /** The stop that is actionable now — the same derivation the day read publishes. */
  private async currentAssignmentId(
    row: OperationsShipmentAssignmentDoc,
    captainEmployeeId: string,
  ): Promise<string | null> {
    const route = await orderedCaptainRoute(row.operationsDayId, captainEmployeeId);
    for (const stop of route) {
      const shipment = await operationsShipmentRepository.findById(String(stop.shipmentId));
      if (shipment === null) continue;
      if (!isStopSettled(statusOf(stop), shipment.status)) return String(stop._id);
    }
    return null;
  }

  async start(userId: string, id: string, input: OperationsExecutionBody, by: string) {
    return this.transition('start', userId, id, input, by);
  }

  async confirmPickup(userId: string, id: string, input: OperationsExecutionBody, by: string) {
    return this.transition('confirmPickup', userId, id, input, by);
  }

  async confirmDelivery(userId: string, id: string, input: OperationsExecutionBody, by: string) {
    return this.transition('confirmDelivery', userId, id, input, by);
  }

  async complete(userId: string, id: string, input: OperationsExecutionBody, by: string) {
    return this.transition('complete', userId, id, input, by);
  }
}

const EVENT_BY_ACTION: Readonly<Record<OperationsExecutionAction, string>> = {
  start: OperationsEvents.ExecutionStarted,
  confirmPickup: OperationsEvents.ExecutionPickupConfirmed,
  confirmDelivery: OperationsEvents.ExecutionDeliveryConfirmed,
  complete: OperationsEvents.ExecutionCompleted,
};

export const operationsExecutionService = new OperationsExecutionService();
