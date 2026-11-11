// The secured (محصنة) workflow — the four legacy screens, ported.
//
//   /mohsana            → backlog()          the open secured backlog, NO date filter (:657)
//                         board()            …the same set as BOARD ROWS — the secured screen (Round 8)
//   the pickup ✓        → confirmPickup()    the desk's «تم الاستلام من العمليات» on a draft (Round 10);
//                                            the captain's own ✓ is written by execution.service
//                         undoPickup()       …taken back — the captain's or the desk's — until the
//                                            vault receives (Round 10)
//   «استلام الخزينة»     → vaultQueue()       what the vault receives: the yellow and today's green (Round 8)
//   /receive_mohsana    → receiveIntoVault() draft → inVault, custody taken (:1220) — only once
//                                            somebody picked it up (Round 10)
//   cancel the receipt  → cancelReceipt()    inVault → draft, custody voided — the special grant (Round 10)
//   «صرف الخزينة»        → dispatchBoard()    every shipment in the vault, optional delivery day (Round 10)
//   /tash4ela_mohasana  → assignDeliveryLeg() writes leader2 + car_num2 ONLY, no status change (:4491)
//   /deliver_mohsana    → dispatch()         inVault → dispatched, custody released (:1737)
//   /main_ops receive   → completion lives on the shipment service (:564), unchanged by this slice
//
// Round 10's lock («الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد … يعدل عليها») is enforced where
// each write lives (secured-lock.ts): the shipment service's edit, delete and receipt photo, the
// pickup crew, and the pickup ✓ and its undo here. The flow acts in this file — assign the delivery
// leg, dispatch — move a received shipment along and stay open.
//
// The status ladder's MEANING is preserved exactly (legacy 0→2→3→1, non-ordinal, 1 terminal); only
// the encoding is normalized, and the legacy codes stay pinned in the contracts mapping.
//
// Custody never happens here: this service drives the Treasury PORT (../treasury-boundary.ts).
// Operations decides WHEN a shipment may move; the treasury decides what custody means.
import {
  ErrorCodes,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  OperationsEvents,
  addDaysYmd,
  cairoCalendarDate,
  cairoDayStart,
  cairoYmd,
  type AssignSecuredDeliveryLeg,
  type CancelVaultReceipt,
  type DispatchSecuredShipments,
  type ListSecuredBacklogQuery,
  type Paginated,
  type ReceiveIntoVault,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleDocumentError,
} from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { vaultCustody } from '../treasury-boundary';
import { operationsVaultCustodyService } from '../vault/vault-custody.service';
import { nextSequence } from '../assignments/leg-sequence';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { isCaptainOf } from '../crew/crew-slots';
import { operationsDayService, utcDay } from '../days/day.service';
import { canTransitionShipment } from '../shipments/shipment-status';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';
import { type OperationsShipmentDoc } from '../shipments/shipment.model';
import { securedPickupOf, type SecuredPickup } from '../shipments/secured-stage';
import { assertSecuredUnlocked } from '../shipments/secured-lock';
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

const assignmentSnapshot = (doc: OperationsShipmentAssignmentDoc) => ({
  leg: doc.leg,
  captainEmployeeId: String(doc.captainEmployeeId),
  vehicleId: String(doc.vehicleId),
  crewAssignmentId: String(doc.crewAssignmentId),
});

/**
 * The vault's receive queue before mapping: board rows, and — for the ones the vault already took
 * in today — when it did. `day` is the Cairo day "today" was read for (UTC midnight).
 */
export interface VaultQueueView extends DayBoardView {
  day: Date;
  receivedAt: Map<string, Date>;
}

/**
 * «صرف الخزينة» before mapping: board rows ordered by delivery date, when the vault took each one in,
 * the version of each one's delivery leg, and the Cairo day "overdue" was judged by (UTC midnight).
 */
export interface DispatchBoardView extends DayBoardView {
  today: Date;
  receivedAt: Map<string, Date>;
  deliveryLegVersion: Map<string, number>;
}

const shipmentEventPayload = (doc: OperationsShipmentDoc) => ({
  shipmentId: String(doc._id),
  shipmentType: doc.shipmentType,
  status: doc.status,
});

