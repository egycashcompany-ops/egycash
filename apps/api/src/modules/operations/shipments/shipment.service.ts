// Cash shipments — the ported legacy behaviour, server-enforced.
//
// WHAT IS PARITY AND WHAT IS NORMALIZED (each normalization is a named decision from the
// discovery register, never a silent fix):
//   · Required fields on create = exactly the legacy server guard (mainBank, origin/destination
//     branch, one currency line, the date — contad_app.js:313); the secondary bank was never
//     server-checked in legacy, so it stays optional.
//   · Branch-belongs-to-bank was CLIENT-ONLY in legacy (main_ops.ejs:477 filters the datalist by
//     bank); like the crew-uniqueness rule (Q11) it moves into the domain here — for the
//     DESTINATION, whose bank legacy stored (`sec_bank`). The origin's bank was never stored and
//     is not the billed bank, so the origin carries no bank rule (see assertReferences).
//   · Edit and soft-delete are allowed in ANY status — legacy gates them on nothing but
//     `deleted_dock` (contad_app.js:481-547). PRESERVED, deliberately — with ONE exception the
//     owner asked for in Round 10: a SECURED shipment the vault has received is locked («الشاشه
//     بتاعت استلام الخزينة لما تعمل صح ميقدر حد … يعدل عليها»), see secured-lock.ts.
//   · Complete/reopen follow the observed transitions in shipment-status.ts; the legacy toggle's
//     missing state guard is Q30's approved NORMALIZE. Reopen clears the receive stamp exactly as
//     legacy does (`received_user:"", received_date:null` — :555).
//   · The creation-time captain/vehicle (leader1/car_num1) live on the ASSIGNMENT entity per the
//     approved SPLIT and arrive with that slice; until then a shipment can exist unassigned.
import {
  ErrorCodes,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES,
  OperationsEvents,
  cairoCalendarDate,
  cairoYmd,
  toMinorUnits,
  ymdOf,
  type CreateOperationsShipment,
  type ErrorCode,
  type ListOperationsShipmentsQuery,
  type OperationsDayBoardBranchDto,
  type OperationsDayBoardCrewDto,
  type OperationsDayBoardDriverDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredPickedUpBy,
  type OperationsSecuredStage,
  type OperationsShipmentLeg,
  type OperationsShipmentLogDto,
  type Paginated,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleDocumentError,
} from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import { operationsCurrencyRepository } from '../currencies/currency.repository';
import { operationsAssignmentService, resolveCrew } from '../assignments/assignment.service';
import { canTransitionShipment, reopenTarget } from './shipment-status';
import {
  crewLegOf,
  deliveryLegOf,
  isPickedUp,
  pickedUpByOf,
  securedStageOf,
} from './secured-stage';
import { assertSecuredUnlocked } from './secured-lock';
import { operationsShipmentRepository } from './shipment.repository';
import { operationsShipmentAssignmentRepository } from './shipment-assignment.repository';
import { fleetDutyAssignmentRepository, fleetVehicleRepository } from '../fleet-boundary';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { crewMembers, slotIds } from '../crew/crew-slots';
import { directoryProfileService, getDirectoryEmployees } from '../../../platform/directory';
import { vaultCustody } from '../treasury-boundary';
import { type OperationsShipmentDoc, type OperationsShipmentLine } from './shipment.model';
import { resolveShipmentReceiptCategoryId } from './shipment-files';
import {
  SHIPMENT_LOG_ENTITY,
  buildShipmentLogEntries,
  collectShipmentLogRefs,
} from './shipment-log';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipment',
  entityId: id,
});

/** The audited surface — business facts only, nothing derived. */
const snapshot = (doc: OperationsShipmentDoc) => ({
  shipmentType: doc.shipmentType,
  status: doc.status,
  mainBankId: String(doc.mainBankId),
  secondaryBankId: doc.secondaryBankId === null ? null : String(doc.secondaryBankId),
  originBranchId: String(doc.originBranchId),
  destinationBranchId: String(doc.destinationBranchId),
  areaName: doc.areaName,
  lines: doc.lines.map((l) => ({ currencyId: String(l.currencyId), amountMinor: l.amountMinor })),
  collectionDate: doc.collectionDate.toISOString(),
  deliveryDate: doc.deliveryDate === null ? null : doc.deliveryDate.toISOString(),
  serialTracked: doc.serialTracked,
  notes: doc.notes,
});

/** Q15 NORMALIZE: the identity of an operating date is the day, stored as UTC midnight. */
const utcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * TODAY, as the operating day: the Cairo calendar date of the server clock, stored the date-only
 * way (UTC midnight). Cairo, not UTC — between Cairo midnight and UTC midnight the two name
 * different days, and the desk works on Cairo's. The day board's default and the date rules
 * below read this one "today", so a shipment booked for today is on the board that opens empty.
 */
const operatingToday = (): Date => cairoCalendarDate(new Date());

/**
 * 422 for a date a person may not give a shipment — «مينفعش لما يجى يضيف شحنه يختار تاريخ فات».
 * The one detail names the field and the earliest day it may take, so the form can say so.
 */
const dateRefused = (
  code: ErrorCode,
  field: 'collectionDate' | 'deliveryDate',
  earliest: string,
  message: string,
): AppError =>
  new AppError(code, 422, message, {
    details: [{ field, code: 'MIN_DATE', message: earliest }],
  });

/**
 * A NEW date may not fall before today on the Cairo calendar. Compared as calendar days
 * ('YYYY-MM-DD' strings compare in date order): the stored value is the UTC day the client sent.
 */
const assertNotBeforeToday = (field: 'collectionDate' | 'deliveryDate', value: Date): void => {
  const today = cairoYmd(new Date());
  if (ymdOf(value) < today) {
    throw dateRefused(
      ErrorCodes.OPERATIONS_SHIPMENT_DATE_IN_PAST,
      field,
      today,
      `the ${field} ${ymdOf(value)} is before today (${today}) — a shipment cannot be booked on a day that has passed`,
    );
  }
};

