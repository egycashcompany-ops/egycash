// The per-applicant Evaluation record (one per applicant × phase). Tracks the collected files
// (their bytes live in the platform Files service) and the approve/reject decision + reason. The
// decision is EDITABLE — re-deciding updates the same record. `applicantCode`/`branchId`/phase
// metadata are denormalized for display and scoping (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import { EVALUATION_STATUSES, type EvaluationStatus, type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EvaluationFile {
  fileId: Types.ObjectId;
  fileName: string;
  note: string | null;
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
}

/** One audited decision change (backs editability — HR can re-decide a phase). */
export interface EvaluationDecisionEvent {
  at: Date;
  from: EvaluationStatus;
  to: EvaluationStatus;
  reason: string | null;
  by: Types.ObjectId | null;
}

export interface EvaluationDoc extends BaseDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  branchId: Types.ObjectId | null;
  phaseId: Types.ObjectId;
  phaseKey: string;
  phaseName: LocalizedString;
  phaseOrder: number;
  status: EvaluationStatus;
  reason: string | null;
  files: EvaluationFile[];
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionHistory: EvaluationDecisionEvent[];
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
    branchId: { type: Schema.Types.ObjectId, default: null },
    phaseId: { type: Schema.Types.ObjectId, required: true },
    phaseKey: { type: String, required: true },
    phaseName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    phaseOrder: { type: Number, required: true },
    status: { type: String, enum: EVALUATION_STATUSES, required: true, default: 'pending' },
    reason: { type: String, default: null },
    files: { type: [fileSchema], default: [] },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionHistory: {
      type: [
        new Schema<EvaluationDecisionEvent>(
          {
            at: { type: Date, required: true },
            from: { type: String, enum: EVALUATION_STATUSES, required: true },
            to: { type: String, enum: EVALUATION_STATUSES, required: true },
            reason: { type: String, default: null },
            by: { type: Schema.Types.ObjectId, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

// At most one evaluation per applicant × phase (opening is idempotent).
evaluationSchema.index(
  { applicantId: 1, phaseId: 1 },
  { unique: true, name: 'ux_applicant_phase', partialFilterExpression: { isDeleted: false } },
);
evaluationSchema.index({ applicantId: 1, phaseOrder: 1 }, { name: 'ix_applicant_order' });
evaluationSchema.index({ phaseId: 1, status: 1 }, { name: 'ix_phase_status' });
evaluationSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });

export const EvaluationModel = model<EvaluationDoc>('Evaluation', evaluationSchema, 'hr_evaluations');