const assertSecured = (shipment: OperationsShipmentDoc): void => {
  if (shipment.shipmentType !== 'secured') {
    throw new BusinessRuleError(
      'this workflow applies to secured shipments only',
      'OPERATIONS_NOT_A_SECURED_SHIPMENT',
    );
  }
};

/**
 * The pickup this secured shipment has — its record (secured-stage.ts `securedPickupOf`). The
 * pickup LEG is read only for a row whose record was never written (a pre-Round-10 row), so the
 * usual answer costs no second read.
 */
const securedPickup = async (shipment: OperationsShipmentDoc): Promise<SecuredPickup | null> =>
  securedPickupOf(
    shipment.pickup,
    shipment.pickup === undefined
      ? await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
          String(shipment._id),
          'pickup',
        )
      : null,
  );

/** The audit's two changes for a pickup record moving from `from` to `to` — WHO and WHEN. */
const pickupChanges = (from: SecuredPickup | null, to: SecuredPickup | null) => [
  { field: 'pickedUpBy', old: from?.by ?? null, new: to?.by ?? null },
  { field: 'pickedUpAt', old: from?.at?.toISOString() ?? null, new: to?.at?.toISOString() ?? null },
];

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
   * THE SECURED SCREEN — «شاشة الشحنات المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى»: the same
   * set as `backlog` (every secured shipment not completed, no date filter, newest first), as BOARD
   * ROWS — enriched exactly as the day board's (`boardView`), each carrying its `securedStage`.
   *
   * Whole, not paged, because the screen totals and filters it like the day board does; so it is
   * COUNTED BEFORE IT IS READ and refused past the history's cap, never cut short — the same
   * guard, code and details as the history.
   */
  async board(): Promise<DayBoardView> {
    const count = await operationsShipmentRepository.countOpenSecured();
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) {
      throw historyTooLarge(
        count,
        `${String(count)} secured shipments are open — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown`,
      );
    }
    return operationsShipmentService.boardView(await operationsShipmentRepository.openSecured());
  }

  /**
   * THE VAULT'S RECEIVE QUEUE — «هيظهر للخزنة فى شاشة استلام الخزينه نفس المحصنة … وهتكون باللون
   * الاصفر عشان تعرف ان المحصنة مع القائد ولما الخزنة تدوس صح ساعتها هتبقى اخضر»:
   *
   *   · the secured shipments SOMEBODY PICKED UP — still `draft`, their pickup confirmed by the
   *     captain in the mobile app (`withCaptain`, yellow) or, since Round 10, by the Operations desk
   *     (`withOperations`, yellow too): on their way to the vault;
   *   · the ones the vault RECEIVED TODAY on the Cairo calendar (the custody's `receivedAt`; green),
   *     whatever has happened to them since — today's receipts stay on today's screen;
   *   · with `all`, every `draft` one besides (`awaitingPickup`, white) — FOR VIEWING since Round 10:
   *     the vault cannot receive it until the captain or the desk has pressed ✓ (a captain without
   *     the app now has the desk's ✓ for that, «او العمليات»).
   *
   * The stage is read off the pickup records BEFORE the rows are enriched, so the van cards beside the
   * rows are only the vans of the rows shown. Counted before the shipments are read: the open drafts
   * plus today's receipts, against the history's cap. Newest created first.
   */
  async vaultQueue(all: boolean, now: Date = new Date()): Promise<VaultQueueView> {
    const today = cairoYmd(now);
    const received = await vaultCustody().receivedBetween(
      cairoDayStart(today),
      cairoDayStart(addDaysYmd(today, 1)),
    );
    const count = (await operationsShipmentRepository.countSecuredDrafts()) + received.length;
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) {
      throw historyTooLarge(
        count,
        `${String(count)} secured shipments wait for the vault or were received today — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown`,
      );
    }

    const drafts = await operationsShipmentRepository.securedDrafts();
    let waiting = drafts;
    if (!all) {
      // Yellow either way — the captain's ✓ or the desk's, both on the shipment's pickup record.
      // The legs are read only for the rows whose record was never written (pre-Round-10 rows).
      const unrecorded = drafts.filter((d) => d.pickup === undefined).map((d) => String(d._id));
      const pickupLegs = new Map(
        (await operationsShipmentAssignmentRepository.findByShipments(unrecorded))
          .filter((leg) => leg.leg === 'pickup')
          .map((leg) => [String(leg.shipmentId), leg] as const),
      );
      waiting = drafts.filter(
        (d) => securedPickupOf(d.pickup, pickupLegs.get(String(d._id))) !== null,
      );
    }
    // A receipt's shipment that was deleted since is not offered: `findByIds` reads live rows only.
    const receivedDocs = await operationsShipmentRepository.findByIds(
      received.map((r) => r.shipmentId),
    );
    const byId = new Map(
      [...waiting, ...receivedDocs].map((doc) => [String(doc._id), doc] as const),
    );
    const docs = [...byId.values()].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || String(b._id).localeCompare(String(a._id)),
    );
    return {
      ...(await operationsShipmentService.boardView(docs)),
      day: cairoCalendarDate(now),
      receivedAt: new Map(received.map((r) => [r.shipmentId, r.receivedAt])),
    };
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

  /**
   * «صرف الخزينة» — Round 10: «كله يبقى موجود فى تاريخ يتفلتر». EVERY secured shipment in the vault,
   * whatever its delivery date, as board rows (their crew is the DELIVERY leg's: `crewLegOf` reads
   * `inVault` that way), with ONE delivery day as an optional filter.
   *
   * Ordered by delivery date, OLDEST FIRST — a shipment that should have left already is the one the
   * vault must see first — then oldest created, and a shipment with no delivery date last (Mongo's
   * ascending sort would put it first, so the order is applied here, over a set the cap bounds).
   *
   * Counted before it is read, refused past the history's cap like the other boards. Each row also
   * carries when the vault took it in and the version of its delivery leg — the assign dialog
   * re-assigns with that version, and reads the crew board of the row's OWN delivery day, so a
   * shipment due on another day than the filter's is assigned exactly as one due on it.
   */
  async dispatchBoard(date?: Date, now: Date = new Date()): Promise<DispatchBoardView> {
    const day = date === undefined ? undefined : utcDay(date);
    const count = await operationsShipmentRepository.countSecuredInVault(day);
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) {
      throw historyTooLarge(
        count,
        `${String(count)} secured shipments are in the vault${day === undefined ? '' : ' for that day'} — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown; pick a delivery day`,
      );
    }
    const docs = (await operationsShipmentRepository.securedInVault(day)).sort((a, b) => {
      if (a.deliveryDate === null || b.deliveryDate === null) {
        if (a.deliveryDate !== b.deliveryDate) return a.deliveryDate === null ? 1 : -1;
      } else if (a.deliveryDate.getTime() !== b.deliveryDate.getTime()) {
        return a.deliveryDate.getTime() - b.deliveryDate.getTime();
      }
      return (
        a.createdAt.getTime() - b.createdAt.getTime() || String(a._id).localeCompare(String(b._id))
      );
    });
    const ids = docs.map((d) => String(d._id));
    const [custody, legs] = await Promise.all([
      vaultCustody().findMany(ids),
      operationsShipmentAssignmentRepository.findByShipments(ids),
    ]);
    return {
      ...(await operationsShipmentService.boardView(docs)),
      today: cairoCalendarDate(now),
      receivedAt: new Map([...custody].map(([id, view]) => [id, view.receivedAt] as const)),
      deliveryLegVersion: new Map(
        legs
          .filter((leg) => leg.leg === 'delivery')
          .map((leg) => [String(leg.shipmentId), leg.__v] as const),
      ),
    };
  }

  /**
   * THE DESK'S PICKUP ✓ — «لو العمليات تم الاستلام من العمليات» (Round 10). The Operations desk
   * confirms it has collected a secured shipment: the shipment's pickup record is written as the
   * desk's, the row turns yellow (`withOperations`) and the vault may receive it. Never on a leg —
   * the captain's execution record is his own.
   *
   * Only while the vault has not received it (`assertSecuredUnlocked`), and only when no pickup is
   * recorded at all: the desk never stamps over the captain's ✓ (it may take it back first, then
   * confirm as Operations). The version guards both races — with the vault's ✓ and with the
   * captain's ✓ in the app, each of which moves the version.
   */
  async confirmPickup(
    shipmentId: string,
    version: number,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(shipmentId);
    assertSecured(before);
    assertSecuredUnlocked(before, 'the pickup ✓');
    const current = await securedPickup(before);
    if (current !== null) {
      throw new ConflictError(
        current.by === 'captain'
          ? 'the captain already confirmed collecting this shipment in the app'
          : 'the Operations desk already confirmed collecting this shipment',
        ErrorCodes.OPERATIONS_SECURED_ALREADY_PICKED_UP,
      );
    }
    const record = { by: 'operations' as const, at: new Date(), userId: new Types.ObjectId(by) };
    const updated = await operationsShipmentRepository.updateById(
      shipmentId,
      { pickup: record },
      { by, version },
    );
    await auditService.record({
      entityRef: shipmentRef(shipmentId),
      action: 'update',
      changes: pickupChanges(null, record),
    });
    await emit(OperationsEvents.ShipmentPickupConfirmed, {
      ...shipmentEventPayload(updated),
      by: record.by,
    });
    return updated;
  }

  /**
   * The desk takes the pickup ✓ back — «الصح ممكن يتلغى لحد ما الخزنة تستلم» (the owner's answer 1),
   * WHOEVER pressed it: «لو القائد عمل صح ممكن العمليات تشيلها». Until the vault receives. The record
   * is cleared to an explicit null — never removed — so the row turns white even though the
   * captain's leg still says picked up (his leg is his execution record and is not rewritten), and
   * the desk may then ✓ it again as Operations.
   */
  async undoPickup(
    shipmentId: string,
    version: number,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(shipmentId);
    assertSecured(before);
    assertSecuredUnlocked(before, 'taking the pickup ✓ back');
    const current = await securedPickup(before);
    if (current === null) {
      throw new ConflictError(
        'nobody has confirmed collecting this shipment — there is no pickup ✓ to take back',
        ErrorCodes.OPERATIONS_SECURED_NOT_PICKED_UP,
      );
    }
    const updated = await operationsShipmentRepository.updateById(
      shipmentId,
      { pickup: null },
      { by, version },
    );
    await auditService.record({
      entityRef: shipmentRef(shipmentId),
      action: 'update',
      changes: pickupChanges(current, null),
    });
    await emit(OperationsEvents.ShipmentPickupUndone, {
      ...shipmentEventPayload(updated),
      by: current.by,
    });
    return updated;
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
    // Round 10 — «مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»: the vault receives what
    // somebody has collected — the captain in the app, or the desk. A white row is for viewing.
    if ((await securedPickup(before)) === null) {
      throw new ConflictError(
        'nobody has picked this shipment up yet — the captain (in the app) or the Operations desk confirms the pickup before the vault receives it',
        ErrorCodes.OPERATIONS_SECURED_NOT_PICKED_UP,
      );
    }

    // The version is checked up front for the plain answer, and again by the shipment write.
    if (before.__v !== input.version) throw new StaleDocumentError();

    // ONE transaction (Round 10). The treasury takes custody first — if it refuses (already held,
    // dual control), no shipment status moves; its uniqueness index is the real double-receive
    // guard — and the shipment moves to `inVault` under the version the screen read. Before Round 10
    // the two writes stood apart, so a receive refused at the second one (stale, because something
    // changed the shipment a moment earlier) left a HELD custody on a shipment still in draft —
    // never receivable again. The pickup ✓ and its undo made that moment likelier (each moves the
    // version), so the two writes now commit or roll back together.
    const { custody, updated } = await unitOfWork(async (session) => {
      const taken = await vaultCustody().receive(
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
        session,
      );
      const moved = await operationsShipmentRepository.updateById(
        shipmentId,
        {
          status: 'inVault',
          receiptNumber: input.receiptNumber,
          ...(input.serialTracked === undefined ? {} : { serialTracked: input.serialTracked }),
        },
        { by, version: input.version, session },
      );
      return { custody: taken, updated: moved };
    });

    // Audit + events only after commit — the custody's first, as before.
    await operationsVaultCustodyService.announceReceived(custody);
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
   * CANCEL THE VAULT'S RECEIPT — Round 10, the owner's answer 3: after the vault receives nobody
   * edits, «بس صلاحية خاصة تقدر تلغى استلام الخزينة» (the route's `operationsVault.cancelReceipt`).
   *
   * Only from `inVault`: a shipment that has left the vault is past cancelling. In ONE transaction
   * (the dispatch precedent): the treasury VOIDS the custody (kept, stamped with why — never
   * erased) and the shipment returns to `draft` with its receipt number cleared and its pickup left
   * exactly as it was — so the row is yellow again, editable again, and the vault can receive it
   * afresh. This is the one move back down the secured ladder; it is not in shipment-status.ts,
   * because no ordinary act may take it.
   *
   * A delivery crew assigned while it sat in the vault is LEFT as it is: the leg is the plan for
   * its delivery day, still true once the vault takes it in again, and `dispatch` refuses anything
   * not back in the vault — so the plan cannot send it out early.
   *
   * The reason is recorded on BOTH audit rows of the request — the custody's, and the shipment's own,
   * so every reader of the shipment's log sees why, vault grant or not.
   */
  async cancelReceipt(
    shipmentId: string,
    input: CancelVaultReceipt,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(shipmentId);
    assertSecured(before);
    if (before.status !== 'inVault') {
      throw new ConflictError(
        before.status === 'draft'
          ? 'the vault has not received this shipment — there is no receipt to cancel'
          : `this shipment has left the vault ('${before.status}') — its receipt can no longer be cancelled`,
        ErrorCodes.OPERATIONS_SECURED_NOT_IN_VAULT,
      );
    }
    if (before.__v !== input.version) throw new StaleDocumentError();

    const { voided, updated } = await unitOfWork(async (session) => {
      const custody = await vaultCustody().cancelReceipt(shipmentId, input.reason, by, session);
      const shipment = await operationsShipmentRepository.updateById(
        shipmentId,
        { status: 'draft', receiptNumber: null },
        { by, version: input.version, session },
      );
      return { voided: custody, updated: shipment };
    });

    // Audit + events only after commit.
    await operationsVaultCustodyService.announceReceiptCancelled(voided, input.reason);
    await auditService.record({
      entityRef: shipmentRef(shipmentId),
      action: 'update',
      changes: [
        ...diffChanges(
          { status: before.status, receiptNumber: before.receiptNumber },
          { status: updated.status, receiptNumber: updated.receiptNumber },
        ),
        { field: 'receiptCancelReason', old: null, new: input.reason },
      ],
    });
    await emit(OperationsEvents.ShipmentUpdated, shipmentEventPayload(updated));
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
    // The captain must be ONE OF that row's captains: legacy picked the leader from the row it
    // displayed, and a row may now display two.
    if (!isCaptainOf(crew, input.captainEmployeeId)) {
      throw new BusinessRuleError(
        'the captain is not a captain of that crew assignment',
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
      // OP-5: a new stop lands at the END of that captain's delivery list for the day.
      doc = await operationsShipmentAssignmentRepository.create(
        {
          shipmentId: new Types.ObjectId(shipmentId),
          leg: 'delivery',
          operationsDayId: day._id,
          sequence: await nextSequence(day._id, input.captainEmployeeId, 'delivery'),
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
      // Re-assignment overwrites in place, exactly as the legacy bulkWrite did — EXCEPT for the
      // position, which cannot survive a change of captain.
      //
      // `sequence` is a position within ONE captain's list for one day, and
      // `ux_day_captain_leg_sequence` makes that pair unique. Carrying the old number across to a
      // different captain therefore either collides outright — a 409 on an ordinary hand-over — or
      // drops the stop at an arbitrary point in the new captain's order. `assignPickupLeg` has
      // always re-seated it; this leg never did, and the two-captain crew is what turned that from
      // a corner case into the everyday act of handing a load to the co-captain on the same van.
      const movingCaptain = String(existing.captainEmployeeId) !== input.captainEmployeeId;
      doc = await operationsShipmentAssignmentRepository.updateById(
        String(existing._id),
        movingCaptain
          ? { ...set, sequence: await nextSequence(day._id, input.captainEmployeeId, 'delivery') }
          : set,
        { by, version: input.version },
      );
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