/**
 * An EDITED date may not move before the day the shipment is on now — «ميقدرش يحدد يوم قبل يوم اللى
 * كانت عليه الشحنة». Later, or the same day, is always accepted: the form sends every field back.
 */
const assertNotBeforeOriginal = (
  field: 'collectionDate' | 'deliveryDate',
  next: Date,
  current: Date,
): void => {
  if (ymdOf(next) < ymdOf(current)) {
    throw dateRefused(
      ErrorCodes.OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL,
      field,
      ymdOf(current),
      `the ${field} cannot move from ${ymdOf(current)} back to ${ymdOf(next)} — only to the same day or later`,
    );
  }
};

/**
 * A secured shipment's delivery may not fall before its collection — «تاريخ التسليم تانى يوم الاستلام
 * افتراضى وممكن يغير»: the form defaults it to the next day and the person may move it, but a
 * shipment cannot go out before it was collected. The same day is accepted (collected in the
 * morning, delivered in the afternoon). The earliest day allowed is the collection day.
 */
const assertDeliveryNotBeforeCollection = (delivery: Date, collection: Date): void => {
  if (ymdOf(delivery) < ymdOf(collection)) {
    throw dateRefused(
      ErrorCodes.OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION,
      'deliveryDate',
      ymdOf(collection),
      `the deliveryDate ${ymdOf(delivery)} is before the collectionDate ${ymdOf(collection)} — a shipment cannot go out before it is collected`,
    );
  }
};

/** The UTC midnight after `day` — the exclusive end of a half-open day range. */
const nextDay = (day: Date): Date => {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

/**
 * 422 `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE` — the range holds more shipments than one history
 * screen serves. Both figures ride in the details, so the screen can say how far over it is and
 * the owner can narrow the range rather than guess.
 *
 * Exported for the two board screens without a range (the secured screen and the vault's receive
 * queue, secured.service.ts): the same cap, the same code, the same details — only the message
 * says what was too many.
 */
export const historyTooLarge = (
  count: number,
  message = `the range holds ${String(count)} shipments — at most ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS)} can be shown; narrow the dates`,
): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE,
    422,
    message,
    {
      details: [
        { field: 'count', code: 'COUNT', message: String(count) },
        { field: 'max', code: 'MAX', message: String(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) },
      ],
    },
  );

const eventPayload = (doc: OperationsShipmentDoc) => ({
  shipmentId: String(doc._id),
  shipmentType: doc.shipmentType,
  status: doc.status,
});

/** One board row before mapping: the shipment and what the board prints beside it. */
export interface DayBoardRow {
  doc: OperationsShipmentDoc;
  origin: OperationsDayBoardBranchDto | null;
  destination: OperationsDayBoardBranchDto | null;
  crew: OperationsDayBoardCrewDto | null;
  /**
   * When the captain of the board leg confirmed «تم التسليم» on the mobile app — null until he
   * has. It is the captain's fact, NOT the shipment's status: delivering never completes the
   * shipment (execution.service.ts), so the desk's own confirmation stays a separate, later step.
   */
  captainDeliveredAt: Date | null;
  /** Where a secured shipment stands (secured-stage.ts); null on a daily row. */
  securedStage: OperationsSecuredStage | null;
  /**
   * When the pickup leg's captain confirmed collecting a SECURED shipment from the bank — the
   * yellow row's moment; null on a daily row, and before he has.
   */
  captainPickedUpAt: Date | null;
  /**
   * Round 10 — who has a SECURED shipment in hand (the captain wins over the desk), and since when:
   * `captainPickedUpAt` or the shipment's `pickupConfirmedAt`. Both null on a daily row, and while
   * nobody has picked it up.
   */
  pickedUpBy: OperationsSecuredPickedUpBy | null;
  pickedUpAt: Date | null;
}

/**
 * The whole board before mapping: its rows, and who rides each van the rows ride.
 *
 * The crews are a list beside the rows, not a field on each: ten shipments on one van are ten rows
 * and ONE crew, and the van's card needs the crew once. Everything here is the full answer — the
 * controller is where a reader without `operationsCrew.view` has the crew plan taken back out.
 */
export interface DayBoardView {
  rows: DayBoardRow[];
  crews: OperationsDayBoardVehicleCrewDto[];
}

interface ShipmentRefs {
  mainBankId: string;
  secondaryBankId: string | null;
  originBranchId: string;
  destinationBranchId: string;
  currencyIds: string[];
}

/**
 * Referential integrity for the normalized joins. Legacy validated NONE of this server-side —
 * the names were free-typed strings — but "string join → ObjectId ref" is the approved
 * NORMALIZE, and a ref that points at nothing is corruption, not parity.
 */
const assertReferences = async (refs: ShipmentRefs): Promise<void> => {
  if ((await operationsBankRepository.findActiveById(refs.mainBankId)) === null) {
    throw new BusinessRuleError('unknown or inactive main bank', 'OPERATIONS_UNKNOWN_BANK');
  }
  if (
    refs.secondaryBankId !== null &&
    (await operationsBankRepository.findActiveById(refs.secondaryBankId)) === null
  ) {
    throw new BusinessRuleError('unknown or inactive secondary bank', 'OPERATIONS_UNKNOWN_BANK');
  }

  const origin = await operationsBankBranchRepository.findActiveById(refs.originBranchId);
  if (origin === null) {
    throw new BusinessRuleError('unknown or inactive origin branch', 'OPERATIONS_UNKNOWN_BRANCH');
  }
  // NO BANK RULE ON THE ORIGIN. The main bank is the bank BILLED for the shipment, and the money
  // may be collected from a branch of any bank: legacy's from-branch list followed its own
  // `fromBankSelect` (main_ops.ejs:497-499), which only DEFAULTED to the main bank (:505-517) and
  // was never posted (:420 has no `name`). The from-bank is therefore not a field at all — it is
  // the origin branch's own `bankId`. An earlier rule here required origin.bankId === mainBankId;
  // that read the shared helper at :477 as the whole story and refused real collections.

  const destination = await operationsBankBranchRepository.findActiveById(refs.destinationBranchId);
  if (destination === null) {
    throw new BusinessRuleError(
      'unknown or inactive destination branch',
      'OPERATIONS_UNKNOWN_BRANCH',
    );
  }
  // The legacy to-branch picker lists the TO-bank's branches, and the to-bank dropdown defaults
  // to the main bank (main_ops.ejs:461-503) — so the destination side is toBank ?? mainBank.
  const destinationBankId = refs.secondaryBankId ?? refs.mainBankId;
  if (String(destination.bankId) !== destinationBankId) {
    throw new BusinessRuleError(
      'destination branch does not belong to the destination bank',
      'OPERATIONS_BRANCH_BANK_MISMATCH',
    );
  }

  const unique = [...new Set(refs.currencyIds)];
  const found = await operationsCurrencyRepository.findActiveByIds(unique);
  if (found.length !== unique.length) {
    throw new BusinessRuleError('unknown or inactive currency', 'OPERATIONS_UNKNOWN_CURRENCY');
  }
};

