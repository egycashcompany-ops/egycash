// «توزيع المحصنات» — placing the day's محصنات on the day's vans (Round 12).
//
// The owner: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى
// اتحط عليها القادة والاخصائين والاتجاه … وهشد المحصنة احطها على العربيه او المحصنة اللى نفس الاتجاه
// بتاع العربيه تتحط تلقائى ولما يحفظ». And for the vault: «نفس الشاشة هنعمل زيها للخزنة هيكون فوق كل
// عربيه تسليم وطباعه».
//
//   view()  the day's vans (every crew row of the day's crew board — since Round 24 the rows WITHOUT
//           A VAN too: «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات») and its محصنات — due on the day
//           and not out yet, plus the OVERDUE ones still in the vault — each with its delivery leg
//           as it stands and the vans its area's direction points at. One read for both screens:
//           Operations distributes from it, the vault hands each van over from it.
//   save()  every change of the screen in ONE transaction: a shipment placed on a van, moved to
//           another, or taken off. Nothing is written unless every change holds.
//
// ROUND 25 — «لو ضيفت اى عربيه بتظهر فى توزيع المحصنات على طول انا عاوز اللى يظهر اللى نوعها محصنة بس
// ولازم اكون دايس حفظ»: the vans are the SAVED crew rows whose «النوع» is the seeded «محصنة» type
// (`isSecuredRow` — by `seedKey`, so a rename keeps it), van or none. The board's unsaved draft is not
// in the database, so it never shows here. A row of another type that already carries one of the
// screen's shipments stays listed, marked, so nothing on it vanishes — and takes no new one.
//
// ROUND 30 — «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك سجل يعنى»:
// `view()` serves a PAST day too, as its RECORD — the day's saved vans and what rides them, from the
// live legs of that day — and `save()` refuses every write of one (422
// `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`, checked before any shipment): the record is read only on
// the server, whatever a client sends.
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
//     a van, and with neither it is no leg. Its history stays in «السجل» (`crewRemoved`). The
//     retirement is assignments/leg-retire.ts's, shared with the edit that moves a shipment's
//     delivery date off its van's day, so both leave the same trace;
//   · an OVERDUE shipment in the vault (due before TODAY — its day has passed) placed on a van of
//     the day has its delivery date moved to the day, in the same transaction — see `save`;
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
  type OperationsSecuredDistributionCrewDto,
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
import {
  isLegStarted,
  legStartedRefusal,
  recordLegRetired,
  retireLeg,
} from '../assignments/leg-retire';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import {
  hasVan,
  vehicleIdOf,
  type OperationsCrewAssignmentDoc,
} from '../crew/crew-assignment.model';
import { isCaptainOf } from '../crew/crew-slots';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { operationsShiftTypeRepository } from '../shift-types/shift-type.repository';
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
  // Null on a row without a van (Round 24): «السجل» prints no van rather than "null".
  vehicleId: vehicleIdOf(doc),
  crewAssignmentId: String(doc.crewAssignmentId),
  operationsDayId: String(doc.operationsDayId),
});

/**
 * A refusal that NAMES THE SHIPMENT — every distribution refusal is about one card on a screen that
 * shows dozens, so the detail says which: `{ field: 'shipmentId', code: 'SHIPMENT', message: id }`.
 * (The started-leg refusal is leg-retire.ts's `legStartedRefusal`, the same shape, because the
 * shipment edit answers it too.)
 */
const refused = (code: ErrorCode, status: number, shipmentId: string, message: string): AppError =>
  new AppError(code, status, message, {
    details: [{ field: 'shipmentId', code: 'SHIPMENT', message: shipmentId }],
  });

/**
 * 422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST` — the boards' «no past day» rule: a past day's vans have
 * left. The detail names the earliest day allowed, as the shipment form's date refusals do. Round 30
 * critic: `assign-delivery` (secured.service.ts) refuses a past day's van with it too — the same
 * delivery leg, the same record.
 */
