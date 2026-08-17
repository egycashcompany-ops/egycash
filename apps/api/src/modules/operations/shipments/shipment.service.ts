// Cash shipments — the ported legacy behaviour, server-enforced.
//
// WHAT IS PARITY AND WHAT IS NORMALIZED (each normalization is a named decision from the
// discovery register, never a silent fix):
//   · Required fields on create = exactly the legacy server guard (mainBank, origin/destination
//     branch, one currency line, the date — contad_app.js:313); the secondary bank was never
//     server-checked in legacy, so it stays optional.
//   · Branch-belongs-to-bank was CLIENT-ONLY in legacy (main_ops.ejs:477 filters the datalist by
//     bank); like the crew-uniqueness rule (Q11) it moves into the domain here.
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
  type Paginated,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { BusinessRuleError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import { operationsCurrencyRepository } from '../currencies/currency.repository';
import { canTransitionShipment, reopenTarget } from './shipment-status';
import { operationsShipmentRepository } from './shipment.repository';
import { type OperationsShipmentDoc, type OperationsShipmentLine } from './shipment.model';

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
  // The legacy from-branch picker lists only the main bank's branches (main_ops.ejs:477).
  if (String(origin.bankId) !== refs.mainBankId) {
    throw new BusinessRuleError(
      'origin branch does not belong to the main bank',
      'OPERATIONS_BRANCH_BANK_MISMATCH',
    );
  }

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

class OperationsShipmentService {
  async create(input: CreateOperationsShipment, by: string): Promise<OperationsShipmentDoc> {
    await assertReferences({
      mainBankId: input.mainBankId,
      secondaryBankId: input.secondaryBankId,
      originBranchId: input.originBranchId,
      destinationBranchId: input.destinationBranchId,
      currencyIds: input.lines.map((l) => l.currencyId),
    });

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
        collectionDate: utcDay(input.collectionDate),
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

  /** Legacy delete is a soft flag with no state guard (contad_app.js:545-547) — preserved. */
  async softDelete(id: string, by: string): Promise<void> {
    const before = await operationsShipmentRepository.getById(id);
    await operationsShipmentRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(OperationsEvents.ShipmentDeleted, eventPayload(before));
  }
}

export const operationsShipmentService = new OperationsShipmentService();
