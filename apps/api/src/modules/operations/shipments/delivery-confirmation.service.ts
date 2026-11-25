// «الشحنات المسلَّمة» — Round 33 B. The owner: «وعاوز اعمل شاشة جديدة زى شاشةاليوم التشغيلى بس يظهر بس
// اللى اتسلمت سواء يومى او كانت محصنة ف الخونة واسلمت ل بنك هتظهرلى لما تكون تم التسليم بس الاجراءات
// هيكون فيه علامة صح لما ادوس عليها لازم يكون فيه رقم الايصال ويفضل الصورة تكون مرفوعه و يحدد البنك من
// او الى اللى هيتحسب عليه تكلفة نقل الشحنة».
//
// THE READ: one Cairo day of deliveries — the shipments whose captain confirmed «تم التسليم» at the
// DESTINATION within that day (`captainDeliveredAt`, read the one way every board reads it —
// delivered.ts), and that reached their bank by the contract's rule (a محصنة out of the vault). The
// rows are the day board's own rows (`boardView`), so a shipment prints here exactly as it prints
// there; beside each, its delivery confirmation.
//
// THE ✓ AND ITS UNDO: «الشاشة الجديدة حاجاتها لوحدها» — the shipment's `deliveryConfirmation` and
// nothing else. The day board's ✓ (`complete` / `reopen`: the status and its receive stamp) is
// another act and is never touched here, and so are the billed main bank, the secondary bank and the
// legacy receipt numbers. A محصنة the vault signed for is LOCKED for edits (Round 10); this is not
// an edit of what the vault signed for but a flow act after it, like the dispatch — so the lock does
// not refuse it. Who confirmed is the token's user; the bank billed is read by the server from the
// branch on the side chosen, never sent by the client.
import {
  ErrorCodes,
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX,
  OperationsEvents,
  addDaysYmd,
  cairoDayStart,
  cairoYmd,
  deliveryReceiptNumberProblem,
  isOperationsShipmentDeliveredToBank,
  type ConfirmOperationsDelivery,
  type ErrorCode,
  type OperationsDeliveryBilledSide,
  type OperationsDeliveryConfirmationDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { AppError, BusinessRuleError, ConflictError } from '../../../shared/errors';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import { userDisplayNames } from '../user-names';
import { isDeliveredToBank } from './delivered';
import { deliveryLegOf } from './secured-stage';
import { operationsShipmentAssignmentRepository } from './shipment-assignment.repository';
import {
  type OperationsShipmentDeliveryConfirmation,
  type OperationsShipmentDoc,
} from './shipment.model';
import { operationsShipmentRepository } from './shipment.repository';
import { operationsShipmentService, type DayBoardView } from './shipment.service';

const shipmentRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shipment',
  entityId: id,
});

/**
 * The confirmation as its audit row records it — the fields «السجل» prints (`deliveryReceiptNumber`,
 * `billedBank` — shipment-log.ts), plus the side and the branch for the record. The person and the
 * instant are the audit row's own actor and time.
 */
const confirmationChanges = (
  from: OperationsShipmentDeliveryConfirmation | null,
  to: OperationsShipmentDeliveryConfirmation | null,
) => [
  {
    field: 'deliveryReceiptNumber',
    old: from?.receiptNumber ?? null,
    new: to?.receiptNumber ?? null,
  },
  {
    field: 'deliveryBilledBankId',
    old: from === null ? null : String(from.billedBankId),
    new: to === null ? null : String(to.billedBankId),
  },
  { field: 'deliveryBilledSide', old: from?.billedSide ?? null, new: to?.billedSide ?? null },
  {
    field: 'deliveryBilledBranchId',
    old: from === null ? null : String(from.billedBranchId),
    new: to === null ? null : String(to.billedBranchId),
  },
];

const eventPayload = (
  doc: OperationsShipmentDoc,
  record: OperationsShipmentDeliveryConfirmation,
) => ({
  shipmentId: String(doc._id),
  shipmentType: doc.shipmentType,
  status: doc.status,
  receiptNumber: record.receiptNumber,
  billedSide: record.billedSide,
  billedBankId: String(record.billedBankId),
});

/**
 * A refusal of the ✓'s input — 422 with ONE detail naming its box (`field`), so the dialog can mark
 * it: `code` REQUIRED or MAX_LENGTH, `message` the most allowed for the second.
 */
const inputRefused = (
  code: ErrorCode,
  field: 'receiptNumber' | 'billedSide',
  detail: 'REQUIRED' | 'MAX_LENGTH',
  message: string,
): AppError =>
  new AppError(code, 422, message, {
    details: [
      {
        field,
        code: detail,
        message: detail === 'MAX_LENGTH' ? String(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX) : message,
      },
    ],
  });