export const dayInPast = (day: string, today: string): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_DISTRIBUTION_DAY_IN_PAST,
    422,
    `the day ${day} is before today (${today}) — a past day's vans have left`,
    { details: [{ field: 'date', code: 'MIN_DATE', message: today }] },
  );

/** Vans in van-code order — numbers in number order («9» before «150»), a van with no code last. */
const byVanCode = (
  a: Pick<OperationsDayBoardVehicleCrewDto, 'vehicleCode' | 'crewAssignmentId'>,
  b: Pick<OperationsDayBoardVehicleCrewDto, 'vehicleCode' | 'crewAssignmentId'>,
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
 * Round 25 — is this crew row of the «محصنة» type? Its `shiftTypeId` is the seeded secured type's
 * (`findSecuredType`). A row with no type, or of another, is not — and neither is any row when the
 * catalog holds no «محصنة» at all.
 */
export const isSecuredRow = (
  row: Pick<OperationsCrewAssignmentDoc, 'shiftTypeId'>,
  securedTypeId: string | null,
): boolean =>
  securedTypeId !== null &&
  row.shiftTypeId !== undefined &&
  row.shiftTypeId !== null &&
  String(row.shiftTypeId) === securedTypeId;

/**
 * 422 `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED` — a shipment put on a crew row that is not of the
 * «محصنة» type. Names the shipment (as every distribution refusal does) and then the row. The
 * single-shipment door (`assign-delivery`) refuses with it too.
 */
export const rowNotSecured = (shipmentId: string, crewAssignmentId: string): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED,
    422,
    `crew row ${crewAssignmentId} is not of the «محصنة» type — it takes no secured shipment`,
    {
      details: [
        { field: 'shipmentId', code: 'SHIPMENT', message: shipmentId },
        { field: 'crewAssignmentId', code: 'NOT_SECURED', message: crewAssignmentId },
      ],
    },
  );

/**
 * The distribution screen before mapping: the shipments as board rows, the day's vans, and per
 * shipment what the screen needs beside its row. `day` and `today` are UTC midnights.
 */
