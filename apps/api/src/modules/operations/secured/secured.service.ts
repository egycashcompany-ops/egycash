// The secured (محصنة) workflow — the four legacy screens, ported.
//
//   /mohsana            → backlog()          the open secured backlog, NO date filter (:657)
//   /receive_mohsana    → receiveIntoVault() draft → inVault, custody taken (:1220)
//   /tash4ela_mohasana  → assignDeliveryLeg() writes leader2 + car_num2 ONLY, no status change (:4491)
//   /deliver_mohsana    → dispatch()         inVault → dispatched, custody released (:1737)
//   /main_ops receive   → completion lives on the shipment service (:564), unchanged by this slice
//
// The status ladder's MEANING is preserved exactly (legacy 0→2→3→1, non-ordinal, 1 terminal); only
// the encoding is normalized, and the legacy codes stay pinned in the contracts mapping.
//
// Custody never happens here: this service drives the Treasury PORT (../treasury-boundary.ts).
// Operations decides WHEN a shipment may move; the treasury decides what custody means.
import {
  OperationsEvents,
  type AssignSecuredDeliveryLeg,
  type DispatchSecuredShipments,
  type ListSecuredBacklogQuery,
  type Paginated,
  type ReceiveIntoVault,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { vaultCustody } from '../treasury-boundary';
import { operationsVaultCustodyService } from '../vault/vault-custody.service';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { operationsDayService, utcDay } from '../days/day.service';
import { canTransitionShipment } from '../shipments/shipment-status';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';
import { type OperationsShipmentDoc } from '../shipments/shipment.model';

const shipmentRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipment',
  entityId: id,
});

const assignmentRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipmentAssignment',
  entityId: id,
});

const assignmentSnapshot = (doc: OperationsShipmentAssignmentDoc) => ({
  leg: doc.leg,
  captainEmployeeId: String(doc.captainEmployeeId),
  vehicleId: String(doc.vehicleId),
  crewAssignmentId: String(doc.crewAssignmentId),
});

const assertSecured = (shipment: OperationsShipmentDoc): void => {
  if (shipment.shipmentType !== 'secured') {
    throw new BusinessRuleError(
      'this workflow applies to secured shipments only',
      'OPERATIONS_NOT_A_SECURED_SHIPMENT',
    );
  }
};