/** A stored confirmation's record (a lean row) — absent and null alike are "none". */
const recordOf = (doc: OperationsShipmentDoc): OperationsShipmentDeliveryConfirmation | null =>
  doc.deliveryConfirmation ?? null;

/** The board's rows of one Cairo day of deliveries, with each row's confirmation. */
export interface DeliveredBoardView extends DayBoardView {
  /** The Cairo day answered. */
  date: string;
}

class OperationsDeliveryConfirmationService {
  /** The Cairo day a request means: the one asked for, or today in Cairo. */
  dayOf(date: string | undefined): string {
    return date ?? cairoYmd(new Date());
  }

  /**
   * The shipments DELIVERED TO THEIR BANK on the Cairo day `ymd`, oldest delivery first.
   *
   * THREE READS before the board's own: the legs delivered in the day (`ix_delivered_at_live`),
   * their live shipments, then `boardView` over the ones whose DESTINATION leg it is (a secured
   * shipment's pickup leg delivers into the vault, never to a bank). The rows are kept by the
   * contract's rule on the row `boardView` built — the very `captainDeliveredAt` the day board
   * prints — and by the day again, so a leg delivered in the day but read on another shipment's leg
   * can never slip a row in. The van cards are the kept rows' alone.
   */
  async deliveredView(ymd: string): Promise<DeliveredBoardView> {
    const from = cairoDayStart(ymd);
    const before = cairoDayStart(addDaysYmd(ymd, 1));
    const legs = await operationsShipmentAssignmentRepository.deliveredBetween(from, before);
    const legsOf = new Map<string, Set<string>>();
    for (const leg of legs) {
      const id = String(leg.shipmentId);
      legsOf.set(id, (legsOf.get(id) ?? new Set()).add(leg.leg));
    }
    const docs = (await operationsShipmentRepository.findByIds([...legsOf.keys()])).filter((doc) =>
      legsOf.get(String(doc._id))?.has(deliveryLegOf(doc.shipmentType)),
    );
    const view = await operationsShipmentService.boardView(docs);
    const inDay = (at: Date): boolean => at.getTime() >= from.getTime() && at < before;
    const rows = view.rows
      .filter(
        (row) =>
          row.captainDeliveredAt !== null &&
          inDay(row.captainDeliveredAt) &&
          isOperationsShipmentDeliveredToBank({
            shipmentType: row.doc.shipmentType,
            status: row.doc.status,
            captainDeliveredAt: row.captainDeliveredAt,
          }),
      )
      .sort(
        (a, b) =>
          (a.captainDeliveredAt?.getTime() ?? 0) - (b.captainDeliveredAt?.getTime() ?? 0) ||
          String(a.doc._id).localeCompare(String(b.doc._id)),
      );
    const ridden = new Set(
      rows.flatMap((row) => (row.crew === null ? [] : [row.crew.crewAssignmentId])),
    );
    return {
      date: ymd,
      rows,
      crews: view.crews.filter((crew) => ridden.has(crew.crewAssignmentId)),
    };
  }

  /**
   * Each shipment's confirmation as the screen prints it — the bank by its operational name, the
   * person by the directory. One read of the banks and one of the people for the whole set.
   */
  async confirmationsOf(
    docs: readonly OperationsShipmentDoc[],
  ): Promise<Map<string, OperationsDeliveryConfirmationDto>> {
    const records = docs.flatMap((doc) => {
      const record = recordOf(doc);
      return record === null ? [] : [{ id: String(doc._id), record }];
    });
    if (records.length === 0) return new Map();
    const [banks, people] = await Promise.all([
      operationsBankRepository.findByIdsSystem(
        records.map(({ record }) => String(record.billedBankId)),
      ),
      userDisplayNames(records.map(({ record }) => String(record.confirmedById))),
    ]);
    const bankName = new Map(banks.map((bank) => [String(bank._id), bank.opsName]));
    return new Map(
      records.map(({ id, record }) => [
        id,
        {
          receiptNumber: record.receiptNumber,
          billedSide: record.billedSide,
          billedBranchId: String(record.billedBranchId),
          billedBankId: String(record.billedBankId),
          billedBankName: bankName.get(String(record.billedBankId)) ?? '',
          confirmedById: String(record.confirmedById),
          confirmedByName: people.get(String(record.confirmedById)) ?? null,
          confirmedAt: new Date(record.confirmedAt).toISOString(),
        },
      ]),
    );
  }

