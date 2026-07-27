// HR / Recruitment — Evaluation Batches (frozen design RW8/A5). The two external-check phases
// that are performed on a GROUP of applicants at once — Security Check and Driving Test — are
// run as batches: HR selects applicants, the system generates an official PDF list plus an
// export package of their attachments, the package leaves the building, and the returned results
// are uploaded against the SAME batch and decided item by item or in bulk.
//
// A batch never becomes a second source of truth (I1): each item drives the applicant's ordinary
// per-phase evaluation record, so the decision, audit trail, event and timeline entry are the
// same ones a single decision produces. Medical Check is individual and never batched (RW9).
//
// Batches are PERMANENT: membership freezes at issue, items are voided (never removed), and the
// collection is excluded from retention purge so the complete history stays available forever.
import { z } from 'zod';
import { objectId, PaginationQuerySchema, type LocalizedString } from '../common/index.js';
import {
  BulkRequestBaseSchema,
  type PlacementDto,
  type PlacementLabelDto,
} from './hr-recruitment-workflow.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * `draft` — membership is still editable. `issued` — the package was generated and the batch left
 * the building; membership is frozen. `closed` — every item decided and HR closed it explicitly.
 * `cancelled` — abandoned with a reason; kept forever like any other batch.
 */
export const EVALUATION_BATCH_STATUSES = ['draft', 'issued', 'closed', 'cancelled'] as const;
export const EvaluationBatchStatusSchema = z.enum(EVALUATION_BATCH_STATUSES);
export type EvaluationBatchStatus = z.infer<typeof EvaluationBatchStatusSchema>;

/** Per-applicant result inside a batch. `voided` retires an item without deleting it. */
export const BATCH_ITEM_RESULTS = ['pending', 'approved', 'rejected', 'voided'] as const;
export const BatchItemResultSchema = z.enum(BATCH_ITEM_RESULTS);
export type BatchItemResult = z.infer<typeof BatchItemResultSchema>;

/** The decisions a batch item may be set to (`voided` is its own action, with a reason). */
export const BATCH_ITEM_DECISIONS = ['approved', 'rejected'] as const;
export const BatchItemDecisionSchema = z.enum(BATCH_ITEM_DECISIONS);
export type BatchItemDecision = z.infer<typeof BatchItemDecisionSchema>;

/** Generated-package build state (async, worker-side — like contract PDFs). */
export const BATCH_PACKAGE_STATUSES = ['none', 'queued', 'building', 'ready', 'failed'] as const;
export const BatchPackageStatusSchema = z.enum(BATCH_PACKAGE_STATUSES);
export type BatchPackageStatus = z.infer<typeof BatchPackageStatusSchema>;

// ── Commands ────────────────────────────────────────────────────────────────

/**
 * Draft a batch from a selection of applicants (RW17: the one bulk action that CREATES).
 * Eligibility is enforced server-side: live applicant, all interviews cleared, phase applicable,
 * no approved record at this phase, not already in an open batch of the same phase.
 */
export const CreateEvaluationBatchSchema = z
  .object({
    phaseId: objectId(),
    title: z.string().max(200).optional(),
    scheduledFor: z.coerce.date().optional(),
    expectedReturnAt: z.coerce.date().optional(),
    applicantIds: z.array(objectId()).min(1).max(500),
  })
  .strict();
export type CreateEvaluationBatch = z.infer<typeof CreateEvaluationBatchSchema>;

