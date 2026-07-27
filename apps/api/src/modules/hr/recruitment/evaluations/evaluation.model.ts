// The per-applicant Evaluation record (one per applicant × phase). Tracks the collected files
// (their bytes live in the platform Files service) and the approve/reject decision + reason. The
// decision is EDITABLE — re-deciding updates the same record. `applicantCode`/`branchId`/phase
// metadata are denormalized for display and scoping (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import {
  EVALUATION_PHASE_KINDS,
  EVALUATION_STATUSES,
  type EvaluationPhaseKind,
  type EvaluationStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';
import {
  placementSchema,
  stageFields,
  type StageDocFields,
  type StagePlacement,
} from '../workflow/stage-fields';

export interface EvaluationFile {
  fileId: Types.ObjectId;
  fileName: string;
  note: string | null;
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
}

export interface EvaluationDoc extends BaseDocFields, StageDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  branchId: Types.ObjectId | null;
  phaseId: Types.ObjectId;
  phaseKey: string;
  phaseName: LocalizedString;
  phaseOrder: number;
  phaseKind: EvaluationPhaseKind;
  status: EvaluationStatus;
  reason: string | null;
  files: EvaluationFile[];
  /** Set for records driven by a batch (RW8); null for individual phases. */
  batchId: Types.ObjectId | null;
  batchCode: string | null;
  /** Only meaningful when the phase has `appointmentEnabled`. */
  appointmentAt: Date | null;
  recommendedPlacement: StagePlacement | null;
  recommendationNote: string | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
}

const fileSchema = new Schema<EvaluationFile>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    note: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const evaluationSchema = new Schema<EvaluationDoc>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    applicantName: { type: String, default: '' },
    branchId: { type: Schema.Types.ObjectId, default: null },
    phaseId: { type: Schema.Types.ObjectId, required: true },
    phaseKey: { type: String, required: true },
    phaseName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    phaseOrder: { type: Number, required: true },
    phaseKind: { type: String, enum: EVALUATION_PHASE_KINDS, required: true, default: 'individual' },
    status: { type: String, enum: EVALUATION_STATUSES, required: true, default: 'waiting' },
    reason: { type: String, default: null },
    files: { type: [fileSchema], default: [] },
    batchId: { type: Schema.Types.ObjectId, default: null },
    batchCode: { type: String, default: null },
    appointmentAt: { type: Date, default: null },
    recommendedPlacement: { type: placementSchema, default: null },
    recommendationNote: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    // I5 — no `decisionHistory` here. Re-decisions are recorded once, on the canonical
    // recruitment timeline; an aggregate that also logged them would be a second history.
    ...stageFields,
    ...baseFields,
  },
  baseSchemaOptions,
);

// I12 — one ACTIVE record per (applicant, phase, attempt); opening is idempotent.
evaluationSchema.index(
  { applicantId: 1, phaseId: 1, attempt: 1 },
  {
    unique: true,
    name: 'ux_applicant_phase_attempt',
    partialFilterExpression: { supersededAt: null, isDeleted: false },
  },
);
evaluationSchema.index({ batchId: 1 }, { name: 'ix_batchId' });
evaluationSchema.index({ applicantId: 1, phaseOrder: 1 }, { name: 'ix_applicant_order' });
evaluationSchema.index({ phaseId: 1, status: 1 }, { name: 'ix_phase_status' });
evaluationSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });

export const EvaluationModel = model<EvaluationDoc>('Evaluation', evaluationSchema, 'hr_evaluations');
