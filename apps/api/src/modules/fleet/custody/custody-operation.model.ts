// «سجل العهدة» — one operation on the custody fund: «شحن العهدة» charges it, «استعاضة عهدة» brings
// a set of memos back into it, «تسوية عهدة» takes the licensing memos out of it. Each prints one of
// his Word letters, and the operation keeps everything that letter printed — the memos or the
// licensing memos as they were, the fund around it, the bracket figure, the signatures — so a
// reprint is always the paper that was signed.
//
// There is no delete and no edit of what a letter printed. A «استعاضة» alone moves on once: it is
// recorded `held` (its money not in the fund yet), then «تأكيد التحويل» makes it `done` on the day
// the money arrived (`transfer`), or it is `cancelled` (`cancellation`) and its memos are free again
// — a status, never a delete: the row, its letter and its signatures stay. Neither ever touches a
// frozen figure. A row stored before the statuses has none of the three fields and reads as `done`
// with no transfer: there is no migration, and none of the three has a schema default, so a legacy
// row read and written back never gains them. Reads still filter `isDeleted: false`.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_CUSTODY_OPERATION_KINDS,
  FLEET_CUSTODY_OPERATION_STATUSES,
  FLEET_CUSTODY_SIGN_ROLES,
  FLEET_CUSTODY_SOURCES,
  FLEET_LICENSE_EXPENSE_KINDS,
  type FleetCustodyCancellationDto,
  type FleetCustodyOperationKind,
  type FleetCustodyOperationStatus,
  type FleetCustodySignRole,
  type FleetCustodySource,
  type FleetCustodyTransferDto,
  type FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** A memo as the replenishment brought it back. */
export interface FleetCustodyOperationMemoDoc {
  memoId: Types.ObjectId;
  no: number;
  kind: FleetCustodySource;
  name: string;
  from: Date;
  to: Date;
  receipts: number;
  amount: number;
}

/** A licensing memo as the settlement took it off. */
export interface FleetCustodyOperationPartDoc {
  expenseId: Types.ObjectId;
  part: FleetLicenseExpenseKind;
  /** The licensing record's day. */
  date: Date;
  cars: number;
  codes: string[];
  visaTotal: number;
  cashTotal: number;
  amount: number;
}

export interface FleetCustodyOperationSignBlockDoc {
  role: FleetCustodySignRole;
  office: string;
  name: string;
  on: boolean;
}

export interface FleetCustodyOperationSignaturesDoc {
  blocks: FleetCustodyOperationSignBlockDoc[];
  note: string;
}

/** «تأكيد التحويل»: the day the money entered the fund, and who confirmed it when. */
export interface FleetCustodyOperationTransferDoc {
  /** UTC midnight. */
  date: Date;
  reference: string;
  note: string;
  by: Types.ObjectId | null;
  /** Who confirmed, by name as it read then. */
  byName: string | null;
  at: Date;
}

/** «إلغاء الاستعاضة المعلّقة». */
export interface FleetCustodyOperationCancellationDoc {
  reason: string;
  by: Types.ObjectId | null;
  byName: string | null;
  at: Date;
}

export interface FleetCustodyOperationDoc extends BaseDocFields {
  kind: FleetCustodyOperationKind;
  /** Absent on a row from before the statuses — `operationStatusOf` reads it as `done`. */
  status?: FleetCustodyOperationStatus;
  /** A transferred replenishment's transfer; `null` or absent on the rest. */
  transfer?: FleetCustodyOperationTransferDoc | null;
  /** A cancelled replenishment's cancellation; `null` or absent on the rest. */
  cancellation?: FleetCustodyOperationCancellationDoc | null;
  /** The letter's day (UTC midnight). */
  date: Date;
  /** The period the letter names — `null` on a charge. */
  from: Date | null;
  to: Date | null;
  /** Positive, as entered (a charge) or summed (the rest); the sign is the kind's. */
  amount: number;
  /** A charge's «وذلك نظير …», stored without a leading «نظير»; '' on the rest. */
  reason: string;
  memos: FleetCustodyOperationMemoDoc[];
  parts: FleetCustodyOperationPartDoc[];
  /** «إجمالي العهدة» just before it. */
  fundBefore: number;
  /** Σ «شحن العهدة» just before it. */
  chargedTotal: number;
  /** The letter's bracket number — `chargedTotal` on a replenishment, `fundBefore` on a settle. */
  letterFigure: number | null;
  signatures: FleetCustodyOperationSignaturesDoc;
}

