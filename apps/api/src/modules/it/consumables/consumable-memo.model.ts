// `it_consumable_memos` — «مذكرة صرف مستهلكات», the paper an employee signs for what they are
// issued («وأتبدل لمين واطبعله مذكره»). ONE per issue action, listing every item that action gave.
//
// On the device acknowledgment's letterhead, with a numbered series of its own («EGYCASH-IT-CON-
// 0001», `consumableMemo:global`) — the plan the owner approved — not the F-14 series: an F-14
// paper undertakes to give back what it lists («وأتعهد برده إلى الشركة متى طلب مني ذلك»), and a
// consumable is used up, not handed back. Its own collection for the same reason the line papers
// have theirs: the device receipts' rows are asset-shaped, and every device screen reads them so.
//
// What it prints is a SNAPSHOT: the employee as HR named them that day (code, name, job title — no
// national ID on this paper), who issued it, and each item's code, name, type, unit, quantity,
// reason and the asset it went on. A reprint after an item is renamed, or a person's title
// changes, reproduces the paper that was signed.
//
// It names a person, and the workforce reset PURGES it, as it does the device and line papers —
// the ledger rows that point at it then offer no paper (`it.mappers.ts`, the lines' `paperOf`).
import { Schema, model, type Types } from 'mongoose';
import { IT_CONSUMABLE_ISSUE_REASONS, type ItConsumableIssueReason } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { type ItCustodyReceiptSignedCopySub } from '../assets/receipt.model';

type Name = { ar: string; en: string };

/** One row of the memo's table — the item as it was when the paper was written. */
export interface ItConsumableMemoLineSub {
  consumableId: Types.ObjectId;
  /** The `issued` movement this row is — one movement, one row. */
  movementId: Types.ObjectId;
  code: string;
  name: string;
  typeName: Name | null;
  unit: string;
  qty: number;
  reason: ItConsumableIssueReason;
  /** «مركّب على» — the asset it was installed on, as the register named it that day. */
  assetId: Types.ObjectId | null;
  assetCode: string | null;
  assetName: string | null;
}

export interface ItConsumableMemoDoc extends BaseDocFields {
  /** The paper's own series — reserved inside the issue's transaction, so a rollback leaves no gap. */
  memoNumber: number;
  /** The issue's own date — what the paper prints. */
  issuedAt: Date;
  employeeId: Types.ObjectId;
  // The signer as printed: «أقر أنا / [الاسم] بوظيفة [الوظيفة] كود [الكود]».
  employeeCode: string | null;
  employeeName: string | null;
  jobTitle: Name | null;
  issuedByUserId: Types.ObjectId | null;
  /** «مسؤول تكنولوجيا المعلومات» — the issuer's name as the paper prints it. */
  issuedByName: string | null;
  /** The store the items came from — the memo's read scope. */
  branchId: Types.ObjectId;
  lines: ItConsumableMemoLineSub[];
  notes: string | null;
  signedCopy: ItCustodyReceiptSignedCopySub | null;
}

const nameSchema = new Schema({ ar: String, en: String }, { _id: false });

const memoLineSchema = new Schema<ItConsumableMemoLineSub>(
  {
    consumableId: { type: Schema.Types.ObjectId, required: true },
    movementId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    typeName: { type: nameSchema, default: null },
    unit: { type: String, required: true },
    qty: { type: Number, required: true },
    reason: { type: String, enum: IT_CONSUMABLE_ISSUE_REASONS, required: true },
    assetId: { type: Schema.Types.ObjectId, default: null },
    assetCode: { type: String, default: null },
    assetName: { type: String, default: null },
  },
  { _id: false },
);

const signedCopySchema = new Schema<ItCustodyReceiptSignedCopySub>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const memoSchema = new Schema<ItConsumableMemoDoc>(
  {
    memoNumber: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, default: null },
    employeeName: { type: String, default: null },
    jobTitle: { type: nameSchema, default: null },
    issuedByUserId: { type: Schema.Types.ObjectId, default: null },
    issuedByName: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    lines: { type: [memoLineSchema], required: true },
    notes: { type: String, default: null },
    signedCopy: { type: signedCopySchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A number is on one memo only — the paper's series, held by the database rather than by care.
memoSchema.index(
  { memoNumber: 1 },
  {
    unique: true,
    name: 'ux_memo_number',
    partialFilterExpression: { memoNumber: { $type: 'number' } },
  },
);
// An employee's memos, newest first — their IT history page.
memoSchema.index({ employeeId: 1, issuedAt: -1 }, { name: 'ix_employee_issued' });
// A store's memos, newest first.
memoSchema.index({ branchId: 1, issuedAt: -1 }, { name: 'ix_branch_issued' });

export const ItConsumableMemoModel = model<ItConsumableMemoDoc>(
  'ItConsumableMemo',
  memoSchema,
  'it_consumable_memos',
);
