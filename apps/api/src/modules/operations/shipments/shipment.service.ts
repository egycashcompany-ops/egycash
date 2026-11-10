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
//     `deleted_dock` (contad_app.js:481-547). PRESERVED, deliberately.
//   · Complete/reopen follow the observed transitions in shipment-status.ts; the legacy toggle's
//     missing state guard is Q30's approved NORMALIZE. Reopen clears the receive stamp exactly as
//     legacy does (`received_user:"", received_date:null` — :555).
//   · The creation-time captain/vehicle (leader1/car_num1) live on the ASSIGNMENT entity per the
//     approved SPLIT and arrive with that slice; until then a shipment can exist unassigned.
import {
  OperationsEvents,
  toMinorUnits,
  type CreateOperationsShipment,
  type ListOperationsShipmentsQuery,
  type OperationsDayBoardBranchDto,
  type OperationsDayBoardCrewDto,
  type Paginated,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import {
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
import { operationsShipmentRepository } from './shipment.repository';
import { operationsShipmentAssignmentRepository } from './shipment-assignment.repository';
import { fleetVehicleRepository } from '../fleet-boundary';
import { getDirectoryEmployees } from '../../../platform/directory';
import { type OperationsShipmentDoc, type OperationsShipmentLine } from './shipment.model';
import { resolveShipmentReceiptCategoryId } from './shipment-files';

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
   * PARITY, precisely:
   *   · daily   → `collectionDate` falls on the day (legacy `rec_date` exact-equality, Q15
   *               NORMALIZED to an explicit half-open day range)
   *   · secured → `deliveryDate` falls on the day AND status ∈ {completed, dispatched}
   *               (legacy `status: [1,3]`, Q10 NORMALIZED to an explicit `$in`)
   *   · never deleted; newest created first (legacy `input_date: -1`)
   *
   * `date` defaults to TODAY, matching the legacy screen — which computed today server-side and
   * offered no date picker at all. Accepting a date is the one addition, and it is additive: the
   * default answer is the legacy answer.
   */
  async dayBoard(date: Date | undefined): Promise<OperationsShipmentDoc[]> {
    const day = utcDay(date ?? new Date());
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + 1);
    return operationsShipmentRepository.dayBoard(day, next);
  }

  /**
   * The day board with what the legacy table printed beside each shipment: both branches by name
   * and code with their banks, and the crew of the leg the shipment's type reports on.
   *
   * ONE READ PER KIND, never one per row: the branches, their banks, the legs, the vehicle codes
   * and the captains' names are each fetched once for the whole day and joined in memory. A busy
   * day is a few hundred shipments; a per-row lookup would make the board a thousand queries.
   *
   * Nothing here can fail a row. A branch, vehicle or name that no longer resolves comes back as
   * null and the screen says so — a board that refused to load because one van was scrapped would
   * be worse than a board with one blank cell.
   */
  async dayBoardView(date: Date | undefined): Promise<DayBoardRow[]> {
    const docs = await this.dayBoard(date);
    if (docs.length === 0) return [];

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

    // The leg that carries this type's crew — the same split the captain report uses.
    const legs = await operationsShipmentAssignmentRepository.findByShipments(
      docs.map((d) => String(d._id)),
    );
    const legOf = new Map(legs.map((a) => [`${String(a.shipmentId)}:${a.leg}`, a]));
    const boardLeg = (doc: OperationsShipmentDoc) =>
      legOf.get(`${String(doc._id)}:${doc.shipmentType === 'daily' ? 'pickup' : 'delivery'}`) ??
      null;
    const crewed = docs.map(boardLeg).filter((a) => a !== null);
    const vehicleCodes = await fleetVehicleRepository.codesByIds(
      [...new Set(crewed.map((a) => String(a.vehicleId)))],
    );
    const captains = await getDirectoryEmployees([
      ...new Set(crewed.map((a) => String(a.captainEmployeeId))),
    ]);

    return docs.map((doc) => {
      const leg = boardLeg(doc);
      // A leg that predates OP-7 has no `executionStatus` at all; it has plainly not been started
      // (the same reading as execution.service's `statusOf`). Execution only moves forward, so
      // once the leg is delivered — or completed after it — its `deliveredAt` stays the answer,
      // even if the desk later reopens the shipment.
      const execution = leg?.executionStatus ?? 'pending';
      const captainDelivered = execution === 'delivered' || execution === 'completed';
      return {
        doc,
        captainDeliveredAt: captainDelivered ? (leg?.deliveredAt ?? null) : null,
        origin: branchView.get(String(doc.originBranchId)) ?? null,
        destination: branchView.get(String(doc.destinationBranchId)) ?? null,
        crew:
          leg === null
            ? null
            : {
                vehicleId: String(leg.vehicleId),
                vehicleCode: vehicleCodes.get(String(leg.vehicleId)) ?? null,
                captainEmployeeId: String(leg.captainEmployeeId),
                captainName: captains.get(String(leg.captainEmployeeId))?.fullNameAr ?? null,
              },
      };
    });
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
  // status gate: like every other shipment edit (legacy gates edits on nothing), the paper can be
  // photographed whenever it arrives, before or after delivery. No event either, as for Fleet
  // receipts: the audit row is the record, and the board refetches on the mutation itself.

  async setReceiptImage(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
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

  /** Legacy delete is a soft flag with no state guard (contad_app.js:545-547) — preserved. */
  async softDelete(id: string, by: string): Promise<void> {
    const before = await operationsShipmentRepository.getById(id);
    await operationsShipmentRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(OperationsEvents.ShipmentDeleted, eventPayload(before));
  }
}

export const operationsShipmentService = new OperationsShipmentService();