/** Editable batch metadata. Dates stay editable after issue (A5 — sent/returned are facts). */
export const UpdateEvaluationBatchSchema = z
  .object({
    title: z.string().max(200).optional(),
    scheduledFor: z.coerce.date().nullable().optional(),
    sentAt: z.coerce.date().nullable().optional(),
    expectedReturnAt: z.coerce.date().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateEvaluationBatch = z.infer<typeof UpdateEvaluationBatchSchema>;

/** Add applicants to a DRAFT batch (membership freezes at issue). */
export const AddBatchItemsSchema = z
  .object({ applicantIds: z.array(objectId()).min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type AddBatchItems = z.infer<typeof AddBatchItemsSchema>;

export const RemoveBatchItemSchema = z.object({ version: z.number().int().min(0) }).strict();
export type RemoveBatchItem = z.infer<typeof RemoveBatchItemSchema>;

/** Issue the batch: freeze membership, stamp the sent date, queue the package build. */
export const IssueEvaluationBatchSchema = z
  .object({ sentAt: z.coerce.date().optional(), version: z.number().int().min(0) })
  .strict();
export type IssueEvaluationBatch = z.infer<typeof IssueEvaluationBatchSchema>;

/**
 * Upload a returned result document against the batch (multipart `file`). The first upload stamps
 * `returnedAt` (A5). Multipart fields arrive as strings, so `version` is coerced.
 */
export const UploadBatchResultSchema = z
  .object({
    note: z.string().max(500).optional(),
    /** Optional: attribute this document to one applicant's item. */
    applicantId: objectId().optional(),
    returnedAt: z.coerce.date().optional(),
    version: z.coerce.number().int().min(0),
  })
  .strict();
export type UploadBatchResult = z.infer<typeof UploadBatchResultSchema>;

/** Decide ONE item; a reason is mandatory to reject. */
export const DecideBatchItemSchema = z
  .object({
    result: BatchItemDecisionSchema,
    reason: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.result !== 'rejected' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to reject a batch item',
  });
export type DecideBatchItem = z.infer<typeof DecideBatchItemSchema>;

/** Retire an item without deleting it (candidate withdrew, sent in error…). Reason mandatory. */
export const VoidBatchItemSchema = z
  .object({ reason: z.string().min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type VoidBatchItem = z.infer<typeof VoidBatchItemSchema>;

/** Bulk decide items inside one batch (RW10/I4 — per-item transaction, partial success). */
export const BULK_BATCH_ITEM_ACTIONS = ['approve', 'reject', 'void'] as const;
export const BulkBatchItemActionSchema = z.enum(BULK_BATCH_ITEM_ACTIONS);
export type BulkBatchItemAction = z.infer<typeof BulkBatchItemActionSchema>;

export const BulkBatchItemsSchema = z
  .object({
    action: BulkBatchItemActionSchema,
    /** Applicant ids — items are addressed by applicant inside their batch. */
    ids: z.array(objectId()).min(1).max(500),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.action === 'approve' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to reject or void batch items',
  });
export type BulkBatchItems = z.infer<typeof BulkBatchItemsSchema>;

export const CloseEvaluationBatchSchema = z.object({ version: z.number().int().min(0) }).strict();
export type CloseEvaluationBatch = z.infer<typeof CloseEvaluationBatchSchema>;

export const CancelEvaluationBatchSchema = z
  .object({ reason: z.string().min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type CancelEvaluationBatch = z.infer<typeof CancelEvaluationBatchSchema>;

/** Bulk over batches themselves (list-level actions). */
export const BULK_BATCH_ACTIONS = ['close', 'cancel'] as const;
export const BulkBatchActionSchema = z.enum(BULK_BATCH_ACTIONS);
export type BulkBatchAction = z.infer<typeof BulkBatchActionSchema>;

export const BulkEvaluationBatchesSchema = BulkRequestBaseSchema.extend({
  action: BulkBatchActionSchema,
}).strict();
export type BulkEvaluationBatches = z.infer<typeof BulkEvaluationBatchesSchema>;

// ── Queries ─────────────────────────────────────────────────────────────────

export const ListEvaluationBatchesQuerySchema = PaginationQuerySchema.extend({
  phaseId: objectId().optional(),
  status: EvaluationBatchStatusSchema.optional(),
  branchId: objectId().optional(),
  issuedFrom: z.coerce.date().optional(),
  issuedTo: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListEvaluationBatchesQuery = z.infer<typeof ListEvaluationBatchesQuerySchema>;

/** Applicants eligible to join a batch at a phase — the selection pool for "Generate batch". */
export const ListBatchCandidatesQuerySchema = z
  .object({
    phaseId: objectId(),
    branchId: objectId().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();
export type ListBatchCandidatesQuery = z.infer<typeof ListBatchCandidatesQuerySchema>;

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface BatchDocumentDto {
  fileId: string;
  fileName: string;
  note: string | null;
  /** Set when the document was attributed to one applicant's item. */
  applicantId: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/**
 * The generated package (RW8b): the official PDF list, the ZIP export package and the manifest.
 * Built asynchronously in the worker; when the PDF driver is disabled the batch still issues and
 * the package reports `failed` with a readable reason (print view remains the export path).
 */
export interface BatchPackageDto {
  status: BatchPackageStatus;
  listPdfFileId: string | null;
  archiveFileId: string | null;
  attachmentCount: number;
  builtAt: string | null;
  error: string | null;
}

export interface BatchItemDto {
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  /** The per-applicant evaluation record this item drives (I1 — one source of truth). */
  evaluationId: string;
  /** The placement in force when the item was added; immutable (RW4). */
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  nationalIdMasked: string | null;
  result: BatchItemResult;
  reason: string | null;
  resultFileId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface EvaluationBatchDto {
  id: string;
  code: string;
  phaseId: string;
  phaseKey: string;
  phaseName: LocalizedString;
  branchId: string | null;
  status: EvaluationBatchStatus;
  title: string | null;
  scheduledFor: string | null;
  /** A5 — when the batch physically went out. */
  sentAt: string | null;
  expectedReturnAt: string | null;
  /** A5 — when results came back (stamped by the first result upload). */
  returnedAt: string | null;
  items: BatchItemDto[];
  counts: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    voided: number;
  };
  package: BatchPackageDto;
  returnedDocuments: BatchDocumentDto[];
  issuedAt: string | null;
  issuedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** List rows never carry `items` (a batch may hold hundreds) — counts drive the table. */
export type EvaluationBatchSummaryDto = Omit<EvaluationBatchDto, 'items' | 'returnedDocuments'>;

export interface BatchCandidateDto {
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  branchId: string | null;
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  /** When the applicant became eligible for this phase (drives the queue order). */
  eligibleSince: string | null;
}

// ── Files service category (seeded at boot) ─────────────────────────────────
export const EVALUATION_BATCH_FILE_CATEGORY = 'hr-evaluation-batches';

// ── Events (ADR-008; every batch action emits one — I2) ─────────────────────

export const HrEvaluationBatchEvents = {
  BatchCreated: 'hr.evaluationBatch.created',
  /** The package build request the WORKER subscribes to (PDF + ZIP). */
  BatchGenerated: 'hr.evaluationBatch.generated',
  BatchIssued: 'hr.evaluationBatch.issued',
  BatchPackageReady: 'hr.evaluationBatch.packageReady',
  BatchPackageFailed: 'hr.evaluationBatch.packageFailed',
  /** Results came back and were uploaded against the batch. */
  BatchReturned: 'hr.evaluationBatch.returned',
  BatchClosed: 'hr.evaluationBatch.closed',
  BatchCancelled: 'hr.evaluationBatch.cancelled',
} as const;
export type HrEvaluationBatchEventName =
  (typeof HrEvaluationBatchEvents)[keyof typeof HrEvaluationBatchEvents];

export const EvaluationBatchEventPayloadV1 = z.object({
  batchId: objectId(),
  code: z.string(),
  phaseKey: z.string(),
  itemCount: z.number().int().min(0),
});

export const EvaluationBatchPackagePayloadV1 = z.object({
  batchId: objectId(),
  code: z.string(),
  listPdfFileId: objectId().optional(),
  archiveFileId: objectId().optional(),
  error: z.string().optional(),
});

export const EvaluationBatchReturnedPayloadV1 = z.object({
  batchId: objectId(),
  code: z.string(),
  phaseKey: z.string(),
  documentCount: z.number().int().min(0),
  returnedAt: z.coerce.date(),
});

// ── Notification template keys (seeded at boot by the HR module) ────────────

export const HrEvaluationBatchTemplates = {
  Issued: 'hr.evaluationBatchIssued',
  Returned: 'hr.evaluationBatchReturned',
} as const;