class OperationsSecuredService {
  /**
   * The `/mohsana` board: every secured shipment not yet completed, with NO date filter — legacy
   * `{type:"محصنة", status:{$ne:1}, deleted:0}` (contad_app.js:657). PRESERVED: the backlog is
   * "everything still open", which is why a shipment received weeks ago still shows here.
   */
  async backlog(query: ListSecuredBacklogQuery): Promise<Paginated<OperationsShipmentDoc>> {
    return operationsShipmentRepository.listShipments({
      filter: {
        shipmentType: 'secured',
        status: query.status === undefined ? { $ne: 'completed' } : { $in: query.status },
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  /**
   * The `/tash4ela_mohasana` + `/deliver_mohsana` list: held shipments whose delivery date is the
   * given day — legacy `{type:"محصنة", status:{$nin:[0,1,3]}, deleted:0, del_date ∈ [day, day+1)}`
   * (contad_app.js:4447/1687). The `$nin` form is NORMALIZED to an explicit `status: 'inVault'`
   * (Q9): `$nin` also matched documents MISSING the field, which was never the intent.
   */
  async dueForDelivery(date: Date): Promise<OperationsShipmentDoc[]> {
    const day = utcDay(date);
    const found = await operationsShipmentRepository.listShipments({
      filter: { shipmentType: 'secured', status: 'inVault', deliveryDate: day },
      page: 1,
      pageSize: 500,
      sortBy: 'createdAt',
      sortDir: 'asc',
    });
    return found.items;
  }

  /** The `/receive_mohsana` save: custody taken, shipment draft → inVault (legacy status 2). */
  async receiveIntoVault(
    shipmentId: string,
    input: ReceiveIntoVault,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(shipmentId);
    assertSecured(before);
    if (!canTransitionShipment(before.shipmentType, before.status, 'inVault')) {
      throw new BusinessRuleError(
        `a secured shipment cannot enter the vault from '${before.status}'`,
        'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
      );
    }

    // The treasury takes custody first: if it refuses (already held, dual-control), no shipment
    // status moves. Its uniqueness index is the real double-receive guard.
    await vaultCustody().receive(
      {
        shipmentId,
        receiptNumber: input.receiptNumber,
        bagCount: input.bagCount,
        cartonCount: input.cartonCount,
        boxCount: input.boxCount,
        bagSeals: input.bagSeals,
        boxSeals: input.boxSeals,
        receivedByPrimaryId: input.receivedByPrimaryId,
        receivedBySecondaryId: input.receivedBySecondaryId,
      },
      by,
    );

    const updated = await operationsShipmentRepository.updateById(
      shipmentId,
      {
        status: 'inVault',
        receiptNumber: input.receiptNumber,
        ...(input.serialTracked === undefined ? {} : { serialTracked: input.serialTracked }),
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: shipmentRef(shipmentId),
      action: 'update',
      changes: diffChanges({ status: before.status }, { status: updated.status }),
    });
    await emit(OperationsEvents.ShipmentUpdated, {
      shipmentId,
      shipmentType: updated.shipmentType,
      status: updated.status,
    });
    return updated;
  }

  /**
   * The `/tash4ela_mohasana` save: writes the DELIVERY leg — legacy set exactly `leader2` and
   * `car_num2` and touched no status (contad_app.js:4491). PRESERVED: assignment is not dispatch.
   *
   * The captain and vehicle are not free-typed: they must match a crew assignment on the
   * shipment's delivery day, which is what makes `day + vehicle + leg → crew` resolvable without
   * duplicating the specialists onto the shipment.
   */
  async assignDeliveryLeg(
    shipmentId: string,
    input: AssignSecuredDeliveryLeg,
    by: string,
  ): Promise<OperationsShipmentAssignmentDoc> {
    const shipment = await operationsShipmentRepository.getById(shipmentId);
    assertSecured(shipment);
    if (shipment.status !== 'inVault') {
      throw new BusinessRuleError(
        `only a shipment in the vault can be assigned a delivery leg (this one is '${shipment.status}')`,
        'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
      );
    }
    if (shipment.deliveryDate === null) {
      throw new BusinessRuleError(
        'this secured shipment has no delivery date',
        'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
      );
    }

    const crew = await operationsCrewAssignmentRepository.findById(input.crewAssignmentId);
    if (crew === null) throw new NotFoundError('crew assignment not found');

    // The crew row must belong to the shipment's DELIVERY day — the legacy screen only ever
    // listed that day's tashghela rows beside that day's due shipments.
    const day = await operationsDayService.findByDate(shipment.deliveryDate);
    if (day === null || String(crew.operationsDayId) !== String(day._id)) {
      throw new BusinessRuleError(
        "the crew assignment is not on the shipment's delivery day",
        'OPERATIONS_CREW_DAY_MISMATCH',
      );
    }
    // The captain must be THAT row's captain: legacy picked the leader from the row it displayed.
    if (
      crew.captainEmployeeId === null ||
      String(crew.captainEmployeeId) !== input.captainEmployeeId
    ) {
      throw new BusinessRuleError(
        'the captain is not the captain of that crew assignment',
        'OPERATIONS_CREW_CAPTAIN_MISMATCH',
      );
    }

    const existing = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      shipmentId,
      'delivery',
    );
    const set = {
      captainEmployeeId: new Types.ObjectId(input.captainEmployeeId),
      vehicleId: crew.vehicleId,
      crewAssignmentId: crew._id,
    };

    let doc: OperationsShipmentAssignmentDoc;
    if (existing === null) {
      doc = await operationsShipmentAssignmentRepository.create(
        {
          shipmentId: new Types.ObjectId(shipmentId),
          leg: 'delivery',
          operationsDayId: day._id,
          ...set,
        },
        { by },
      );
      await auditService.record({
        entityRef: assignmentRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, assignmentSnapshot(doc)),
      });
    } else {
      // Re-assignment overwrites in place, exactly as the legacy bulkWrite did.
      doc = await operationsShipmentAssignmentRepository.updateById(String(existing._id), set, {
        by,
        version: input.version,
      });
      await auditService.record({
        entityRef: assignmentRef(String(doc._id)),
        action: 'update',
        changes: diffChanges(assignmentSnapshot(existing), assignmentSnapshot(doc)),
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
   * The `/deliver_mohsana/data` call: the treasury releases custody and the shipments go out —
   * legacy set `status: 3` per shipment and `car_status: 1` on the tashghela row
   * (contad_app.js:1735-1740), with NO transaction and NO checks. Ported with both.
   *
   * NORMALIZE (Q30-adjacent, documented): a shipment may only be dispatched on the crew assignment
   * it was ASSIGNED to. Legacy checked nothing here, which is what let a mohsana reach the
   * terminal state with an empty `leader2` and land in the captain report under a blank captain.
   */
  async dispatch(input: DispatchSecuredShipments, by: string): Promise<{ dispatched: number }> {
    const crew = await operationsCrewAssignmentRepository.findById(input.crewAssignmentId);
    if (crew === null) throw new NotFoundError('crew assignment not found');

    const prepared: {
      shipment: OperationsShipmentDoc;
      assignment: OperationsShipmentAssignmentDoc;
    }[] = [];
    for (const shipmentId of input.shipmentIds) {
      const shipment = await operationsShipmentRepository.getById(shipmentId);
      assertSecured(shipment);
      if (!canTransitionShipment(shipment.shipmentType, shipment.status, 'dispatched')) {
        throw new BusinessRuleError(
          `shipment ${shipmentId} cannot be dispatched from '${shipment.status}'`,
          'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
        );
      }
      const assignment = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
        shipmentId,
        'delivery',
      );
      if (assignment === null) {
        throw new BusinessRuleError(
          `shipment ${shipmentId} has no delivery leg assigned`,
          'OPERATIONS_DELIVERY_LEG_REQUIRED',
        );
      }
      if (String(assignment.crewAssignmentId) !== input.crewAssignmentId) {
        throw new ConflictError(
          `shipment ${shipmentId} is assigned to a different crew assignment`,
        );
      }
      prepared.push({ shipment, assignment });
    }

    const beforeDocs = await Promise.all(
      prepared.map(async (p) => operationsVaultCustodyService.docFor(String(p.shipment._id))),
    );

    // One transaction for the whole dispatch — the legacy Promise.all left partial state behind.
    const released = await unitOfWork(async (session) => {
      const views = [];
      for (const { shipment } of prepared) {
        views.push(await vaultCustody().release(String(shipment._id), by, session));
        await operationsShipmentRepository.updateById(
          String(shipment._id),
          { status: 'dispatched' },
          { by, version: shipment.__v, session },
        );
      }
      return views;
    });

    // Audit + events only after commit.
    for (let i = 0; i < prepared.length; i += 1) {
      const entry = prepared[i];
      const view = released[i];
      const before = beforeDocs[i];
      if (entry === undefined || view === undefined || before === undefined) continue;
      await operationsVaultCustodyService.announceRelease(view, before);
      await auditService.record({
        entityRef: shipmentRef(String(entry.shipment._id)),
        action: 'update',
        changes: diffChanges({ status: 'inVault' }, { status: 'dispatched' }),
      });
      await emit(OperationsEvents.SecuredDispatched, {
        shipmentId: String(entry.shipment._id),
        shipmentType: 'secured',
        status: 'dispatched',
      });
    }
    return { dispatched: prepared.length };
  }
}

export const operationsSecuredService = new OperationsSecuredService();
