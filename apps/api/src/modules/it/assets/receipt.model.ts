// `it_custody_receipts` — the paper an employee signs for what they were handed (FR-18): the IT
// department's «إقرار استلام».
//
// One receipt per HAND-OVER, not per asset: everything handed over together is one paper under
// one number — a page per device, each signed. Each line names the custody interval it opened,
// and each interval names its receipt back (`receiptId`).
//
// The lines and the employee are a SNAPSHOT of what was printed. The receipt is the document the
// employee signed; reprinting it after the asset was edited (its specifications, its accessories)
// or the employee's title changed must reproduce that paper — not compose a different one under
// the same signature.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { assetSpecsSchema, type ItAssetSpecsSub } from './asset.model';

export interface ItCustodyReceiptLineSub {
  assetId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  assetCode: string;
  name: string;
  serialNumber: string | null;
  conditionOnIssue: string | null;
  notes: string | null;
  // The acknowledgment's own fields («إقرار استلام»). Optional in the type: receipts issued before
  // the acknowledgment replaced the item table have none, and print without them.
  /** «جهاز لاب توب» — the asset's category, as the paper names the device. */
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  /** The specifications table as it was printed. */
  specs?: ItAssetSpecsSub | null;
  /** «مشتملاته» — what was handed over with the device. */
  accessories?: string[];
}

/** The signed paper, scanned or photographed — Files owns the bytes, the receipt owns the link. */
export interface ItCustodyReceiptSignedCopySub {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

export interface ItCustodyReceiptDoc extends BaseDocFields {
  /**
   * The paper's own number (`EGYCASH-IT-F-14-0001`). Optional in the type because receipts from
   * before numbering have none until they are printed again.
   */
  formNumber?: number | null;
  employeeId: Types.ObjectId;
  employeeCode: string | null;
  employeeName: string | null;
  jobTitle: { ar: string; en: string } | null;
  /** The hand-over's own date — what the paper prints as «التاريخ». */
  issuedAt: Date;
  issuedByUserId: Types.ObjectId | null;
  /** The first line's branch — the receipt's data-scope anchor, like an interval's. */
  branchId: Types.ObjectId;
  lines: ItCustodyReceiptLineSub[];
  signedCopy: ItCustodyReceiptSignedCopySub | null;
}

const lineSchema = new Schema<ItCustodyReceiptLineSub>(
  {
    assetId: { type: Schema.Types.ObjectId, required: true },
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    assetCode: { type: String, required: true },
    name: { type: String, required: true },
    serialNumber: { type: String, default: null },
    conditionOnIssue: { type: String, default: null },
    notes: { type: String, default: null },
    deviceType: { type: String, default: null },
    manufacturer: { type: String, default: null },
    model: { type: String, default: null },
    specs: { type: assetSpecsSchema, default: null },
    accessories: { type: [String], default: [] },
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

const receiptSchema = new Schema<ItCustodyReceiptDoc>(
  {
    formNumber: { type: Number, default: null },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, default: null },
    employeeName: { type: String, default: null },
    jobTitle: {
      type: new Schema({ ar: String, en: String }, { _id: false }),
      default: null,
    },
    issuedAt: { type: Date, required: true },
    issuedByUserId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    lines: { type: [lineSchema], required: true },
    signedCopy: { type: signedCopySchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A number is on one paper only — the database holds that, not the code that happens to write it.
receiptSchema.index(
  { formNumber: 1 },
  {
    unique: true,
    name: 'ux_form_number',
    partialFilterExpression: { formNumber: { $type: 'number' } },
  },
);
// An employee's receipts, newest first — their history page.
receiptSchema.index({ employeeId: 1, issuedAt: -1 }, { name: 'ix_employee_issued' });
// The receipt an asset was handed over on.
receiptSchema.index({ 'lines.assetId': 1 }, { name: 'ix_line_asset' });

export const ItCustodyReceiptModel = model<ItCustodyReceiptDoc>(
  'ItCustodyReceipt',
  receiptSchema,
  'it_custody_receipts',
);
