// Shipment assignment and execution ORDER — the layer the captain-mobile slice will read.
//
// TWO LEGS, NOT ONE GENERIC ASSIGNMENT (discovery §4.1, preserved):
//   · `pickup`   = legacy leader1 + car_num1. Exists on BOTH shipment types — legacy writes the
//                  pair at creation for يومي (contad_app.js:330/336) and for محصنة (:725/:733).
//                  Anchored on the shipment's COLLECTION date.
//   · `delivery` = legacy leader2 + car_num2. Secured only, written by /tash4ela_mohasana (:4491),
//                  anchored on the DELIVERY date. Owned by the secured service (OP-4).
// The legacy captain report is the proof the split is real: its daily facet groups by leader1 and
// its secured facet by leader2 (:4894/:4931). Collapsing them would silently merge two different
// crews' work under one name.
//
// SPECIALISTS ARE NEVER COPIED HERE. An assignment references `crewAssignmentId`; the أخصائي pair
// lives on that (day, vehicle) row and is resolved through it — exactly the legacy indirection,
// where the shipment carried only the leader and the tashghela row carried the crew.
//
// ORDER, NOT EXECUTION. `sequence` is a plan position. Execution state and the
// "N+1 cannot start before N completes" lock are the captain-execution slice's concern; this
// service deliberately knows nothing about them, which is what lets Operations replan freely.
import {
  OperationsEvents,
  type AssignShipmentPickupLeg,
  type OperationsCaptainRouteDto,
  type OperationsRouteStopDto,
  type OperationsRouteStopLocationDto,
  type OperationsShipmentLeg,
  type ReorderCaptainShipments,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';
import { type OperationsCrewAssignmentDoc } from '../crew/crew-assignment.model';
import { isCaptainOf, slotIds } from '../crew/crew-slots';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipmentAssignment',
  entityId: id,
});

const snapshot = (doc: OperationsShipmentAssignmentDoc) => ({
  leg: doc.leg,
  captainEmployeeId: String(doc.captainEmployeeId),
  vehicleId: String(doc.vehicleId),
  crewAssignmentId: String(doc.crewAssignmentId),
  sequence: doc.sequence,
});

/**
 * Resolve the crew row a leg must ride, and prove it is the right one.
 *
 * The three checks are the ones the legacy screens made structurally (they only ever showed a
 * given day's tashghela rows beside that day's shipments) and never enforced on the server.
 */
const resolveCrew = async (
  crewAssignmentId: string,
  captainEmployeeId: string,
  legDate: Date,
): Promise<{ crew: OperationsCrewAssignmentDoc; operationsDayId: Types.ObjectId }> => {
  const crew = await operationsCrewAssignmentRepository.findById(crewAssignmentId);
  if (crew === null) throw new NotFoundError('crew assignment not found');

  const day = await operationsDayService.findByDate(legDate);
  if (day === null || String(crew.operationsDayId) !== String(day._id)) {
    throw new BusinessRuleError(
      "the crew assignment is not on this leg's operating day",
      'OPERATIONS_CREW_DAY_MISMATCH',
    );
  }
  // A crew may carry two captains and EITHER may take a leg — the gate is membership, not
  // equality. What it still refuses is a captain who is not on that row at all, which is the check
  // the legacy screens made structurally and never enforced.
  if (!isCaptainOf(crew, captainEmployeeId)) {
    throw new BusinessRuleError(
      'the captain is not a captain of that crew assignment',
      'OPERATIONS_CREW_CAPTAIN_MISMATCH',
    );
  }
  return { crew, operationsDayId: crew.operationsDayId };
};

/** Next free position at the end of this captain-day-leg's list. */
const nextSequence = async (
  operationsDayId: Types.ObjectId,
  captainEmployeeId: string,
  leg: OperationsShipmentLeg,
  session?: ClientSession,
): Promise<number> => {
  const existing = await operationsShipmentAssignmentRepository.findForCaptainDay(
    operationsDayId,
    captainEmployeeId,
    leg,
    session,
  );
  return existing.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
};

