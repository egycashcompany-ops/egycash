// «المذكرات» — the department's custody memos: one kind each (كاوتش، وقود، صيانة، غسيل), one running
// number across all four, a set of custody receipts as its lines, and the signatures it prints
// with. Its money is never stored: a memo's total is its receipts', read live.
//
// A receipt is on at most one LIVE memo. The receipt carries the link (`fleet_receipts.memoId`),
// written with the memo in one transaction; `ux_custody_memo_receipt` is the database's own
// backstop. It is partial on `isDeleted: false`, so a deleted memo frees its receipts, and it
// works because a live memo always has at least one line — an empty array would index as a
// missing value and collide.
//
// The number is unique over EVERY memo, deleted ones included: a number is never reused.
//
// Once a «استعاضة عهدة» takes a memo (`replenishmentId`), the memo is frozen — while the replenishment
// waits for its transfer (`replenishmentHeld`) and after it: the repository's `writeConditions`
// refuses any edit or delete in the same atomic write. A cancelled replenishment frees it again.
// A memo stored before the hold has no `replenishmentHeld` and reads as not held; the field has no
// schema default, so such a memo read and written back never gains it.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_CUSTODY_SIGN_ROLES,
  FLEET_CUSTODY_SOURCES,
  type FleetCustodyPaperSignatures,
  type FleetCustodySignBlock,
  type FleetCustodySource,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetCustodyMemoLineDoc {
  receiptId: Types.ObjectId;
  /** «المأمورية» — fuel only; '' otherwise. */
  mission: string;
  /** «البيان» — maintenance only. */
  statement: string;
  /** «ملاحظات» — fuel and maintenance. */
  note: string;
}

export interface FleetCustodyMemoDoc extends BaseDocFields {
  no: number;
  kind: FleetCustodySource;
  /** «اسم المذكرة» — '' when none; shown in the app only, never printed. */
  name: string;
  /** UTC midnights, all three. */
  date: Date;
  from: Date;
  to: Date;
  lines: FleetCustodyMemoLineDoc[];
  /** The signatures it prints with — a snapshot taken at create, never refreshed. */
  signatures: FleetCustodyPaperSignatures;
  /** The «استعاضة عهدة» that took it; `null` (or absent) while pending. */
  replenishmentId: Types.ObjectId | null;
  /**
   * The day it counts from: that letter's day while the replenishment is held, the transfer's day
   * once «تأكيد التحويل» confirmed it (a replenishment from before the hold: its letter's day).
   */
  replenishedAt: Date | null;
  /** Its replenishment waits for the transfer («في انتظار التحويل»); absent or `false` otherwise. */
  replenishmentHeld?: boolean;
  /** A native `$inc` a receipt edit writes to serialise against this memo; never on a DTO. */
  lockSeq?: number;
}

const lineSchema = new Schema<FleetCustodyMemoLineDoc>(
  {
    receiptId: { type: Schema.Types.ObjectId, required: true },
    mission: { type: String, default: '' },
    statement: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false },
);

/** One signature block — his inner double spaces are kept: no `trim` here. */
export const custodySignBlockSchema = new Schema<FleetCustodySignBlock>(
  {
    role: { type: String, enum: FLEET_CUSTODY_SIGN_ROLES, required: true },
    office: { type: String, default: '' },
    name: { type: String, default: '' },
    on: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

export const custodyPaperSignaturesSchema = new Schema<FleetCustodyPaperSignatures>(
  {
    blocks: { type: [custodySignBlockSchema], default: [] },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const custodyMemoSchema = new Schema<FleetCustodyMemoDoc>(
  {
    no: { type: Number, required: true, min: 1 },
    kind: { type: String, enum: FLEET_CUSTODY_SOURCES, required: true },
    name: { type: String, default: '' },
    date: { type: Date, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    lines: { type: [lineSchema], default: [] },
    signatures: { type: custodyPaperSignaturesSchema, required: true },
    replenishmentId: { type: Schema.Types.ObjectId, default: null },
    replenishedAt: { type: Date, default: null },
    // No default, on purpose (see the header).
    replenishmentHeld: { type: Boolean },
    lockSeq: { type: Number, default: 0 },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// Never reused, even after a delete — so NOT partial.
custodyMemoSchema.index({ no: 1 }, { name: 'ux_custody_memo_no', unique: true });
// A receipt is on at most one live memo.
custodyMemoSchema.index(
  { 'lines.receiptId': 1 },
  {
    name: 'ux_custody_memo_receipt',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);
// «المذكرات» filters by kind and period.
custodyMemoSchema.index({ kind: 1, from: -1, to: -1 }, { name: 'ix_custody_memo_period' });
// A replenishment's memos, and «لم تُستعَض بعد».
custodyMemoSchema.index({ replenishmentId: 1 }, { name: 'ix_custody_memo_replenishment' });

export const FleetCustodyMemoModel = model<FleetCustodyMemoDoc>(
  'FleetCustodyMemo',
  custodyMemoSchema,
  'fleet_custody_memos',
);
