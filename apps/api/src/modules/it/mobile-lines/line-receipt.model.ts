// `it_mobile_line_receipts` — the «إقرار استلام» an employee signs for a line handed to them.
//
// The department's F-14 form, with the line's facts where a device's would be, ONE line per paper.
// Its own collection rather than a row of `it_custody_receipts`, whose lines are asset-shaped
// (asset id, code, specifications) and are read as such by every device screen. The number comes
// from the SAME counter as the devices' papers — one form, one series — and since a unique index
// holds only within its own collection, the two-way guard lives in `assets/receipt-number.ts`.
//
// The signer and the line are a SNAPSHOT of what was printed: a reprint after the line's plan
// changed, or the employee's title did, reproduces the paper that was signed.
import { Schema, model, type Types } from 'mongoose';
import {
  IT_MOBILE_NETWORKS,
  IT_MOBILE_SIM_KINDS,
  type ItMobileNetwork,
  type ItMobileSimKind,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { type ItCustodyReceiptSignedCopySub } from '../assets/receipt.model';

export interface ItMobileLineReceiptLineSub {
  lineId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  network: ItMobileNetwork;
  phoneNumber: string;
  simKind: ItMobileSimKind;
  simSerial: string | null;
  ratePlan: string | null;
  accountNumber: string | null;
}

type Name = { ar: string; en: string };

export interface ItMobileLineReceiptDoc extends BaseDocFields {
  /** `EGYCASH-IT-F-14-0001` — the devices' series. Null only until a first print gives one. */
  formNumber: number | null;
  employeeId: Types.ObjectId;
  // The signer as printed — the device receipt's fields exactly (`signer(holder)`).
  employeeCode: string | null;
  employeeName: string | null;
  jobTitle: Name | null;
  /**
   * RAW, as HR stores it — the paper prints it. Leaves the API only for a caller holding
   * `itAsset.viewNationalId` (Security Architecture §3).
   */
  nationalId: string | null;
  section: Name | null;
  department: Name | null;
  /** The hand-over's own date — what the paper prints as «التاريخ». */
  issuedAt: Date;
  issuedByUserId: Types.ObjectId | null;
  /** The line's branch at the hand-over — the receipt's data-scope anchor. */
  branchId: Types.ObjectId;
  line: ItMobileLineReceiptLineSub;
  signedCopy: ItCustodyReceiptSignedCopySub | null;
}

const nameSchema = new Schema({ ar: String, en: String }, { _id: false });

const receiptLineSchema = new Schema<ItMobileLineReceiptLineSub>(
  {
    lineId: { type: Schema.Types.ObjectId, required: true },
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    network: { type: String, enum: IT_MOBILE_NETWORKS, required: true },
    phoneNumber: { type: String, required: true },
    simKind: { type: String, enum: IT_MOBILE_SIM_KINDS, required: true },
    simSerial: { type: String, default: null },
    ratePlan: { type: String, default: null },
    accountNumber: { type: String, default: null },
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

const lineReceiptSchema = new Schema<ItMobileLineReceiptDoc>(
  {
    formNumber: { type: Number, default: null },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, default: null },
    employeeName: { type: String, default: null },
    jobTitle: { type: nameSchema, default: null },
    nationalId: { type: String, default: null },
    section: { type: nameSchema, default: null },
    department: { type: nameSchema, default: null },
    issuedAt: { type: Date, required: true },
    issuedByUserId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    line: { type: receiptLineSchema, required: true },
    signedCopy: { type: signedCopySchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A number is on one line paper only. That it is not on a DEVICE paper as well is the guard in
// `assets/receipt-number.ts` — no index spans two collections.
lineReceiptSchema.index(
  { formNumber: 1 },
  {
    unique: true,
    name: 'ux_form_number',
    partialFilterExpression: { formNumber: { $type: 'number' } },
  },
);
// An employee's acknowledgments, newest first — their IT history page.
lineReceiptSchema.index({ employeeId: 1, issuedAt: -1 }, { name: 'ix_employee_issued' });
// The papers a line was handed over on.
lineReceiptSchema.index({ 'line.lineId': 1 }, { name: 'ix_line' });

export const ItMobileLineReceiptModel = model<ItMobileLineReceiptDoc>(
  'ItMobileLineReceipt',
  lineReceiptSchema,
  'it_mobile_line_receipts',
);
