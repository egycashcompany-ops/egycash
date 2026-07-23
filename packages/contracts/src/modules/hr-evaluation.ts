// HR / Recruitment — Evaluation Phases. The post-interview, file-based approval checks
// (Security Check, Medical Examination, Driving Test, …). The set of phases is an
// ADMINISTRATOR-CONFIGURABLE ordered catalog — new phases are added with no code changes, exactly
// like the interview-stage catalog. An applicant who has cleared the interview rounds passes
// through the active phases; each phase collects one or more files and carries an
// approved/rejected decision with a reason. The decision stays EDITABLE. A rejection at any phase
// removes the applicant from the active pipeline (mirrors a failed interview round).
import { z } from 'zod';
import { objectId, LocalizedStringSchema, PaginationQuerySchema, type LocalizedString } from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/** An evaluation is `pending` until decided; `approved` clears the phase, `rejected` removes the applicant. */
export const EVALUATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const EvaluationStatusSchema = z.enum(EVALUATION_STATUSES);
export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

/** The two terminal decisions a phase may be (re-)set to. */
export const EVALUATION_DECISIONS = ['approved', 'rejected'] as const;
export const EvaluationDecisionSchema = z.enum(EVALUATION_DECISIONS);
export type EvaluationDecision = z.infer<typeof EvaluationDecisionSchema>;

// ── Evaluation-phase catalog (admin-configurable) ───────────────────────────

export const CreateEvaluationPhaseSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    /** 1-based position in the post-interview sequence; unique among active phases. */
    order: z.number().int().min(1).max(50),
    /** Advisory flag: this phase is only relevant to driver applicants (e.g. Driving Test). */
    driversOnly: z.boolean().default(false),
  })
  .strict();
export type CreateEvaluationPhase = z.infer<typeof CreateEvaluationPhaseSchema>;

export const UpdateEvaluationPhaseSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    order: z.number().int().min(1).max(50).optional(),
    active: z.boolean().optional(),
    driversOnly: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateEvaluationPhase = z.infer<typeof UpdateEvaluationPhaseSchema>;

export const ListEvaluationPhasesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
}).strict();
export type ListEvaluationPhasesQuery = z.infer<typeof ListEvaluationPhasesQuerySchema>;

export interface EvaluationPhaseDto {
  id: string;
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
  driversOnly: boolean;
  version: number;
}

// ── Per-applicant evaluation records ────────────────────────────────────────

/** Open (start) an evaluation for an applicant at a phase — idempotent per (applicant, phase). */
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

export const ListEvaluationsQuerySchema = PaginationQuerySchema.extend({
  applicantId: objectId().optional(),
  phaseId: objectId().optional(),
  status: EvaluationStatusSchema.optional(),
  branchId: objectId().optional(),
}).strict();
export type ListEvaluationsQuery = z.infer<typeof ListEvaluationsQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface EvaluationFileDto {
  fileId: string;
  fileName: string;
  note: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** One audited decision change on an evaluation (backs editability — HR can re-decide). */
export interface EvaluationDecisionEventDto {
  at: string;
  from: EvaluationStatus;
  to: EvaluationStatus;
  reason: string | null;
  by: string | null;
}

export interface EvaluationDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  branchId: string | null;
  phaseId: string;
  phaseKey: string;
  phaseName: LocalizedString;
  phaseOrder: number;
  status: EvaluationStatus;
  /** Set when the current status is `rejected` (or a note left on approval); null otherwise. */
  reason: string | null;
  files: EvaluationFileDto[];
  decidedBy: string | null;
  decidedAt: string | null;
  /** Full audited trail of decision changes (oldest first); empty until first decided. */
  decisionHistory: EvaluationDecisionEventDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Files service category (seeded at boot) ─────────────────────────────────
// Evaluation attachments are scans/photos/PDFs, so the category is broader than hiring documents.
export const EVALUATION_FILE_CATEGORY = 'hr-evaluations';

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrEvaluationEvents = {
  EvaluationDecided: 'hr.evaluation.decided',
} as const;
export type HrEvaluationEventName = (typeof HrEvaluationEvents)[keyof typeof HrEvaluationEvents];

export const EvaluationDecidedPayloadV1 = z.object({
  evaluationId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  phaseKey: z.string(),
  decision: EvaluationDecisionSchema,
});