const toLines = (lines: { currencyId: string; amount: number }[]): OperationsShipmentLine[] =>
  lines.map((line) => ({
    currencyId: new Types.ObjectId(line.currencyId),
    amountMinor: toMinorUnits(line.amount),
  }));

const oidOrNull = (id: string | null): Types.ObjectId | null =>
  id === null ? null : new Types.ObjectId(id);

/**
 * How many times a receipt photo's link is written before a run of unrelated writes on the same
 * row is reported as a conflict. One retry covers the desk's ✓; three bounds a pathological row.
 */
const RECEIPT_LINK_ATTEMPTS = 3;

class OperationsShipmentService {
  async create(input: CreateOperationsShipment, by: string): Promise<OperationsShipmentDoc> {
    // NO PAST DAY — «مينفعش لما يجى يضيف شحنه يختار تاريخ فات». This is the ONE create path: the
    // desk's form on the day board and history, and the secured register (`/operations/secured`
    // backlog), both post here, and in both a person picks the dates. So both dates a person
    // picks are held to it: the collection date, and a secured shipment's delivery date — its
    // board day, which a past one would book onto a past board. Checked first, before any
    // reference is read: a past day is wrong whatever else the form says.
    assertNotBeforeToday('collectionDate', input.collectionDate);
    if (input.deliveryDate !== null) {
      assertNotBeforeToday('deliveryDate', input.deliveryDate);
      assertDeliveryNotBeforeCollection(input.deliveryDate, input.collectionDate);
    }

    await assertReferences({
      mainBankId: input.mainBankId,
      secondaryBankId: input.secondaryBankId,
      originBranchId: input.originBranchId,
      destinationBranchId: input.destinationBranchId,
      currencyIds: input.lines.map((l) => l.currencyId),
    });

    // The crew is resolved and PROVEN before anything is written — same three checks the
    // assign-pickup endpoint makes, through the same helper, so the two paths cannot drift: the
    // row exists, it is on the collection date's operating day, and the named captain is one of
    // its captains. A shipment is never created against a crew the server would then refuse.
    const collectionDate = utcDay(input.collectionDate);
    const pickup =
      input.pickup == null
        ? null
        : {
            ...input.pickup,
            ...(await resolveCrew(
              input.pickup.crewAssignmentId,
              input.pickup.captainEmployeeId,
              collectionDate,
            )),
          };

    const doc = await operationsShipmentRepository.create(
      {
        shipmentType: input.shipmentType,
        status: 'draft',
        mainBankId: new Types.ObjectId(input.mainBankId),
        secondaryBankId: oidOrNull(input.secondaryBankId),
        originBranchId: new Types.ObjectId(input.originBranchId),
        destinationBranchId: new Types.ObjectId(input.destinationBranchId),
        areaName: input.areaName,
        lines: toLines(input.lines),
        collectionDate,
        deliveryDate: input.deliveryDate === null ? null : utcDay(input.deliveryDate),
        receiptNumber: null,
        vaultReceiptNumber: null,
        serialTracked: input.serialTracked,
        notes: input.notes,
        receivedById: null,
        receivedAt: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(OperationsEvents.ShipmentCreated, eventPayload(doc));

    // The leg is written AFTER the shipment, through the assignment service rather than beside it,
    // so the assignment's own audit, event and sequencing are the ones every other caller gets.
    //
    // Not one transaction with the create: `assignPickupLeg` opens no session, and threading one
    // through it to serve this caller would make every other caller pay for a concern it does not
    // have. The window is narrow and the failure is benign and VISIBLE — a shipment in the backlog
    // with no crew, which is exactly the state the backlog exists to show and the assign screen
    // exists to fix. Losing the shipment instead, to keep an assignment atomic, would be worse.
    if (pickup !== null) {
      await operationsAssignmentService.assignPickupLeg(
        String(doc._id),
        {
          crewAssignmentId: pickup.crewAssignmentId,
          captainEmployeeId: pickup.captainEmployeeId,
          version: 0,
        },
        by,
      );
    }
    return doc;
  }

  async list(query: ListOperationsShipmentsQuery): Promise<Paginated<OperationsShipmentDoc>> {
    const filter: FilterQuery<OperationsShipmentDoc> = {};
    if (query.shipmentType !== undefined) filter.shipmentType = query.shipmentType;
    if (query.status !== undefined) filter.status = { $in: query.status };
    if (query.mainBankId !== undefined) filter.mainBankId = query.mainBankId;
    if (query.collectionDateFrom !== undefined || query.collectionDateTo !== undefined) {
      filter.collectionDate = {
        ...(query.collectionDateFrom === undefined ? {} : { $gte: utcDay(query.collectionDateFrom) }),
        ...(query.collectionDateTo === undefined ? {} : { $lte: utcDay(query.collectionDateTo) }),
      };
    }
    return operationsShipmentRepository.listShipments({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  /**
   * The desk's working set for one day — the legacy `/main_ops` board (contad_app.js:262-268).
   *
   * WHY THIS IS AN ENDPOINT AND NOT TWO LIST CALLS. The board is a union over TWO different date
   * fields: a daily shipment belongs to the day it is COLLECTED, a secured one to the day it is
   * DELIVERED. "Which shipments does the desk work today" is a business rule, and the legacy
   * system kept its rules in the browser (discovery §8.3, §13). Answering it here is the whole
   * point of the migration; a client stitching two lists together would put the rule back.
   *
   * THE UNION, precisely:
   *   · daily   → `collectionDate` falls on the day (legacy `rec_date` exact-equality, Q15
   *               NORMALIZED to an explicit half-open day range)
   *   · secured → `deliveryDate` falls on the day, WHATEVER its stage — Round 8 dropped the legacy
   *               `status: [1,3]` filter («المحصنة اللى اليوم بتاعها فى اليوم اللى هتخرج فيه»): the
   *               row is on its day from booking on, coloured by `securedStage`
   *   · never deleted; newest created first (legacy `input_date: -1`)
   *
   * `date` defaults to TODAY, matching the legacy screen — which computed today server-side and
   * offered no date picker at all («هنشيل التاريخ لان هو هيجيب بتاعت اليوم»). Today is the CAIRO
   * day (`operatingToday`), the same today a new shipment may not be dated before. Accepting a
   * date is the one addition, and it is additive: the default answer is the legacy answer.
   */
  async dayBoard(date: Date | undefined): Promise<OperationsShipmentDoc[]> {
    const day = this.boardDay(date);
    return operationsShipmentRepository.boardInRange(day, nextDay(day), 'day');
  }

  /** The operating day a board request means: the day asked for, or today in Cairo. */
  boardDay(date: Date | undefined): Date {
    return date === undefined ? operatingToday() : utcDay(date);
  }

  /** The day board with what the legacy table printed beside each shipment (see `boardView`). */
  async dayBoardView(date: Date | undefined): Promise<DayBoardView> {
    return this.boardView(await this.dayBoard(date));
  }

  /**
   * THE SHIPMENTS HISTORY — «عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون من الى … عشان اقدر امسك
   * الhistory بتاع الشحنات»: the day board over every day from `from` to `to`, both inclusive.
   *
   * «المفروض الشاشة اللى احنا عملينها history تكون شحنات ومحصنات»: the day board's dailies, and
   * EVERY secured shipment collected or delivered in the range, whatever its stage — so a history
   * day is that day's board plus the محصنات collected on it. The same enrichment as the day board
   * (`boardView`), on purpose: a row prints the same wherever it is looked at.
   *
   * COUNTED BEFORE IT IS READ. A range holding more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS`
   * shipments is refused for the price of an index count, before a row is loaded or joined — and
   * refused, never cut short: the screen totals what it is given, and totals over a silently
   * truncated list would be wrong money figures with nothing on screen to say so.
   */
  async historyView(from: Date, to: Date): Promise<DayBoardView> {
    const first = utcDay(from);
    const toExclusive = nextDay(utcDay(to));
    const count = await operationsShipmentRepository.countBoardInRange(
      first,
      toExclusive,
      'history',
    );
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) throw historyTooLarge(count);
    return this.boardView(
      await operationsShipmentRepository.boardInRange(first, toExclusive, 'history'),
    );
  }

  /**
   * THE DELETED SHIPMENTS — «اللى اتمسح اعملى ايقون اقدر اجيب منه اللى اتمسح»: the rows deleted
   * from the boards of `from`..`to`, the history's own union over deleted rows, so each one listed
   * is a row that returns to that history when restored. Counted before it is read and capped
   * exactly as the history is; enriched exactly as board rows are (`boardView`), plus who deleted
   * each one, by name.
   */
  async deletedView(
    from: Date,
    to: Date,
  ): Promise<DayBoardView & { deletedByName: Map<string, string | null> }> {
    const first = utcDay(from);
    const toExclusive = nextDay(utcDay(to));
    const count = await operationsShipmentRepository.countDeletedBoardInRange(first, toExclusive);
    if (count > OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS) throw historyTooLarge(count);
    const docs = await operationsShipmentRepository.deletedBoardInRange(first, toExclusive);
    // The deleter is the user stamped on the row (`deletedBy`), named in ONE directory read for
    // the whole list — a handful of desk users delete, however many rows they deleted.
    const deleters = [
      ...new Set(docs.flatMap((d) => (d.deletedBy == null ? [] : [String(d.deletedBy)]))),
    ];
    const profiles = await directoryProfileService.resolve(deleters);
    const nameOf = (userId: string): string | null => {
      const name = profiles.get(userId)?.displayName;
      if (name === undefined) return null;
      return name.ar !== '' ? name.ar : name.en !== '' ? name.en : null;
    };
    const deletedByName = new Map(
      docs.map((d) => [String(d._id), d.deletedBy == null ? null : nameOf(String(d.deletedBy))]),
    );
    return { ...(await this.boardView(docs)), deletedByName };
  }

  /**
   * THE SHIPMENT'S ACTION LOG — «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة»: every recorded act
   * on one shipment, oldest first, read from the audit trail of the shipment, its legs and its
   * vault custody, and printed in names (see shipment-log.ts). A deleted shipment answers too —
   * the deleted list is where one most needs its story.
   *
   * A FIXED NUMBER OF READS, whatever the length of the story: the shipment, its legs, its
   * custody history, ONE audit read for all three entities (`trailOf`), then one read per kind of
   * name the values hold (banks, branches, currencies, people, vans).
   *
   * The legs read are the LIVE ones, through `ux_shipment_leg`: no path deletes a leg — a
   * reassignment rewrites the leg in place, and a deleted shipment keeps its legs — and the only
   * index that finds a shipment's legs is partial on `isDeleted: false`, so asking for deleted ones
   * too would scan the whole collection on every log opened, for rows that do not exist. The
   * custody is the exception since Round 10: a cancelled receipt IS a voided (soft-deleted) custody
   * row, so the treasury port's `history` reads them all, through an index of its own.
   *
   * THE VAULT'S RECORD IS THE TREASURY'S. The custody rows (receipt number, counts, seals, the two
   * receiving treasurers) are read only for a reader who `seesVault` (`operationsVault.view`, the
   * grant the vault screens and the custody's realtime topic ride). Without it the custody trail
   * is not read at all, and the shipment's own status rows still say it entered the vault and was
   * dispatched — the entries stay, only the treasury's details are left out.
   */
  async log(id: string, reader: { seesVault: boolean }): Promise<OperationsShipmentLogDto> {
    const shipment = await operationsShipmentRepository.findAnyById(id);
    if (shipment === null) throw new NotFoundError();
    const legs = await operationsShipmentAssignmentRepository.findByShipments([id]);
    // EVERY custody, a cancelled receipt included (Round 10): a receipt taken, cancelled and taken
    // again is three acts in the shipment's story, and the first receipt's details are part of it.
    const custody = reader.seesVault ? await vaultCustody().history(id) : [];
    const { rows, truncated } = await auditService.trailOf(
      'operations',
      [
        { entityType: SHIPMENT_LOG_ENTITY.shipment, entityIds: [id] },
        { entityType: SHIPMENT_LOG_ENTITY.leg, entityIds: legs.map((leg) => String(leg._id)) },
        {
          entityType: SHIPMENT_LOG_ENTITY.custody,
          entityIds: custody.map((c) => c.id),
        },
      ],
      OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES,
    );

    const refs = collectShipmentLogRefs(rows);
    const [banks, branches, currencies, people, vehicles] = await Promise.all([
      operationsBankRepository.findByIdsSystem(refs.bankIds),
      operationsBankBranchRepository.findByIdsSystem(refs.branchIds),
      operationsCurrencyRepository.findByIdsSystem(refs.currencyIds),
      getDirectoryEmployees(refs.employeeIds),
      fleetVehicleRepository.codesByIds(refs.vehicleIds),
    ]);
    const bankName = new Map(banks.map((b) => [String(b._id), b.opsName]));
    const branchName = new Map(
      branches.map((b) => [String(b._id), b.code === '' ? b.name : `${b.name} (${b.code})`]),
    );
    const currencyName = new Map(currencies.map((c) => [String(c._id), c.name]));
    const legOf = new Map<string, OperationsShipmentLeg>(
      legs.map((leg) => [String(leg._id), leg.leg]),
    );
    return {
      shipmentId: id,
      entries: buildShipmentLogEntries(rows, legOf, {
        bank: (bankId) => bankName.get(bankId) ?? null,
        branch: (branchId) => branchName.get(branchId) ?? null,
        currency: (currencyId) => currencyName.get(currencyId) ?? null,
        person: (employeeId) => people.get(employeeId)?.fullNameAr ?? null,
        vehicle: (vehicleId) => vehicles.get(vehicleId) ?? null,
      }),
      truncated,
    };
  }

  /**
   * Board rows with what the legacy table printed beside each shipment: both branches by name and
   * code with their banks, and the crew of the leg the row is about (secured-stage.ts `crewLegOf`)
   * — plus, for the hover cards, who rides each van and the captain's own card, and for a secured
   * row its stage. Shared by the day board, the history, the deleted list, the secured screen and
   * the vault's receive queue, so no screen can print a row differently from another.
   *
   * ONE READ PER KIND, never one per row: the branches, their banks, the legs, the crew rows, their
   * Fleet duty rows, the vehicle codes and every person's name are each fetched once for the whole
   * set and joined in memory. A busy day is a few hundred shipments and a history range is capped
   * at a few thousand; a per-row lookup would make either thousands of queries.
   *
   * Nothing here can fail a row. A branch, vehicle or name that no longer resolves comes back as
   * null and the screen says so — a board that refused to load because one van was scrapped would
   * be worse than a board with one blank cell.
   */
  async boardView(docs: OperationsShipmentDoc[]): Promise<DayBoardView> {
    if (docs.length === 0) return { rows: [], crews: [] };

    const branchIds = docs.flatMap((d) => [String(d.originBranchId), String(d.destinationBranchId)]);
    const branches = await operationsBankBranchRepository.findByIdsSystem(branchIds);
    const banks = await operationsBankRepository.findByIdsSystem(branches.map((b) => String(b.bankId)));
    const bankName = new Map(banks.map((b) => [String(b._id), b.opsName]));
    const branchView = new Map(
      branches.map((b) => [
        String(b._id),
        {
          id: String(b._id),
          name: b.name,
          code: b.code,
          bankId: String(b.bankId),
          bankName: bankName.get(String(b.bankId)) ?? '',
        },
      ]),
    );

    // Both legs of every row, in one read: the crew a row prints is the leg it is about now, and a
    // secured row's stage reads its pickup leg whichever leg it prints.
    const legs = await operationsShipmentAssignmentRepository.findByShipments(
      docs.map((d) => String(d._id)),
    );
    const legOf = new Map(legs.map((a) => [`${String(a.shipmentId)}:${a.leg}`, a]));
    const legFor = (doc: OperationsShipmentDoc, leg: OperationsShipmentLeg) =>
      legOf.get(`${String(doc._id)}:${leg}`) ?? null;
    const boardLeg = (doc: OperationsShipmentDoc) =>
      legFor(doc, crewLegOf(doc.shipmentType, doc.status));
    const crewed = docs.map(boardLeg).filter((a) => a !== null);

    // «لما اقف على العربيه تجيب مين اللى متعين عليها من سواقيين واخصائيين»: the van's card needs
    // the crew row each leg rides. Keyed by the leg's OWN `crewAssignmentId`, never re-found by
    // (day, vehicle): a secured leg is delivered on its delivery day while the shipment's other
    // dates can say something else, and the id is the one fact that cannot drift. The crew rows
    // are kept in the order the board first meets them, so the list reads like the board does.
    const crewIds = [...new Set(crewed.map((a) => String(a.crewAssignmentId)))];
    const crewById = new Map(
      (await operationsCrewAssignmentRepository.findByIdsSystem(crewIds))
        // `findByIdsSystem` resolves soft-deleted rows too, on purpose, for names. A crew row
        // that was taken off the plan puts nobody on the van, so it shows no crew at all.
        .filter((c) => !c.isDeleted)
        .map((c) => [String(c._id), c]),
    );
    const crewRows = crewIds.flatMap((id) => {
      const row = crewById.get(id);
      return row === undefined ? [] : [row];
    });
    // The drivers are FLEET's half of the van — the crew row anchors on the Fleet duty row for
    // the same (vehicle, day), and that row holds driver 1 and driver 2. Read through the §9.4
    // boundary, read-only, like every other Fleet fact Operations shows.
    const dutyById = new Map(
      (
        await fleetDutyAssignmentRepository.findByIdsSystem(
          crewRows.map((c) => String(c.fleetDutyAssignmentId)),
        )
      )
        .filter((d) => !d.isDeleted)
        .map((d) => [String(d._id), d]),
    );
    const driversOf = (crew: (typeof crewRows)[number]): string[] => {
      const duty = dutyById.get(String(crew.fleetDutyAssignmentId));
      if (duty === undefined) return [];
      // `!= null`, not `!== null`: a `.lean()` row hands an absent field back as `undefined`, and
      // `String(undefined)` would name a driver "undefined" (Fleet's own `snapshot` guards the same).
      return [duty.driver1EmployeeId, duty.driver2EmployeeId]
        .filter((id) => id != null)
        .map(String);
    };

    const vehicleCodes = await fleetVehicleRepository.codesByIds([
      ...new Set([
        ...crewed.map((a) => String(a.vehicleId)),
        ...crewRows.map((c) => String(c.vehicleId)),
      ]),
    ]);
    // ONE directory read for everyone the board names — the legs' captains, and the drivers,
    // captains and specialists on every van card.
    const people = await getDirectoryEmployees([
      ...new Set([
        ...crewed.map((a) => String(a.captainEmployeeId)),
        ...crewRows.flatMap((c) => [...driversOf(c), ...crewMembers(c)]),
      ]),
    ]);
    const person = (employeeId: string): OperationsDayBoardPersonDto => {
      const found = people.get(employeeId);
      return {
        employeeId,
        code: found?.code ?? null,
        fullNameAr: found?.fullNameAr ?? null,
      };
    };

    const crews: OperationsDayBoardVehicleCrewDto[] = crewRows.map((c) => ({
      crewAssignmentId: String(c._id),
      vehicleId: String(c.vehicleId),
      vehicleCode: vehicleCodes.get(String(c.vehicleId)) ?? null,
      // The driver by NAME only, built field by field so no code can ride along: a driver's
      // details are Fleet's («ما يظهرش تفاصيل عن السواقين غير للحركة بس»).
      drivers: driversOf(c).map(
        (employeeId): OperationsDayBoardDriverDto => ({
          employeeId,
          fullNameAr: people.get(employeeId)?.fullNameAr ?? null,
        }),
      ),
      captains: slotIds(c.captainEmployeeIds).map(person),
      specialist1: slotIds(c.specialist1EmployeeIds).map(person),
      specialist2: slotIds(c.specialist2EmployeeIds).map(person),
      direction: c.direction ?? null,
      plannedTime: c.plannedTime ?? null,
    }));

    const rows = docs.map((doc): DayBoardRow => {
      const leg = boardLeg(doc);
      // The captain's «تم التسليم» is the leg that reaches the DESTINATION — the pickup leg of a
      // daily shipment, the delivery leg of a secured one, whichever leg the row prints.
      // A leg that predates OP-7 has no `executionStatus` at all; it has plainly not been started
      // (the same reading as execution.service's `statusOf`). Execution only moves forward, so
      // once the leg is delivered — or completed after it — its `deliveredAt` stays the answer,
      // even if the desk later reopens the shipment.
      const delivering = legFor(doc, deliveryLegOf(doc.shipmentType));
      const execution = delivering?.executionStatus ?? 'pending';
      const captainDelivered = execution === 'delivered' || execution === 'completed';
      // A secured row's stage, and when its captain collected it — both read off the PICKUP leg,
      // and (Round 10) off the desk's own ✓ on the shipment, which counts only when he has not.
      const secured = doc.shipmentType === 'secured';
      const pickup = secured ? legFor(doc, 'pickup') : null;
      const captainPickedUpAt =
        pickup !== null && isPickedUp(pickup.executionStatus) ? (pickup.pickedUpAt ?? null) : null;
      const deskConfirmedAt = secured ? (doc.pickupConfirmedAt ?? null) : null;
      const pickedUpBy = secured ? pickedUpByOf(pickup?.executionStatus, deskConfirmedAt) : null;
      const captain = leg === null ? undefined : people.get(String(leg.captainEmployeeId));
      return {
        doc,
        captainDeliveredAt: captainDelivered ? (delivering?.deliveredAt ?? null) : null,
        securedStage: secured
          ? securedStageOf(doc.status, pickup?.executionStatus, deskConfirmedAt)
          : null,
        captainPickedUpAt,
        pickedUpBy,
        pickedUpAt:
          pickedUpBy === 'captain'
            ? captainPickedUpAt
            : pickedUpBy === 'operations'
              ? deskConfirmedAt
              : null,
        origin: branchView.get(String(doc.originBranchId)) ?? null,
        destination: branchView.get(String(doc.destinationBranchId)) ?? null,
        crew:
          leg === null
            ? null
            : {
                crewAssignmentId: String(leg.crewAssignmentId),
                vehicleId: String(leg.vehicleId),
                vehicleCode: vehicleCodes.get(String(leg.vehicleId)) ?? null,
                captainEmployeeId: String(leg.captainEmployeeId),
                captainName: captain?.fullNameAr ?? null,
                // «لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه» — the facts the Fleet
                // driver card prints, from the same directory read. The van is already above.
                captainCode: captain?.code ?? null,
                captainPhone: captain?.phone ?? null,
                captainBranchId: captain?.branchId ?? null,
              },
      };
    });
    return { rows, crews };
  }

  async getById(id: string): Promise<OperationsShipmentDoc> {
    return operationsShipmentRepository.getById(id);
  }

  async update(
    id: string,
    input: UpdateOperationsShipment,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    // Round 10 — checked before anything else: a received محصنة is not edited, whatever the edit.
    assertSecuredUnlocked(before, 'editing it');

    await assertReferences({
      mainBankId: input.mainBankId ?? String(before.mainBankId),
      secondaryBankId:
        input.secondaryBankId === undefined
          ? before.secondaryBankId === null
            ? null
            : String(before.secondaryBankId)
          : input.secondaryBankId,
      originBranchId: input.originBranchId ?? String(before.originBranchId),
      destinationBranchId: input.destinationBranchId ?? String(before.destinationBranchId),
      currencyIds:
        input.lines === undefined
          ? before.lines.map((l) => String(l.currencyId))
          : input.lines.map((l) => l.currencyId),
    });
    // A daily shipment never gains a delivery date (create-schema parity, held on update too).
    const nextDeliveryDate =
      input.deliveryDate === undefined ? before.deliveryDate : input.deliveryDate;
    if (before.shipmentType === 'daily' && nextDeliveryDate !== null) {
      throw new BusinessRuleError(
        'a daily shipment has no delivery date',
        'OPERATIONS_DAILY_HAS_NO_DELIVERY_DATE',
      );
    }
    // NEVER EARLIER THAN THE DAY IT IS ON — «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة». Edit
    // and delete stay open on the history (a past day's row may be corrected), but its date may
    // only move forward. A shipment already on a past day can keep it — the form sends every
    // field back, unchanged ones included. A delivery date the shipment never had is a fresh pick,
    // so it follows the create rule instead: not before today.
    if (input.collectionDate !== undefined) {
      assertNotBeforeOriginal('collectionDate', input.collectionDate, before.collectionDate);
    }
    if (input.deliveryDate != null) {
      if (before.deliveryDate === null) assertNotBeforeToday('deliveryDate', input.deliveryDate);
      else assertNotBeforeOriginal('deliveryDate', input.deliveryDate, before.deliveryDate);
    }
    // …and never out before it is collected, judged on the two dates the shipment would have AFTER
    // this edit. Only when the edit moves one of them: the form sends every field back, and a row
    // already stored the wrong way round (legacy never checked) must still take a notes fix.
    const nextCollectionDate = input.collectionDate ?? before.collectionDate;
    const datesMoved =
      ymdOf(nextCollectionDate) !== ymdOf(before.collectionDate) ||
      (nextDeliveryDate === null ? null : ymdOf(nextDeliveryDate)) !==
        (before.deliveryDate === null ? null : ymdOf(before.deliveryDate));
    if (datesMoved && nextDeliveryDate !== null) {
      assertDeliveryNotBeforeCollection(nextDeliveryDate, nextCollectionDate);
    }

    const set: Partial<OperationsShipmentDoc> = {};
    const { version, lines, collectionDate, deliveryDate } = input;
    const { mainBankId, secondaryBankId, originBranchId, destinationBranchId } = input;
    if (input.areaName !== undefined) set.areaName = input.areaName;
    if (input.serialTracked !== undefined) set.serialTracked = input.serialTracked;
    if (input.notes !== undefined) set.notes = input.notes;
    if (mainBankId !== undefined) set.mainBankId = new Types.ObjectId(mainBankId);
    if (secondaryBankId !== undefined) set.secondaryBankId = oidOrNull(secondaryBankId);
    if (originBranchId !== undefined) set.originBranchId = new Types.ObjectId(originBranchId);
    if (destinationBranchId !== undefined) {
      set.destinationBranchId = new Types.ObjectId(destinationBranchId);
    }
    if (lines !== undefined) set.lines = toLines(lines);
    if (collectionDate !== undefined) set.collectionDate = utcDay(collectionDate);
    if (deliveryDate !== undefined) {
      set.deliveryDate = deliveryDate === null ? null : utcDay(deliveryDate);
    }

    const updated = await operationsShipmentRepository.updateById(id, set, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(OperationsEvents.ShipmentUpdated, eventPayload(updated));
    return updated;
  }

  /**
   * The legacy main_ops "receive" (contad_app.js:562-564): stamp who/when, go terminal. The state
   * guard is the Q30 NORMALIZE — daily completes from draft; secured only from dispatched, which
   * until the vault slice lands is unreachable, and that is the honest state of the port.
   */
  async complete(id: string, version: number, by: string): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    if (!canTransitionShipment(before.shipmentType, before.status, 'completed')) {
      throw new BusinessRuleError(
        `a ${before.shipmentType} shipment cannot complete from '${before.status}'`,
        'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
      );
    }
    const updated = await operationsShipmentRepository.updateById(
      id,
      { status: 'completed', receivedById: new Types.ObjectId(by), receivedAt: new Date() },
      { by, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(OperationsEvents.ShipmentCompleted, eventPayload(updated));
    return updated;
  }

  /**
   * The legacy un-receive (contad_app.js:553-559): daily returns to draft, secured to dispatched,
   * and the receive stamp is cleared verbatim (`received_user:"", received_date:null`).
   */
  async reopen(id: string, version: number, by: string): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    const target = reopenTarget(before.shipmentType);
    if (!canTransitionShipment(before.shipmentType, before.status, target)) {
      throw new BusinessRuleError(
        `a ${before.shipmentType} shipment cannot reopen from '${before.status}'`,
        'OPERATIONS_INVALID_SHIPMENT_TRANSITION',
      );
    }
    const updated = await operationsShipmentRepository.updateById(
      id,
      { status: target, receivedById: null, receivedAt: null },
      { by, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(OperationsEvents.ShipmentReopened, eventPayload(updated));
    return updated;
  }

  // ── The receipt photo (Files owns the bytes, the row owns the link) ─────────────────────────────
  //
  // «عمود كمان لصورة الإيصال زى شاشة السيارات» — the Fleet receipts' flow, unchanged in shape. No
  // status gate on a DAILY shipment: like every other shipment edit (legacy gates edits on nothing),
  // the paper can be photographed whenever it arrives, before or after delivery. No event either, as
  // for Fleet receipts: the audit row is the record, and the board refetches on the mutation itself.
  //
  // Round 10 — a SECURED shipment the vault has received is locked here too, upload and delete
  // alike: «ميقدر حد … يعدل عليها» names no exception, and the photo is part of the record the vault
  // signed for. A photo needed after the receipt goes on through a cancelled receipt (the special
  // grant), like any other change to a locked shipment. Reading the photo is never locked.

  async setReceiptImage(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    assertSecuredUnlocked(before, 'its receipt photo');
    const current = before.receiptImage ?? null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'operations',
          entityType: 'shipment',
          entityId: id,
          categoryId: await resolveShipmentReceiptCategoryId(),
          displayName: `shipment receipt — ${before.collectionDate.toISOString().slice(0, 10)}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      // A new VERSION in the same file group, so the photo it replaces stays retrievable.
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    const updated = await this.linkReceiptImage(ctx, before, file);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'receiptImage',
          old: current === null ? null : String(current.fileId),
          new: String(file._id),
        },
      ],
    });
    return updated;
  }

  /**
   * Point the row at the file just stored — a compare-and-swap on the photo LINK, not on the row.
   *
   * The write is version-guarded, so it can lose to ANY write on the shipment, most often the desk
   * ticking it received while the photo was still being stored. When the link is still what this
   * upload saw, that other write was about something else, so the link is written again on the
   * row as it now is. Giving up there would be worse than a 409 on a REPLACE: Files has already
   * made the old photo a superseded version and never replaces one, so a row left pointing at it
   * could never take another photo.
   *
   * When the link itself moved (another upload or a delete won), this upload lost for real: what
   * it stored is a file no row points at, so it is soft-deleted and the 409 stands.
   */
  private async linkReceiptImage(
    ctx: AuthContext,
    seen: OperationsShipmentDoc,
    file: FileDoc,
  ): Promise<OperationsShipmentDoc> {
    const id = String(seen._id);
    const linked = seen.receiptImage == null ? null : String(seen.receiptImage.fileId);
    const receiptImage = {
      fileId: file._id,
      fileName: file.originalName,
      mime: file.mime,
      size: file.size,
      uploadedAt: new Date(),
    };
    let version = seen.__v;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operationsShipmentRepository.updateById(
          id,
          { receiptImage },
          { by: ctx.userId, version },
        );
      } catch (error) {
        const now =
          error instanceof StaleDocumentError
            ? await operationsShipmentRepository.findById(id)
            : null;
        const nowLinked = now?.receiptImage == null ? null : String(now.receiptImage.fileId);
        if (now !== null && nowLinked === linked && attempt < RECEIPT_LINK_ATTEMPTS) {
          version = now.__v;
          continue;
        }
        // A first upload that did not land is always an orphan. A replace is one only when the
        // row has moved off its file group; otherwise it is the group's own newest version.
        if (linked === null || (now !== null && nowLinked !== linked)) {
          await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
        }
        throw error;
      }
    }
  }

  async readReceiptImage(
    ctx: AuthContext,
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const row = await operationsShipmentRepository.getById(id);
    if (row.receiptImage == null) throw new NotFoundError('this shipment has no receipt image');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(row.receiptImage.fileId),
    );
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteReceiptImage(ctx: AuthContext, id: string): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    assertSecuredUnlocked(before, 'its receipt photo');
    if (before.receiptImage == null) {
      throw new ConflictError('this shipment has no receipt image to delete');
    }
    const fileId = String(before.receiptImage.fileId);
    const updated = await operationsShipmentRepository.updateById(
      id,
      { receiptImage: null },
      { by: ctx.userId, version: before.__v },
    );
    // The row is the truth: once it no longer points at the file, a failed soft-delete leaves an
    // unreachable file behind, never a broken row.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'receiptImage', old: fileId, new: null }],
    });
    return updated;
  }

  /**
   * Legacy delete is a soft flag with no state guard (contad_app.js:545-547) — preserved, except
   * for a SECURED shipment the vault has received (Round 10: locked, see secured-lock.ts).
   */
  async softDelete(id: string, by: string): Promise<void> {
    const before = await operationsShipmentRepository.getById(id);
    assertSecuredUnlocked(before, 'deleting it');
    await operationsShipmentRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(OperationsEvents.ShipmentDeleted, eventPayload(before));
  }

  /**
   * Bring a deleted shipment back — «اقدر اجيب منه اللى اتمسح». The delete is a plain soft flag
   * with no cascade (its legs, custody and receipt photo were never touched), so clearing the flag
   * is the whole undo: the shipment returns to its day's board and the history with its crew as it
   * was. Whoever may delete a shipment may restore it — one grant, both directions, as `complete`
   * and `reopen` share theirs.
   *
   * No state guard and no date rule, like the delete it undoes: restoring dates nothing, it puts
   * a row back on the day it was always on. Round 10's lock does not reach it either: a received
   * محصنة cannot be deleted, so any deleted shipment was deleted while it was still open.
   */
  async restore(id: string, by: string): Promise<OperationsShipmentDoc> {
    const restored = await operationsShipmentRepository.restoreById(id, { by });
    if (restored === null) {
      // Nothing deleted under that id: a live shipment is a 409 the screen can name, anything
      // else a plain 404.
      if ((await operationsShipmentRepository.findById(id)) !== null) {
        throw new ConflictError(
          'this shipment is not deleted',
          ErrorCodes.OPERATIONS_SHIPMENT_NOT_DELETED,
        );
      }
      throw new NotFoundError();
    }
    await auditService.record({ entityRef: entityRef(id), action: 'restore' });
    await emit(OperationsEvents.ShipmentRestored, eventPayload(restored));
    return restored;
  }
}

export const operationsShipmentService = new OperationsShipmentService();
