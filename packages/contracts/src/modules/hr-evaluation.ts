// HR / Recruitment — Evaluation Phases. The post-interview, file-based approval checks
// (Security Check, Medical Examination, Driving Test, …). The set of phases is an
// ADMINISTRATOR-CONFIGURABLE ordered catalog — new phases are added with no code changes, exactly
// like the interview-stage catalog. The phases are INDEPENDENT (RW6) — an applicant who has
// cleared the interview rounds may be worked through any applicable phase in any order; each
// phase collects one or more files and carries an approved/rejected decision with a reason. The
// decision stays EDITABLE. A rejection at any phase removes the applicant from the active
// pipeline (mirrors a failed interview round).
import { z } from 'zod';
import { objectId, LocalizedStringSchema, PaginationQuerySchema, type LocalizedString } from '../common/index.js';
import {
  BulkRequestBaseSchema,
  type AttemptMarkerDto,
  type PlacementDto,
  type PlacementLabelDto,
} from './hr-recruitment-workflow.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * The evaluation's single status enum (I10/I11). Every value is PERSISTED: one record per
 * applicable phase is materialized in `waiting` the moment the candidate clears the interviews,
 * so a phase queue is real rows and never the absence of one. `waiting` lasts until decided;
 * `approved` clears the phase; `rejected` removes the applicant from the pipeline. The phase
 * page's three tabs, the list filter and the counter buckets all use these exact values.
 *
 * `waiting` replaced the former `pending` (I10); stored values are rewritten by the boot
 * migration and `pending` is still accepted as a query alias for one release.
 */
/**
 * `cancelled` is the terminal state a still-`waiting` phase reaches when the CANDIDATE leaves the
 * pipeline (I14) — never a decision, which stays `approved` / `rejected`. It is what keeps a
 * departed candidate out of the queue through the status itself rather than a lifecycle mirror
 * (I1/I10).
 */
export const EVALUATION_STATUSES = ['waiting', 'approved', 'rejected', 'cancelled'] as const;
export const EvaluationStatusSchema = z.enum(EVALUATION_STATUSES);
export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

/** The two terminal decisions a phase may be (re-)set to. */
export const EVALUATION_DECISIONS = ['approved', 'rejected'] as const;
export const EvaluationDecisionSchema = z.enum(EVALUATION_DECISIONS);
export type EvaluationDecision = z.infer<typeof EvaluationDecisionSchema>;

/**
 * How a phase is worked (RW6). `batch` phases (Security Check, Driving Test) are run over a group
 * of applicants at once and expose the batch surface; `individual` phases (Medical Check) are
 * always per-applicant and never generate a batch (RW9).
 */
export const EVALUATION_PHASE_KINDS = ['batch', 'individual'] as const;
export const EvaluationPhaseKindSchema = z.enum(EVALUATION_PHASE_KINDS);
export type EvaluationPhaseKind = z.infer<typeof EvaluationPhaseKindSchema>;

/** Who a phase applies to. Replaces the `driversOnly` flag, which is kept as a read alias. */
export const EVALUATION_APPLICABILITIES = ['all', 'driversOnly'] as const;
export const EvaluationApplicabilitySchema = z.enum(EVALUATION_APPLICABILITIES);
export type EvaluationApplicability = z.infer<typeof EvaluationApplicabilitySchema>;

/**
 * The permission resource a phase is gated by (RW7). The three shipped phases have their own
 * resources; admin-created phases fall back to the generic `evaluation` resource. Holding the
 * generic `evaluation.view`/`evaluation.manage` grant satisfies ANY phase (compatibility superset),
 * so no role migration is needed when this ships.
 */
export const EVALUATION_PERMISSION_RESOURCES = [
  'evaluation',
  'securityCheck',
  'drivingTest',
  'medicalCheck',
] as const;
export const EvaluationPermissionResourceSchema = z.enum(EVALUATION_PERMISSION_RESOURCES);
export type EvaluationPermissionResource = z.infer<typeof EvaluationPermissionResourceSchema>;

// ── Evaluation-phase catalog (admin-configurable) ───────────────────────────

export const CreateEvaluationPhaseSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    /**
     * 1-based DISPLAY position. Since phases are independent (RW6), order no longer gates
     * anything — it only decides the sequence of the flat navigation and the phase pages.
     */
    order: z.number().int().min(1).max(50),
    /** Advisory flag: this phase is only relevant to driver applicants (e.g. Driving Test). */
    driversOnly: z.boolean().default(false),
    kind: EvaluationPhaseKindSchema.default('individual'),
    applicability: EvaluationApplicabilitySchema.optional(),
    permissionResource: EvaluationPermissionResourceSchema.default('evaluation'),
    /** The phase records an appointment date on each applicant's record (e.g. Medical). */
    appointmentEnabled: z.boolean().default(false),
    /** Approval is blocked until a result document is attached. */
    requiresResultDocument: z.boolean().default(false),
  })
  .strict();
export type CreateEvaluationPhase = z.infer<typeof CreateEvaluationPhaseSchema>;

export const UpdateEvaluationPhaseSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    order: z.number().int().min(1).max(50).optional(),
    active: z.boolean().optional(),
    driversOnly: z.boolean().optional(),
    kind: EvaluationPhaseKindSchema.optional(),
    applicability: EvaluationApplicabilitySchema.optional(),
    permissionResource: EvaluationPermissionResourceSchema.optional(),
    appointmentEnabled: z.boolean().optional(),
    requiresResultDocument: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateEvaluationPhase = z.infer<typeof UpdateEvaluationPhaseSchema>;

export const ListEvaluationPhasesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  kind: EvaluationPhaseKindSchema.optional(),
}).strict();
export type ListEvaluationPhasesQuery = z.infer<typeof ListEvaluationPhasesQuerySchema>;

export interface EvaluationPhaseDto {
  id: string;
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
  /** Read alias of `applicability === 'driversOnly'`; kept for backward compatibility. */
  driversOnly: boolean;
  kind: EvaluationPhaseKind;
  applicability: EvaluationApplicability;
  permissionResource: EvaluationPermissionResource;
  appointmentEnabled: boolean;
  requiresResultDocument: boolean;
  /** The client route this phase's page lives at — `/evaluations/phase/<key>`. */
  route: string;
  version: number;
}

// ── Per-applicant evaluation records ────────────────────────────────────────

/**
 * Open an evaluation for an applicant at a phase. Records are materialized at `waiting` when the
 * candidate clears the interviews (I11), so this is a find-or-create retained for the manual path
 * and for phases that become applicable later. Idempotent per (applicant, phase, attempt).
 */
export const OpenEvaluationSchema = z
  .object({ applicantId: objectId(), phaseId: objectId() })
  .strict();
export type OpenEvaluation = z.infer<typeof OpenEvaluationSchema>;

/**
 * Approve or reject an evaluation. A reason is required to reject. The decision is re-settable
 * (a later correction re-decides the same record), so `approved` is not terminal for editing.
 */
export const DecideEvaluationSchema = z
  .object({
    decision: EvaluationDecisionSchema,
    reason: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.decision !== 'rejected' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to reject an evaluation',
  });
export type DecideEvaluation = z.infer<typeof DecideEvaluationSchema>;

/** Attach an uploaded file (multipart `file` field). The body carries an optional note + version.
 *  Multipart fields arrive as strings, so `version` is coerced. */
export const UploadEvaluationFileSchema = z
  .object({ note: z.string().max(500).optional(), version: z.coerce.number().int().min(0) })
  .strict();
export type UploadEvaluationFile = z.infer<typeof UploadEvaluationFileSchema>;

/** Remove one attached file from an evaluation. */
export const RemoveEvaluationFileSchema = z.object({ version: z.number().int().min(0) }).strict();
export type RemoveEvaluationFile = z.infer<typeof RemoveEvaluationFileSchema>;