const memoSchema = new Schema<FleetCustodyOperationMemoDoc>(
  {
    memoId: { type: Schema.Types.ObjectId, required: true },
    no: { type: Number, required: true },
    kind: { type: String, enum: FLEET_CUSTODY_SOURCES, required: true },
    name: { type: String, default: '' },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    receipts: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const partSchema = new Schema<FleetCustodyOperationPartDoc>(
  {
    expenseId: { type: Schema.Types.ObjectId, required: true },
    part: { type: String, enum: FLEET_LICENSE_EXPENSE_KINDS, required: true },
    date: { type: Date, required: true },
    cars: { type: Number, required: true, min: 0 },
    codes: { type: [String], default: [] },
    visaTotal: { type: Number, required: true, min: 0 },
    cashTotal: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const signBlockSchema = new Schema<FleetCustodyOperationSignBlockDoc>(
  {
    role: { type: String, enum: FLEET_CUSTODY_SIGN_ROLES, required: true },
    // His spacing is kept exactly as saved — no `trim`.
    office: { type: String, default: '' },
    name: { type: String, default: '' },
    on: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const signaturesSchema = new Schema<FleetCustodyOperationSignaturesDoc>(
  {
    blocks: { type: [signBlockSchema], default: [] },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const transferSchema = new Schema<FleetCustodyOperationTransferDoc>(
  {
    date: { type: Date, required: true },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, default: null },
    byName: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const cancellationSchema = new Schema<FleetCustodyOperationCancellationDoc>(
  {
    reason: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, default: null },
    byName: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const operationSchema = new Schema<FleetCustodyOperationDoc>(
  {
    kind: { type: String, enum: FLEET_CUSTODY_OPERATION_KINDS, required: true },
    // No defaults, on purpose: every write names all three (see the header).
    status: { type: String, enum: FLEET_CUSTODY_OPERATION_STATUSES },
    transfer: { type: transferSchema },
    cancellation: { type: cancellationSchema },
    date: { type: Date, required: true },
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: '' },
    memos: { type: [memoSchema], default: [] },
    parts: { type: [partSchema], default: [] },
    fundBefore: { type: Number, required: true },
    chargedTotal: { type: Number, required: true },
    letterFigure: { type: Number, default: null },
    signatures: { type: signaturesSchema, required: true },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// The ledger walks the operations oldest first.
operationSchema.index({ date: 1, createdAt: 1 }, { name: 'ix_custody_operation_date' });
// «العملية» and the set-up's preview («the latest operation of that paper»).
operationSchema.index({ kind: 1, date: 1 }, { name: 'ix_custody_operation_kind' });
// Which replenishment brought a memo back; which settlement took a licensing memo off.
operationSchema.index({ 'memos.memoId': 1 }, { name: 'ix_custody_operation_memo' });
operationSchema.index({ 'parts.expenseId': 1 }, { name: 'ix_custody_operation_expense' });

/** An operation's status — a row from before the statuses is `done`. */
export const operationStatusOf = (
  doc: Pick<FleetCustodyOperationDoc, 'status'>,
): FleetCustodyOperationStatus => doc.status ?? 'done';

const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

/** A stored transfer as the wire carries it; `null` when there is none. */
export const transferDtoOf = (
  doc: Pick<FleetCustodyOperationDoc, 'transfer'>,
): FleetCustodyTransferDto | null =>
  doc.transfer == null
    ? null
    : {
        date: isoDay(doc.transfer.date),
        reference: doc.transfer.reference ?? '',
        note: doc.transfer.note ?? '',
        byName: doc.transfer.byName ?? null,
        at: doc.transfer.at.toISOString(),
      };

/** A stored cancellation as the wire carries it; `null` when there is none. */
export const cancellationDtoOf = (
  doc: Pick<FleetCustodyOperationDoc, 'cancellation'>,
): FleetCustodyCancellationDto | null =>
  doc.cancellation == null
    ? null
    : {
        reason: doc.cancellation.reason ?? '',
        byName: doc.cancellation.byName ?? null,
        at: doc.cancellation.at.toISOString(),
      };

export const FleetCustodyOperationModel = model<FleetCustodyOperationDoc>(
  'FleetCustodyOperation',
  operationSchema,
  'fleet_custody_operations',
);