class OperationsAssignmentService {
  /**
   * Assign (or re-assign) the collection leg — the legacy leader1 + car_num1 pair. Never touches
   * shipment status: legacy set the pair at creation and status moved on its own schedule.
   */
  async assignPickupLeg(
    shipmentId: string,
    input: AssignShipmentPickupLeg,
    by: string,
  ): Promise<OperationsShipmentAssignmentDoc> {
    const shipment = await operationsShipmentRepository.getById(shipmentId);
    const { crew, operationsDayId } = await resolveCrew(
      input.crewAssignmentId,
      input.captainEmployeeId,
      shipment.collectionDate,
    );

    const existing = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      shipmentId,
      'pickup',
    );
    const set = {
      captainEmployeeId: new Types.ObjectId(input.captainEmployeeId),
      vehicleId: crew.vehicleId,
      crewAssignmentId: crew._id,
      operationsDayId,
    };

    let doc: OperationsShipmentAssignmentDoc;
    if (existing === null) {
      doc = await operationsShipmentAssignmentRepository.create(
        {
          shipmentId: new Types.ObjectId(shipmentId),
          leg: 'pickup',
          ...set,
          sequence: await nextSequence(operationsDayId, input.captainEmployeeId, 'pickup'),
        },
        { by },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(doc)),
      });
    } else {
      // Moving a stop to a different captain puts it at the END of the new captain's list; its old
      // position is simply vacated. Renumbering the loser's list is a reorder, not a side effect.
      const movingCaptain = String(existing.captainEmployeeId) !== input.captainEmployeeId;
      doc = await operationsShipmentAssignmentRepository.updateById(
        String(existing._id),
        movingCaptain
          ? {
              ...set,
              sequence: await nextSequence(operationsDayId, input.captainEmployeeId, 'pickup'),
            }
          : set,
        { by, version: input.version },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'update',
        changes: diffChanges(snapshot(existing), snapshot(doc)),
      });
    }

    await emit(OperationsEvents.SecuredLegAssigned, {
      assignmentId: String(doc._id),
      shipmentId,
      leg: doc.leg,
      captainEmployeeId: String(doc.captainEmployeeId),
      vehicleId: String(doc.vehicleId),
    });
    return doc;
  }

  /**
   * Replace one captain-day-leg's execution order, atomically.
   *
   * The fleet-roster reorder contract, applied to a list: the payload is the COMPLETE desired
   * order, every write is version-checked against what the client held, all writes share one
   * transaction, and audit + events fire only after it commits.
   *
   * Positions come from the array index, so duplicate positions cannot be expressed. What must be
   * checked is the SET: every one of the captain's stops has to be present, or a reorder would
   * silently strand the omitted ones at stale positions.
   */
  async reorder(
    input: ReorderCaptainShipments,
    by: string,
  ): Promise<{ reordered: number; operationsDayId: string }> {
    const day = await operationsDayService.findByDate(utcDay(input.date));
    if (day === null) throw new NotFoundError('no operating day for that date');

    const current = await operationsShipmentAssignmentRepository.findForCaptainDay(
      day._id,
      input.captainEmployeeId,
      input.leg,
    );
    if (current.length === 0) {
      throw new NotFoundError('this captain has no assignments on that day');
    }

    const currentIds = new Set(current.map((row) => String(row._id)));
    for (const entry of input.order) {
      if (!currentIds.has(entry.assignmentId)) {
        throw new BusinessRuleError(
          `assignment ${entry.assignmentId} does not belong to this captain's day and leg`,
          'OPERATIONS_ASSIGNMENT_NOT_IN_SET',
        );
      }
    }
    // Completeness — the guard against work quietly disappearing from the plan.
    if (input.order.length !== current.length) {
      throw new BusinessRuleError(
        `the order must list all ${String(current.length)} assignments (got ${String(input.order.length)})`,
        'OPERATIONS_INCOMPLETE_ORDER',
      );
    }

    const byId = new Map(current.map((row) => [String(row._id), row]));
    const outcome = await unitOfWork(async (session) => {
      // Two-phase inside the transaction: park every row on a negative position first, so a swap
      // cannot transiently collide on ux_day_captain_leg_sequence, then write the final ones.
      // The unique index is what makes the parking necessary AND what makes it safe.
      let parked = 0;
      for (const entry of input.order) {
        const row = byId.get(entry.assignmentId);
        if (row === undefined) continue;
        parked += 1;
        await operationsShipmentAssignmentRepository.parkSequence(
          String(row._id),
          -parked,
          session,
        );
      }

      const changed: { id: string; before: number; after: number }[] = [];
      for (const [index, entry] of input.order.entries()) {
        const row = byId.get(entry.assignmentId);
        if (row === undefined) continue;
        const position = index + 1;
        // The client's version, not the parked row's — a concurrent editor still loses here.
        await operationsShipmentAssignmentRepository.updateById(
          String(row._id),
          { sequence: position },
          { by, version: entry.version, session },
        );
        if (row.sequence !== position) {
          changed.push({ id: String(row._id), before: row.sequence, after: position });
        }
      }
      return changed;
    });

    for (const change of outcome) {
      await auditService.record({
        entityRef: entityRef(change.id),
        action: 'update',
        changes: diffChanges({ sequence: change.before }, { sequence: change.after }),
      });
    }
    await emit(OperationsEvents.ShipmentOrderReordered, {
      operationsDayId: String(day._id),
      captainEmployeeId: input.captainEmployeeId,
      leg: input.leg,
      count: outcome.length,
    });
    return { reordered: outcome.length, operationsDayId: String(day._id) };
  }

  /**
   * The captain's ordered route for a day — the read the mobile slice will consume.
   *
   * Locations come from the branch reference data's OPTIONAL `location` (design §17.4): there is no
   * second location system here, and `coordinates` stays null until somebody backfills it.
   */
  async captainRoute(
    date: Date,
    captainEmployeeId: string,
    leg: OperationsShipmentLeg | undefined,
  ): Promise<OperationsCaptainRouteDto> {
    const day = utcDay(date);
    const dayDoc = await operationsDayService.findByDate(day);
    if (dayDoc === null) {
      return {
        date: day.toISOString(),
        operationsDayId: null,
        captainEmployeeId,
        crew: [],
        stops: [],
      };
    }

    const legs: OperationsShipmentLeg[] = leg === undefined ? ['pickup', 'delivery'] : [leg];
    const rows: OperationsShipmentAssignmentDoc[] = [];
    for (const one of legs) {
      rows.push(
        ...(await operationsShipmentAssignmentRepository.findForCaptainDay(
          dayDoc._id,
          captainEmployeeId,
          one,
        )),
      );
    }
    rows.sort((a, b) => a.sequence - b.sequence);

    const stopLocation = async (branchId: Types.ObjectId): Promise<OperationsRouteStopLocationDto> => {
      const branch = await operationsBankBranchRepository.findById(String(branchId));
      const bank =
        branch === null ? null : await operationsBankRepository.findById(String(branch.bankId));
      return {
        branchId: String(branchId),
        branchName: branch?.name ?? '',
        branchCode: branch?.code ?? '',
        bankName: bank?.opsName ?? '',
        areaName: branch?.opsAreaName ?? null,
        location: branch?.location ?? null,
      };
    };

    const stops: OperationsRouteStopDto[] = [];
    const crewIds = new Set<string>();
    for (const row of rows) {
      const shipment = await operationsShipmentRepository.findById(String(row.shipmentId));
      if (shipment === null) continue;
      crewIds.add(String(row.crewAssignmentId));
      stops.push({
        assignmentId: String(row._id),
        shipmentId: String(row.shipmentId),
        sequence: row.sequence,
        leg: row.leg,
        shipmentType: shipment.shipmentType,
        status: shipment.status,
        pickup: await stopLocation(shipment.originBranchId),
        delivery: await stopLocation(shipment.destinationBranchId),
        vehicleId: String(row.vehicleId),
        crewAssignmentId: String(row.crewAssignmentId),
      });
    }

    // The crew — resolved THROUGH the (day, vehicle) rows, never copied onto a shipment.
    const crew: OperationsCaptainRouteDto['crew'] = [];
    for (const crewAssignmentId of crewIds) {
      const row = await operationsCrewAssignmentRepository.findById(crewAssignmentId);
      if (row === null) continue;
      crew.push({
        crewAssignmentId,
        vehicleId: String(row.vehicleId),
        specialist1EmployeeIds: slotIds(row.specialist1EmployeeIds),
        specialist2EmployeeIds: slotIds(row.specialist2EmployeeIds),
      });
    }

    return {
      date: day.toISOString(),
      operationsDayId: String(dayDoc._id),
      captainEmployeeId,
      crew,
      stops,
    };
  }
}

export const operationsAssignmentService = new OperationsAssignmentService();