/** Record or clear the appointment date on a phase that enables one (RW6/RW9). */
export const SetEvaluationAppointmentSchema = z
  .object({
    appointmentAt: z.coerce.date().nullable(),
    note: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SetEvaluationAppointment = z.infer<typeof SetEvaluationAppointmentSchema>;

/**
 * Bulk approve/reject a phase's queue (RW10/A4). Each item runs in its own transaction and
 * produces its own audit entry, domain event and timeline entry (I4); failures are reported
 * per id. A reason is mandatory to reject.
 */
export const BULK_EVALUATION_ACTIONS = ['approve', 'reject'] as const;
export const BulkEvaluationActionSchema = z.enum(BULK_EVALUATION_ACTIONS);
export type BulkEvaluationAction = z.infer<typeof BulkEvaluationActionSchema>;

export const BulkEvaluationsSchema = BulkRequestBaseSchema.extend({
  action: BulkEvaluationActionSchema,
  /** Guards against a selection spanning phases — the page always knows its own phase. */
  phaseId: objectId(),
})
  .strict()
  .refine((v) => v.action !== 'reject' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to reject evaluations',
  });
export type BulkEvaluations = z.infer<typeof BulkEvaluationsSchema>;

export const ListEvaluationsQuerySchema = PaginationQuerySchema.extend({
  applicantId: objectId().optional(),
  phaseId: objectId().optional(),
  /** Doubles as the phase page's tab (I10/RW6a): waiting | approved | rejected. */
  status: EvaluationStatusSchema.optional(),
  branchId: objectId().optional(),
  batchId: objectId().optional(),
  /** Include records belonging to superseded attempts (default false for queues). */
  includeSuperseded: z.coerce.boolean().default(false),
  search: z.string().max(200).optional(),
  /** When the record entered this phase — the phase queue's date range, mirroring screening. */
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
}).strict();
export type ListEvaluationsQuery = z.infer<typeof ListEvaluationsQuerySchema>;

/** Per-phase report export; reuses the list filter (paging ignored). */
export const ExportEvaluationsQuerySchema = ListEvaluationsQuerySchema.omit({
  page: true,
  pageSize: true,
}).strict();
export type ExportEvaluationsQuery = z.infer<typeof ExportEvaluationsQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface EvaluationFileDto {
  fileId: string;
  fileName: string;
  note: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface EvaluationDto extends AttemptMarkerDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name) — tables never show bare codes. */
  applicantName: string;
  /** Data-scope field: follows the applicant on reassignment (RW2 step 3). */
  branchId: string | null;
  phaseId: string;
  phaseKey: string;
  phaseName: LocalizedString;
  phaseOrder: number;
  phaseKind: EvaluationPhaseKind;
  status: EvaluationStatus;
  /** Set when the current status is `rejected` (or a note left on approval); null otherwise. */
  reason: string | null;
  files: EvaluationFileDto[];
  /** The placement in force when this record was opened; immutable (RW4). */
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  /** Advisory: a different seat/branch this phase recommends (RW5). Never moves the candidate. */
  recommendedPlacement: PlacementDto | null;
  recommendationNote: string | null;
  /** Set for records that belong to a batch (RW8); null for individual phases. */
  batchId: string | null;
  batchCode: string | null;
  /** Only meaningful when the phase has `appointmentEnabled`. */
  appointmentAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  // I5 — an evaluation carries its CURRENT decision, not a log of past ones. Every re-decision is
  // an `evaluationDecided` entry on `hr_recruitment_timeline` with the same from/to/reason/actor,
  // so a second copy here could only ever disagree with it.
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Files service category (seeded at boot) ─────────────────────────────────
// Evaluation attachments are scans/photos/PDFs, so the category is broader than hiring documents.
export const EVALUATION_FILE_CATEGORY = 'hr-evaluations';

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrEvaluationEvents = {
  /** Opening a phase record for an applicant (I2 — every workflow action emits). */
  EvaluationOpened: 'hr.evaluation.opened',
  /**
   * The original decision event. KEPT and still emitted alongside the outcome-specific pair
   * below, so existing subscribers keep working (I2 — names are added to, never renamed).
   */
  EvaluationDecided: 'hr.evaluation.decided',
  EvaluationApproved: 'hr.evaluation.approved',
  EvaluationRejected: 'hr.evaluation.rejected',
} as const;
export type HrEvaluationEventName = (typeof HrEvaluationEvents)[keyof typeof HrEvaluationEvents];

export const EvaluationDecidedPayloadV1 = z.object({
  evaluationId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  phaseKey: z.string(),
  decision: EvaluationDecisionSchema,
});

export const EvaluationOpenedPayloadV1 = z.object({
  evaluationId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  phaseKey: z.string(),
  attempt: z.number().int().min(1),
  batchId: objectId().optional(),
});