  /**
   * THE ✓ — «لازم يكون فيه رقم الايصال … و يحدد البنك من او الى اللى هيتحسب عليه تكلفة نقل الشحنة».
   *
   * In the order that gives the truest reason: the shipment (404 deleted or unknown), the input the
   * person typed (422, the box named), whether it reached its bank (409), whether it is confirmed
   * already (409), then the write under the version the screen read (409 stale). The bank billed is
   * the branch's on the side chosen, read now — the shipment's `mainBankId` is not consulted and not
   * written: «الشاشة الجديدة حاجاتها لوحدها».
   */
  async confirm(
    id: string,
    input: ConfirmOperationsDelivery,
    by: string,
  ): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    const problem = deliveryReceiptNumberProblem(input.receiptNumber);
    if (problem === 'required') {
      throw inputRefused(
        ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED,
        'receiptNumber',
        'REQUIRED',
        'the receipt number is required to confirm a delivery',
      );
    }
    if (problem === 'tooLong') {
      throw inputRefused(
        ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG,
        'receiptNumber',
        'MAX_LENGTH',
        `the receipt number is longer than ${String(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX)} characters`,
      );
    }
    const side: OperationsDeliveryBilledSide | null = input.billedSide ?? null;
    if (side === null) {
      throw inputRefused(
        ErrorCodes.OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED,
        'billedSide',
        'REQUIRED',
        'choose whose bank is billed for moving the shipment — the origin branch’s or the destination’s',
      );
    }
    if (!(await isDeliveredToBank(before))) {
      throw new ConflictError(
        before.shipmentType === 'secured'
          ? 'this secured shipment has not been delivered to its bank yet — it is confirmed once its delivery captain has delivered it'
          : 'this shipment has not been delivered yet — its crew captain has not confirmed delivering it',
        ErrorCodes.OPERATIONS_SHIPMENT_NOT_DELIVERED,
      );
    }
    if (recordOf(before) !== null) {
      throw new ConflictError(
        'this delivery is already confirmed',
        ErrorCodes.OPERATIONS_DELIVERY_ALREADY_CONFIRMED,
      );
    }
    const branchId = String(side === 'origin' ? before.originBranchId : before.destinationBranchId);
    // `findByIdsSystem` reads a branch retired since too: the bank billed is the bank the branch
    // belongs to, retired or not. Only a branch record that no longer exists at all is refused.
    const [branch] = await operationsBankBranchRepository.findByIdsSystem([branchId]);
    if (branch === undefined) {
      throw new BusinessRuleError(
        `the ${side} branch of this shipment no longer exists — its bank cannot be billed`,
        'OPERATIONS_UNKNOWN_BRANCH',
      );
    }
    const record: OperationsShipmentDeliveryConfirmation = {
      receiptNumber: (input.receiptNumber ?? '').trim(),
      billedSide: side,
      billedBranchId: new Types.ObjectId(branchId),
      billedBankId: new Types.ObjectId(String(branch.bankId)),
      confirmedById: new Types.ObjectId(by),
      confirmedAt: new Date(),
    };
    const updated = await operationsShipmentRepository.updateById(
      id,
      { deliveryConfirmation: record },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: shipmentRef(id),
      action: 'update',
      changes: confirmationChanges(null, record),
    });
    await emit(OperationsEvents.ShipmentDeliveryConfirmed, eventPayload(updated, record));
    return updated;
  }

  /**
   * «إلغاء التأكيد» — the confirmation cleared to an explicit null, on the same grant as the ✓ (the
   * `complete` / `reopen` precedent). Nothing else moves: the receipt photo stays, the row goes back
   * to «تم التسليم» awaiting its ✓.
   */
  async undo(id: string, version: number, by: string): Promise<OperationsShipmentDoc> {
    const before = await operationsShipmentRepository.getById(id);
    const current = recordOf(before);
    if (current === null) {
      throw new ConflictError(
        'this delivery is not confirmed — there is no confirmation to take back',
        ErrorCodes.OPERATIONS_DELIVERY_NOT_CONFIRMED,
      );
    }
    const updated = await operationsShipmentRepository.updateById(
      id,
      { deliveryConfirmation: null },
      { by, version },
    );
    await auditService.record({
      entityRef: shipmentRef(id),
      action: 'update',
      changes: confirmationChanges(current, null),
    });
    await emit(OperationsEvents.ShipmentDeliveryUnconfirmed, eventPayload(updated, current));
    return updated;
  }
}

export const operationsDeliveryConfirmationService = new OperationsDeliveryConfirmationService();
