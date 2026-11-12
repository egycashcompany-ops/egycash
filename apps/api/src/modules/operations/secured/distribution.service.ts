// «توزيع المحصنات» — placing the day's محصنات on the day's vans (Round 12).
//
// The owner: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى
// اتحط عليها القادة والاخصائين والاتجاه … وهشد المحصنة احطها على العربيه او المحصنة اللى نفس الاتجاه
// بتاع العربيه تتحط تلقائى ولما يحفظ». And for the vault: «نفس الشاشة هنعمل زيها للخزنة هيكون فوق كل
// عربيه تسليم وطباعه».
//
//   view()  the day's vans (every crew row of the day's crew board) and its محصنات — due on the day
//           and not out yet, plus the OVERDUE ones still in the vault — each with its delivery leg
//           as it stands and the vans its area's direction points at. One read for both screens:
//           Operations distributes from it, the vault hands each van over from it.
//   save()  every change of the screen in ONE transaction: a shipment placed on a van, moved to
//           another, or taken off. Nothing is written unless every change holds.
//
// A SHIPMENT IS "ON A VAN" THROUGH ITS DELIVERY LEG and nothing else — the leg «صرف الخزينة»'s assign
// dialog wrote (secured.service.ts `assignDeliveryLeg`), the one the dispatch checks, the captain's
// phone reads and the captain report attributes. So distributing changes exactly the fact every
// other surface already reads, and the vault's «تسليم» is the dispatch that already exists.
//
// WHAT DIFFERS FROM `assignDeliveryLeg`, each on purpose:
//   · a shipment still in DRAFT may be placed («المحصنة اللى يومها هتخرج» — the day's, whatever its
//     stage): the van is planned before the vault has it, and the vault hands over only what it holds;
//   · a shipment may be taken OFF its van — the leg is RETIRED (soft-deleted): a leg is a captain and
//     a van, and with neither it is no leg. Its history stays in «السجل» (`crewRemoved`);
//   · an OVERDUE shipment in the vault (due before the day) placed on a van of the day has its
//     delivery date moved to the day, in the same transaction — see `save`;
//   · the version guards the LEG as the screen read it, null meaning "it had none", so two desks
//     placing the same never-placed shipment cannot both win (assign-delivery's 0 cannot say that).
import {
  ErrorCodes,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  OperationsEvents,
  cairoCalendarDate,
  cairoYmd,
  operationsDirectionVanIds,
  ymdOf,
  type ErrorCode,
  type OperationsDayBoardVehicleCrewDto,
  type SaveSecuredDistribution,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { AppError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { vaultCustody } from '../treasury-boundary';
import { nextSequence } from '../assignments/leg-sequence';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { type OperationsCrewAssignmentDoc } from '../crew/crew-assignment.model';
import { isCaptainOf } from '../crew/crew-slots';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';
import { type OperationsShipmentDoc } from '../shipments/shipment.model';
import { DISTRIBUTION_RESCHEDULE_MARKER } from '../shipments/shipment-log';
import {
  historyTooLarge,
  operationsShipmentService,
  type DayBoardView,
} from '../shipments/shipment.service';

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

/**
 * The leg's audited facts — assign-delivery's four, plus the operating day, which distribution can
 * move (an overdue shipment's leg goes from its old day's van to a van of the distribution day).
 */
const legSnapshot = (doc: OperationsShipmentAssignmentDoc) => ({
  leg: doc.leg,
  captainEmployeeId: String(doc.captainEmployeeId),
  vehicleId: String(doc.vehicleId),
  crewAssignmentId: String(doc.crewAssignmentId),
  operationsDayId: String(doc.operationsDayId),
});

/** Has the captain started this leg in the app? Then it is his, and distribution leaves it be. */
const started = (leg: OperationsShipmentAssignmentDoc): boolean =>
  (leg.executionStatus ?? 'pending') !== 'pending';

/**
 * A refusal that NAMES THE SHIPMENT — every distribution refusal is about one card on a screen that
 * shows dozens, so the detail says which: `{ field: 'shipmentId', code: 'SHIPMENT', message: id }`.
 */
const refused = (code: ErrorCode, status: number, shipmentId: string, message: string): AppError =>
  new AppError(code, status, message, {
    details: [{ field: 'shipmentId', code: 'SHIPMENT', message: shipmentId }],
  });

/**
 * 422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST` — the boards' «no past day» rule: a past day's vans have
 * left. The detail names the earliest day allowed, as the shipment form's date refusals do.
 */
const dayInPast = (day: string, today: string): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_DISTRIBUTION_DAY_IN_PAST,
    422,
    `the day ${day} is before today (${today}) — a past day's vans have left`,
    { details: [{ field: 'date', code: 'MIN_DATE', message: today }] },
  );

/** Vans in van-code order — numbers in number order («9» before «150»), a van with no code last. */
const byVanCode = (
  a: OperationsDayBoardVehicleCrewDto,
  b: OperationsDayBoardVehicleCrewDto,
): number => {
  if (a.vehicleCode === null || b.vehicleCode === null) {
    if (a.vehicleCode !== b.vehicleCode) return a.vehicleCode === null ? 1 : -1;
    return a.crewAssignmentId.localeCompare(b.crewAssignmentId);
  }
  return (
    a.vehicleCode.localeCompare(b.vehicleCode, 'en', { numeric: true }) ||
    a.crewAssignmentId.localeCompare(b.crewAssignmentId)
  );
};

/**
 * The distribution screen before mapping: the shipments as board rows, the day's vans, and per
 * shipment what the screen needs beside its row. `day` and `today` are UTC midnights.
 */
export interface DistributionView extends DayBoardView {
  day: Date;
  today: Date;
  /** Every van (crew row) of the day, as van cards, in van-code order. */
  vans: OperationsDayBoardVehicleCrewDto[];
  /** shipment id → when the vault took it in. */
  receivedAt: Map<string, Date>;
  /** shipment id → its LIVE delivery leg. */
  deliveryLeg: Map<string, OperationsShipmentAssignmentDoc>;
  /** shipment id → the vans of the day its area's direction names (see the contract). */
  directionVanIds: Map<string, string[]>;
}

/** One change, checked and resolved before anything is written. */
type Plan =
  | {
      kind: 'remove';
      shipment: OperationsShipmentDoc;
      leg: OperationsShipmentAssignmentDoc;
    }
  | {
      kind: 'place';
      shipment: OperationsShipmentDoc;
      leg: OperationsShipmentAssignmentDoc | null;
      crew: OperationsCrewAssignmentDoc;
      captainEmployeeId: string;
      /** The leg already rides this van with this captain on this day — only the date moves. */
      legUnchanged: boolean;
      /** An overdue shipment in the vault: its delivery date moves to the day. */
      reschedule: boolean;
    };

/** What the transaction wrote, for the audit and the events after the commit. */
type Written =
  | { kind: 'removed'; before: OperationsShipmentAssignmentDoc }
  | {
      kind: 'assigned';
      before: OperationsShipmentAssignmentDoc | null;
      after: OperationsShipmentAssignmentDoc;
    }
  | { kind: 'rescheduled'; before: OperationsShipmentDoc; after: OperationsShipmentDoc };

class OperationsDistributionService {
  /**
   * The day a distribution request means — the day asked for, or TODAY in Cairo — refused when it
   * is before today. "Today" is Cairo's (the boards' rule): between Cairo midnight and UTC midnight
   * the two calendars name different days, and the desk works on Cairo's.
   */
  resolveDay(date: Date | undefined, now: Date): { day: Date; today: Date } {
    const today = cairoCalendarDate(now);
    const day = date === undefined ? today : utcDay(date);
    if (ymdOf(day) < ymdOf(today)) throw dayInPast(ymdOf(day), cairoYmd(now));
    return { day, today };
  }

  /**
   * THE SCREEN — the day's vans on the right, its محصنات on the left and on the vans.
   *
   * THE SHIPMENTS (`securedForDistribution`): due out on the day and not out yet — DRAFT at any stage
   * (placed now, handed over once the vault has it) or IN THE VAULT — plus the OVERDUE ones still in
   * the vault (due before the day: they missed their van and are still the vault's to send). Counted
   * before they are read, against the history's cap, like every board. Ordered by delivery date —
   * the overdue first, the vault must see them first — then oldest booked.
   *
   * THE VANS: every crew row of the day, whether or not anything rides it yet — the van IS where a
   * shipment is dropped. Van cards built by the same code as the boards' (`vanCardsOf`).
   */
  async view(date: Date | undefined, now: Date = new Date()): Promise<DistributionView> {
    const { day, today } = this.resolveDay(date, now);
    const count = await operationsShipmentRepository.countSecuredForDistribution(day);
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) {
      throw historyTooLarge(
        count,
        `${String(count)} secured shipments are due or overdue for ${ymdOf(day)} — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown`,
      );
    }
    const docs = (await operationsShipmentRepository.securedForDistribution(day)).sort(
      (a, b) =>
        (a.deliveryDate?.getTime() ?? 0) - (b.deliveryDate?.getTime() ?? 0) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        String(a._id).localeCompare(String(b._id)),
    );
    const ids = docs.map((d) => String(d._id));

    const dayDoc = await operationsDayService.findByDate(day);
    const crewRows =
      dayDoc === null ? [] : await operationsCrewAssignmentRepository.findForDay(dayDoc._id);
    const [board, { crews }, custody, legs] = await Promise.all([
      operationsShipmentService.boardView(docs),
      operationsShipmentService.vanCardsOf(crewRows),
      vaultCustody().findMany(ids),
      operationsShipmentAssignmentRepository.findByShipments(ids),
    ]);
    const vans = [...crews].sort(byVanCode);

    return {
      ...board,
      day,
      today,
      vans,
      receivedAt: new Map([...custody].map(([id, view]) => [id, view.receivedAt] as const)),
      deliveryLeg: new Map(
        legs
          .filter((leg) => leg.leg === 'delivery')
          .map((leg) => [String(leg.shipmentId), leg] as const),
      ),
      // «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى» — the one rule, from the contract, so the
      // screen and the server cannot read a direction two ways.
      directionVanIds: new Map(
        docs.map(
          (doc) => [String(doc._id), operationsDirectionVanIds(doc.areaName, vans)] as const,
        ),
      ),
    };
  }

  /**
   * «ولما يحفظ» — every change of the screen in ONE request, ALL OR NOTHING.
   *
   * Two passes. The first CHECKS every change against what is stored now and resolves it to a plan
   * — so a refusal names its shipment and nothing has been written. The second WRITES every plan in
   * one transaction, each write version-guarded again, so a change landing between the passes
   * (another desk's save, the assign dialog, the vault's dispatch) still fails the whole save rather
   * than half of it. Audit rows and events follow the commit, as every Operations transaction does.
   *
   * OVERDUE — «المحصنة اللى يومها هتخرج»: a shipment in the vault whose delivery day has passed missed
   * its van. Placing it on a van of the day MOVES ITS DELIVERY DATE to the day, in the same
   * transaction, because its delivery leg has to ride a crew row of its delivery day (the rule every
   * other reader of the leg relies on — the captain's day, the reports, the dispatch board). That
   * date is the one field a received محصنة may still have changed (Round 10 locked the rest,
   * `isOperationsShipmentLocked`): it is a FLOW act — the shipment goes out later than planned —
   * not an edit of anything the vault signed for. The log says so (`deliveryRescheduled`). Taking an
   * overdue shipment OFF a van moves no date.
   */
  async save(
    input: SaveSecuredDistribution,
    by: string,
    now: Date = new Date(),
  ): Promise<{ date: Date; changed: number; rescheduled: number }> {
    const { day } = this.resolveDay(input.date, now);
    const dayYmd = ymdOf(day);
    const dayDoc = await operationsDayService.findByDate(day);

    const plans: Plan[] = [];
    for (const change of input.changes) {
      const id = change.shipmentId;
      const shipment = await operationsShipmentRepository.findById(id);
      if (shipment === null) {
        throw refused(ErrorCodes.NOT_FOUND, 404, id, `shipment ${id} not found`);
      }
      if (shipment.shipmentType !== 'secured') {
        throw refused(
          ErrorCodes.OPERATIONS_NOT_A_SECURED_SHIPMENT,
          422,
          id,
          `shipment ${id} is not a secured shipment`,
        );
      }
      if (shipment.status === 'dispatched' || shipment.status === 'completed') {
        throw refused(
          ErrorCodes.OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED,
          409,
          id,
          `shipment ${id} has left the vault ('${shipment.status}') — its van is history`,
        );
      }
      const due = shipment.deliveryDate === null ? null : ymdOf(shipment.deliveryDate);
      const overdue = shipment.status === 'inVault' && due !== null && due < dayYmd;
      if (due !== dayYmd && !overdue) {
        throw refused(
          ErrorCodes.OPERATIONS_DISTRIBUTION_NOT_ON_DAY,
          422,
          id,
          `shipment ${id} is not due on ${dayYmd} and is not an overdue one in the vault`,
        );
      }

      const leg = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(id, 'delivery');
      if (
        (leg === null) !== (change.version === null) ||
        (leg !== null && leg.__v !== change.version)
      ) {
        throw refused(
          ErrorCodes.STALE_DOCUMENT,
          409,
          id,
          `shipment ${id}'s van changed since the screen was read — refetch and retry`,
        );
      }

      if (change.crewAssignmentId === null || change.captainEmployeeId === null) {
        // Off its van. Off a van it was not on is no change at all.
        if (leg === null) continue;
        if (started(leg)) {
          throw refused(
            ErrorCodes.OPERATIONS_DISTRIBUTION_LEG_STARTED,
            409,
            id,
            `the captain has started shipment ${id}'s delivery in the app — it cannot be taken off`,
          );
        }
        plans.push({ kind: 'remove', shipment, leg });
        continue;
      }

      const crew = await operationsCrewAssignmentRepository.findById(change.crewAssignmentId);
      if (crew === null) {
        throw refused(ErrorCodes.NOT_FOUND, 404, id, 'crew assignment not found');
      }
      // The van must be one of THE DAY's — the screen shows that day's crew board only.
      if (dayDoc === null || String(crew.operationsDayId) !== String(dayDoc._id)) {
        throw refused(
          ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH,
          422,
          id,
          `that crew assignment is not on ${dayYmd}`,
        );
      }
      // Either of the van's captains — a van may carry two, and the screen sends the one chosen.
      if (!isCaptainOf(crew, change.captainEmployeeId)) {
        throw refused(
          ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH,
          422,
          id,
          'the captain is not a captain of that crew assignment',
        );
      }
      const legUnchanged =
        leg !== null &&
        String(leg.crewAssignmentId) === change.crewAssignmentId &&
        String(leg.captainEmployeeId) === change.captainEmployeeId &&
        String(leg.operationsDayId) === String(dayDoc._id);
      if (legUnchanged && !overdue) continue;
      if (leg !== null && !legUnchanged && started(leg)) {
        throw refused(
          ErrorCodes.OPERATIONS_DISTRIBUTION_LEG_STARTED,
          409,
          id,
          `the captain has started shipment ${id}'s delivery in the app — it cannot be moved`,
        );
      }
      plans.push({
        kind: 'place',
        shipment,
        leg,
        crew,
        captainEmployeeId: change.captainEmployeeId,
        legUnchanged,
        reschedule: overdue,
      });
    }

    if (plans.length === 0) return { date: day, changed: 0, rescheduled: 0 };

    const written = await unitOfWork(async (session) => {
      const out: Written[] = [];
      for (const plan of plans) {
        if (plan.kind === 'remove') {
          // RETIRED, not erased: the leg row keeps who and which van, and «السجل» reads it back.
          await operationsShipmentAssignmentRepository.updateById(
            String(plan.leg._id),
            { isDeleted: true, deletedAt: now, deletedBy: new Types.ObjectId(by) },
            { by, version: plan.leg.__v, session },
          );
          out.push({ kind: 'removed', before: plan.leg });
          continue;
        }

        const shipmentId = String(plan.shipment._id);
        if (plan.reschedule) {
          // The one write a received محصنة still takes — see the method's comment. Version-guarded
          // like any other: the shipment as the first pass read it.
          const moved = await operationsShipmentRepository.updateById(
            shipmentId,
            { deliveryDate: day },
            { by, version: plan.shipment.__v, session },
          );
          out.push({ kind: 'rescheduled', before: plan.shipment, after: moved });
        }
        if (plan.legUnchanged) continue;

        const operationsDayId = plan.crew.operationsDayId;
        const set = {
          captainEmployeeId: new Types.ObjectId(plan.captainEmployeeId),
          vehicleId: plan.crew.vehicleId,
          crewAssignmentId: plan.crew._id,
          operationsDayId,
        };
        if (plan.leg === null) {
          // A new stop lands at the END of that captain's delivery route for the day (OP-5).
          const created = await operationsShipmentAssignmentRepository.create(
            {
              shipmentId: new Types.ObjectId(shipmentId),
              leg: 'delivery',
              sequence: await nextSequence(
                operationsDayId,
                plan.captainEmployeeId,
                'delivery',
                session,
              ),
              ...set,
            },
            { by, session },
          );
          out.push({ kind: 'assigned', before: null, after: created });
        } else {
          // A position belongs to one captain's list on one day (`ux_day_captain_leg_sequence`):
          // a stop that changes captain or day is re-seated at the end of its new list — the
          // assign-delivery rule. Reads inside the session see this transaction's own writes, so
          // two stops moved onto one captain take consecutive places.
          const reseat =
            String(plan.leg.captainEmployeeId) !== plan.captainEmployeeId ||
            String(plan.leg.operationsDayId) !== String(operationsDayId);
          const updated = await operationsShipmentAssignmentRepository.updateById(
            String(plan.leg._id),
            reseat
              ? {
                  ...set,
                  sequence: await nextSequence(
                    operationsDayId,
                    plan.captainEmployeeId,
                    'delivery',
                    session,
                  ),
                }
              : set,
            { by, version: plan.leg.__v, session },
          );
          out.push({ kind: 'assigned', before: plan.leg, after: updated });
        }
      }
      return out;
    });

    // Audit + events only after the commit — per shipment, as every other act on one.
    let rescheduled = 0;
    const changedShipments = new Set<string>();
    for (const entry of written) {
      if (entry.kind === 'rescheduled') {
        rescheduled += 1;
        const shipmentId = String(entry.after._id);
        changedShipments.add(shipmentId);
        await auditService.record({
          entityRef: shipmentRef(shipmentId),
          action: 'update',
          changes: [
            {
              field: 'deliveryDate',
              old: entry.before.deliveryDate?.toISOString() ?? null,
              new: entry.after.deliveryDate?.toISOString() ?? null,
            },
            // «السجل» reads this as `deliveryRescheduled` — the flow act, not an edit.
            { field: DISTRIBUTION_RESCHEDULE_MARKER, old: null, new: true },
          ],
        });
        await emit(OperationsEvents.ShipmentUpdated, {
          shipmentId,
          shipmentType: entry.after.shipmentType,
          status: entry.after.status,
        });
        continue;
      }
      if (entry.kind === 'removed') {
        const leg = entry.before;
        changedShipments.add(String(leg.shipmentId));
        await auditService.record({
          entityRef: assignmentRef(String(leg._id)),
          action: 'delete',
          changes: [
            { field: 'captainEmployeeId', old: String(leg.captainEmployeeId), new: null },
            { field: 'vehicleId', old: String(leg.vehicleId), new: null },
            { field: 'crewAssignmentId', old: String(leg.crewAssignmentId), new: null },
          ],
        });
        await emit(OperationsEvents.SecuredLegRemoved, {
          assignmentId: String(leg._id),
          shipmentId: String(leg.shipmentId),
          leg: leg.leg,
          captainEmployeeId: String(leg.captainEmployeeId),
          vehicleId: String(leg.vehicleId),
        });
        continue;
      }
      const { before, after } = entry;
      changedShipments.add(String(after.shipmentId));
      await auditService.record({
        entityRef: assignmentRef(String(after._id)),
        action: before === null ? 'create' : 'update',
        changes: diffChanges(before === null ? {} : legSnapshot(before), legSnapshot(after)),
      });
      await emit(OperationsEvents.SecuredLegAssigned, {
        assignmentId: String(after._id),
        shipmentId: String(after.shipmentId),
        leg: after.leg,
        captainEmployeeId: String(after.captainEmployeeId),
        vehicleId: String(after.vehicleId),
      });
    }
    return { date: day, changed: changedShipments.size, rescheduled };
  }
}

export const operationsDistributionService = new OperationsDistributionService();