export interface DistributionView extends DayBoardView {
  day: Date;
  today: Date;
  /**
   * Round 30 — `day` is before `today`: the screen is that day's RECORD, read only. The save refuses
   * it (`resolveDay`).
   */
  past: boolean;
  /**
   * The crew rows of the day the screen lists, as van cards: the vans in van-code order, then
   * (Round 24) the rows without a van in the order they were added. Since Round 25 only the rows of
   * the «محصنة» type, and those of another type that carry one of the listed shipments
   * (`securedType` false).
   */
  vans: OperationsSecuredDistributionCrewDto[];
  /** shipment id → when the vault took it in. */
  receivedAt: Map<string, Date>;
  /**
   * Round 30 — shipment id → its packages as the vault counted them at its receipt, held or since
   * handed over (the live custody; a cancelled receipt is none). A record reads them here: the
   * vault's holdings no longer carry what left on the day's vans.
   */
  packages: Map<string, { bags: number; cartons: number; boxes: number }>;
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
   * The day a distribution request means — the day asked for, or TODAY in Cairo — and whether it
   * is PAST (before today). "Today" is Cairo's (the boards' rule): between Cairo midnight and UTC
   * midnight the two calendars name different days, and the desk works on Cairo's.
   */
  dayOf(date: Date | undefined, now: Date): { day: Date; today: Date; past: boolean } {
    const today = cairoCalendarDate(now);
    const day = date === undefined ? today : utcDay(date);
    return { day, today, past: ymdOf(day) < ymdOf(today) };
  }

  /**
   * The day a distribution WRITE means — `dayOf`'s, refused when it is past (422
   * `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`). Round 30 — «ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك
   * سجل يعنى»: a past day opens on the screen as its record (`view`), and this is what keeps it one —
   * whatever a client sends, nothing of a past day is written.
   */
  resolveDay(date: Date | undefined, now: Date): { day: Date; today: Date } {
    const { day, today, past } = this.dayOf(date, now);
    if (past) throw dayInPast(ymdOf(day), cairoYmd(now));
    return { day, today };
  }

  /**
   * THE SCREEN — the day's vans on the right, its محصنات on the left and on the vans.
   *
   * THE SHIPMENTS (`securedForDistribution`): due out on the day and not out yet — DRAFT at any stage
   * (placed now, handed over once the vault has it) or IN THE VAULT — plus the OVERDUE ones still in
   * the vault (due before TODAY: they missed their van and are still the vault's to send). Not "due
   * before the screen's day": on tomorrow's screen a shipment due today is today's load, on today's
   * van — listing it as late would propose it onto tomorrow's van and a «حفظ» would move it there.
   * Counted before they are read, against the history's cap, like every board. Ordered by delivery
   * date — the overdue first, the vault must see them first — then oldest booked.
   *
   * THE VANS: every crew row of the day, whether or not anything rides it yet — the van IS where a
   * shipment is dropped. Van cards built by the same code as the boards' (`vanCardsOf`). Since
   * Round 24 a row WITHOUT A VAN is one of them («عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها
   * محصنات»): after the vans, in the order the board added them, its card naming no van.
   *
   * Round 25 — «انا عاوز اللى يظهر اللى نوعها محصنة بس»: only the rows of the «محصنة» type
   * (`isSecuredRow`); a row of another type (or none) only while it holds the LIVE delivery leg of a
   * shipment listed here — then marked (`securedType` false), never a target of a proposal. The
   * direction's proposals look at the «محصنة» rows alone.
   *
   * Round 30 — «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك سجل
   * يعنى»: a PAST day is no longer refused — it is read as its RECORD (`past` true), and the save
   * still refuses it (`resolveDay`). Its shipments are the ones due on it, WHATEVER became of them
   * since (handed over, delivered, still in the vault, never received), and the ones whose live
   * delivery leg rides one of its crew rows (`distributionRecordFilter`); its vans are its saved
   * crew rows by the same rule as a day to come. A record proposes nothing: every
   * `directionVanIds` is empty. What it cannot show is said in the contract
   * (`OperationsSecuredDistributionDto.past`).
   */
  async view(date: Date | undefined, now: Date = new Date()): Promise<DistributionView> {
    const { day, today, past } = this.dayOf(date, now);
    const dayDoc = await operationsDayService.findByDate(day);
    // A past day's record — the shipments whose LIVE delivery leg rides a crew row of the day,
    // whatever their due day says. R30 critic: their ids alone, the secured ones only — the day's
    // daily legs are never loaded, nor sent back in the count's and the read's `$in`.
    const riding =
      past && dayDoc !== null
        ? await operationsShipmentAssignmentRepository.securedDeliveryShipmentIdsOfDay(dayDoc._id)
        : [];
    const count = past
      ? await operationsShipmentRepository.countSecuredDistributionRecord(day, riding)
      : await operationsShipmentRepository.countSecuredForDistribution(day, today);
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) {
      throw historyTooLarge(
        count,
        `${String(count)} secured shipments are due or overdue for ${ymdOf(day)} — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown`,
      );
    }
    const docs = (
      past
        ? await operationsShipmentRepository.securedDistributionRecord(day, riding)
        : await operationsShipmentRepository.securedForDistribution(day, today)
    ).sort(
      (a, b) =>
        (a.deliveryDate?.getTime() ?? 0) - (b.deliveryDate?.getTime() ?? 0) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        String(a._id).localeCompare(String(b._id)),
    );
    const ids = docs.map((d) => String(d._id));

    const [legs, securedType, types] = await Promise.all([
      operationsShipmentAssignmentRepository.findByShipments(ids),
      operationsShiftTypeRepository.findSecuredType(),
      operationsShiftTypeRepository.listAll(),
    ]);
    const securedTypeId = securedType === null ? null : String(securedType._id);
    // The rows that carry a LIVE delivery leg of a shipment on this screen — kept whatever their
    // type, so nothing placed before Round 25 (or on a row whose type changed since) vanishes.
    const carrying = new Set(
      legs.filter((leg) => leg.leg === 'delivery').map((leg) => String(leg.crewAssignmentId)),
    );
    // The SAVED crew rows of the day (Round 25: the «محصنة» ones, and the carrying ones) — the vans,
    // and (Round 24) the rows without a van, which the owner loads like a van. The rows without one
    // keep the board's order: the order they were added.
    const crewRows = (
      dayDoc === null ? [] : await operationsCrewAssignmentRepository.findForDay(dayDoc._id)
    ).filter((row) => isSecuredRow(row, securedTypeId) || carrying.has(String(row._id)));
    const securedRows = new Set(
      crewRows.filter((row) => isSecuredRow(row, securedTypeId)).map((row) => String(row._id)),
    );
    const typeNames = new Map(types.map((type) => [String(type._id), type.name] as const));
    const typeNameOf = new Map(
      crewRows.map((row) => {
        const typeId = row.shiftTypeId ?? null;
        return [String(row._id), typeId === null ? null : (typeNames.get(String(typeId)) ?? null)];
      }),
    );
    const vanless = crewRows
      .filter((row) => !hasVan(row))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          String(a._id).localeCompare(String(b._id)),
      );
    const [board, { crews }, custody, looseNumbers] = await Promise.all([
      operationsShipmentService.boardView(docs),
      operationsShipmentService.vanCardsOf([...crewRows.filter(hasVan), ...vanless]),
      vaultCustody().findMany(ids),
      // The board's own numbering of the rows without a van (all of the day's, of any type), so
      // «بدون سيارة (n)» here is the board's n although only the «محصنة» ones are listed.
      operationsShipmentService.looseNumbersOf(vanless),
    ]);
    const cards: OperationsSecuredDistributionCrewDto[] = crews.map((card) => ({
      ...card,
      securedType: securedRows.has(card.crewAssignmentId),
      shiftTypeName: typeNameOf.get(card.crewAssignmentId) ?? null,
      looseNumber:
        card.vehicleId === null ? (looseNumbers.get(card.crewAssignmentId) ?? null) : null,
    }));
    const vans = [
      ...cards.filter((card) => card.vehicleId !== null).sort(byVanCode),
      // `vanCardsOf` keeps the order given, so these stay in the order they were added.
      ...cards.filter((card) => card.vehicleId === null),
    ];
    // Proposals by direction point at the «محصنة» rows only — a kept row takes no new shipment.
    const proposable = vans.filter((van) => van.securedType);

    return {
      ...board,
      day,
      today,
      past,
      vans,
      receivedAt: new Map([...custody].map(([id, view]) => [id, view.receivedAt] as const)),
      packages: new Map(
        [...custody].map(
          ([id, view]) =>
            [id, { bags: view.bagCount, cartons: view.cartonCount, boxes: view.boxCount }] as const,
        ),
      ),
      deliveryLeg: new Map(
        legs
          .filter((leg) => leg.leg === 'delivery')
          .map((leg) => [String(leg.shipmentId), leg] as const),
      ),
      // «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى» — the one rule, from the contract, so the
      // screen and the server cannot read a direction two ways. Round 30: a past day's record
      // proposes nothing — none of it can be placed.
      directionVanIds: new Map(
        docs.map(
          (doc) =>
            [
              String(doc._id),
              past ? [] : operationsDirectionVanIds(doc.areaName, proposable),
            ] as const,
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
   * OVERDUE — «المحصنة اللى يومها هتخرج»: a shipment in the vault whose delivery day has passed
   * (before TODAY, Cairo) missed its van. Placing it on a van of the day MOVES ITS DELIVERY DATE to
   * the day, in the same transaction, because its delivery leg has to ride a crew row of its
   * delivery day (the rule every other reader of the leg relies on — the captain's day, the
   * reports, the dispatch board). That date is the one field a received محصنة may still have
   * changed (Round 10 locked the rest, `isOperationsShipmentLocked`): it is a FLOW act — the
   * shipment goes out later than planned — not an edit of anything the vault signed for. The log
   * says so (`deliveryRescheduled`). Taking an overdue shipment OFF a van moves no date.
   */
  async save(
    input: SaveSecuredDistribution,
    by: string,
    now: Date = new Date(),
  ): Promise<{ date: Date; changed: number; rescheduled: number }> {
    const { day, today } = this.resolveDay(input.date, now);
    const dayYmd = ymdOf(day);
    const todayYmd = ymdOf(today);
    const dayDoc = await operationsDayService.findByDate(day);
    // Round 25 — the «محصنة» type, read once for the whole save: a row of any other type takes no
    // NEW shipment.
    const securedType = await operationsShiftTypeRepository.findSecuredType();
    const securedTypeId = securedType === null ? null : String(securedType._id);

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
      // Late = its day has PASSED (before today), as the read lists it — not merely before the day
      // saved: a shipment due today, saved onto tomorrow's van, would leave today's van unseen.
      const overdue = shipment.status === 'inVault' && due !== null && due < todayYmd;
      if (due !== dayYmd && !overdue) {
        throw refused(
          ErrorCodes.OPERATIONS_DISTRIBUTION_NOT_ON_DAY,
          422,
          id,
          `shipment ${id} is not due on ${dayYmd} and is not an overdue one in the vault (due before ${todayYmd})`,
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
        // Round 30 (verifier) — off a van OF THE DAY saved, never another day's: an overdue one's
        // leg left on a PAST day's van belongs to that day's record (`view`), which no save changes.
        // The screen never sends this (on the day's screen such a shipment is on none of its vans);
        // only a hand-made request could. Placing it on one of the day's vans still moves it, its
        // date with it — the overdue flow.
        if (dayDoc === null || String(leg.operationsDayId) !== String(dayDoc._id)) {
          throw refused(
            ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH,
            422,
            id,
            `shipment ${id} rides a van of another day — a save of ${dayYmd} takes off only that day's`,
          );
        }
        if (isLegStarted(leg)) throw legStartedRefusal(id, 'it cannot be taken off');
        plans.push({ kind: 'remove', shipment, leg });
        continue;
      }

      // Any live crew row — a van's, or (Round 24) one without a van: «عاوز لو عربيه من غير كود
      // عادى تظهر ان اوزع عليها محصنات». The same checks below hold for both.
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
      // Round 25 — «انا عاوز اللى يظهر اللى نوعها محصنة بس»: only a row of the «محصنة» type takes a
      // محصنة. One the shipment is ALREADY on stays its (a captain switched on it, an overdue one
      // re-dated there) — the screen keeps such a row listed, so it must be able to save it.
      if (
        !isSecuredRow(crew, securedTypeId) &&
        (leg === null || String(leg.crewAssignmentId) !== change.crewAssignmentId)
      ) {
        throw rowNotSecured(id, change.crewAssignmentId);
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
      if (leg !== null && !legUnchanged && isLegStarted(leg)) {
        throw legStartedRefusal(id, 'it cannot be moved');
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
          // RETIRED, not erased — the one path that takes a leg off its van (leg-retire.ts), shared
          // with the edit that moves a shipment's delivery date off its van's day.
          await retireLeg(plan.leg, { by, at: now, session });
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
          // The row's van — null for a row without one (Round 24); given a van later on the board,
          // the row writes it onto this leg (crew.service.ts `plan`).
          vehicleId: plan.crew.vehicleId ?? null,
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
        changedShipments.add(String(entry.before.shipmentId));
        await recordLegRetired(entry.before);
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
        vehicleId: vehicleIdOf(after),
      });
    }
    return { date: day, changed: changedShipments.size, rescheduled };
  }
}

export const operationsDistributionService = new OperationsDistributionService();
