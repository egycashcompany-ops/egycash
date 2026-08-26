// The Evaluation Batch aggregate (RW8/A5) — the group form of the two external checks that are
// performed on many applicants at once: Security Check and Driving Test. HR selects applicants,
// the system generates an official PDF list plus an export package of their attachments, the
// package leaves the building, and the returned results are uploaded against the SAME batch.
//
// A batch is a COORDINATION record, never a second source of truth (I1): every item points at the
// applicant's ordinary per-phase evaluation record, and deciding an item decides that evaluation
// through the existing service — one writer, one audit trail, one event.
//
// Batches are PERMANENT: membership freezes at issue, items are voided (never removed), and the
// collection is excluded from retention purge, so the complete history stays available forever.
import { Schema, model, type Types } from 'mongoose';
import {
  BATCH_ITEM_RESULTS,
  DRIVING_TEST_GRADES,
  type DrivingTestGrade,
  BATCH_PACKAGE_STATUSES,
  EVALUATION_BATCH_STATUSES,
  type BatchItemResult,
  type BatchPackageStatus,
  type EvaluationBatchStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';
import {
  emptyPlacement,
  emptyPlacementLabel,
  placementLabelSchema,
  placementSchema,
  type StagePlacement,
  type StagePlacementLabel,
} from '../workflow/stage-fields';

export interface BatchItem {
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  /** The per-applicant evaluation record this item drives (I1). */
  evaluationId: Types.ObjectId;
  /** The placement in force when the item joined the batch; immutable (RW4). */
  placementSnapshot: StagePlacement;
  placementSnapshotLabel: StagePlacementLabel;
  nationalId: string | null;
  /**
   * What the outgoing FORMS ask for, frozen with the rest of the item (RW4).
   *
   * Snapshots, not lookups. A list that has been printed, signed and sent says what it said; an
   * address corrected next week does not retroactively change the paper somebody already holds.
   * Null on every item added before these fields existed, and on any applicant who has no value.
   */
  motherName: string | null;
  address: string | null;
  phone: string | null;
  result: BatchItemResult;
  /** The driving examiner's grade, where the phase has a scale (never a substitute for `result`). */
  grade: DrivingTestGrade | null;
  reason: string | null;
  resultFileId: Types.ObjectId | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
}

export interface BatchDocument {
  fileId: Types.ObjectId;
  fileName: string;
  note: string | null;
  /** Set when the document was attributed to one applicant's item. */
  applicantId: Types.ObjectId | null;
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
}

export interface BatchPackage {
  status: BatchPackageStatus;
  listPdfFileId: Types.ObjectId | null;
  archiveFileId: Types.ObjectId | null;
  manifestCsv: string | null;
  attachmentCount: number;
  builtAt: Date | null;
  error: string | null;
}

export interface BatchCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  voided: number;
}

export interface EvaluationBatchDoc extends BaseDocFields {
  /** Immutable batch number `SEC-{YYYY}-{seq:6}` / `DRV-{YYYY}-{seq:6}`. */
  code: string;
  phaseId: Types.ObjectId;
  phaseKey: string;
  phaseName: LocalizedString;
  /** Denormalized data scope (ADR-015) — the branch the batch was raised for. */
  branchId: Types.ObjectId | null;
  status: EvaluationBatchStatus;
  title: string | null;
  scheduledFor: Date | null;
  /** A5 — when the batch physically went out. */
  sentAt: Date | null;
  expectedReturnAt: Date | null;
  /** A5 — when results came back (stamped by the first result upload). */
  returnedAt: Date | null;
  items: BatchItem[];
  counts: BatchCounts;
  package: BatchPackage;
  returnedDocuments: BatchDocument[];
  issuedAt: Date | null;
  issuedBy: Types.ObjectId | null;
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelledReason: string | null;
}

const itemSchema = new Schema<BatchItem>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    // Deliberately not `required`: Mongoose rejects '' for a required String, which would make
    // its own default unsavable.
    applicantName: { type: String, default: '' },
    evaluationId: { type: Schema.Types.ObjectId, required: true },
    placementSnapshot: { type: placementSchema, default: emptyPlacement },
    placementSnapshotLabel: { type: placementLabelSchema, default: emptyPlacementLabel },
    nationalId: { type: String, default: null },
    motherName: { type: String, default: null },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    result: { type: String, enum: BATCH_ITEM_RESULTS, required: true, default: 'pending' },
    grade: { type: String, enum: DRIVING_TEST_GRADES, default: null },
    reason: { type: String, default: null },
    resultFileId: { type: Schema.Types.ObjectId, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
  },
  { _id: false },
);

const documentSchema = new Schema<BatchDocument>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    note: { type: String, default: null },
    applicantId: { type: Schema.Types.ObjectId, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const packageSchema = new Schema<BatchPackage>(
  {
    status: { type: String, enum: BATCH_PACKAGE_STATUSES, required: true, default: 'none' },
    listPdfFileId: { type: Schema.Types.ObjectId, default: null },
    archiveFileId: { type: Schema.Types.ObjectId, default: null },
    manifestCsv: { type: String, default: null },
    attachmentCount: { type: Number, required: true, default: 0 },
    builtAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

const countsSchema = new Schema<BatchCounts>(
  {
    total: { type: Number, required: true, default: 0 },
    pending: { type: Number, required: true, default: 0 },
    approved: { type: Number, required: true, default: 0 },
    rejected: { type: Number, required: true, default: 0 },
    voided: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

export const emptyPackage = (): BatchPackage => ({
  status: 'none',
  listPdfFileId: null,
  archiveFileId: null,
  manifestCsv: null,
  attachmentCount: 0,
  builtAt: null,
  error: null,
});

const evaluationBatchSchema = new Schema<EvaluationBatchDoc>(
  {
    code: { type: String, required: true },
    phaseId: { type: Schema.Types.ObjectId, required: true },
    phaseKey: { type: String, required: true },
    phaseName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    branchId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: EVALUATION_BATCH_STATUSES, required: true, default: 'draft' },
    title: { type: String, default: null },
    scheduledFor: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    expectedReturnAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    items: { type: [itemSchema], default: [] },
    counts: { type: countsSchema, default: () => ({}) },
    package: { type: packageSchema, default: () => ({}) },
    returnedDocuments: { type: [documentSchema], default: [] },
    issuedAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The batch number is organization-wide unique and immutable.
evaluationBatchSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
evaluationBatchSchema.index({ phaseId: 1, status: 1 }, { name: 'ix_phase_status' });
evaluationBatchSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
evaluationBatchSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
// "Is this applicant already in an open batch of this phase?" — the eligibility guard.
evaluationBatchSchema.index({ 'items.applicantId': 1, phaseId: 1 }, { name: 'ix_item_applicant_phase' });

export const EvaluationBatchModel = model<EvaluationBatchDoc>(
  'EvaluationBatch',
  evaluationBatchSchema,
  'hr_evaluation_batches',
);
