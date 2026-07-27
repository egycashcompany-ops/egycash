// Evaluation-phase catalog — the administrator-configurable post-interview check sequence
// (Security Check, Medical Examination, Driving Test, …). Mirrors the interview-stage catalog:
// localized, ordered, extensible, deactivated (never hard-deleted) so historical evaluations keep
// referencing a phase.
import { Schema, model } from 'mongoose';
import {
  EVALUATION_APPLICABILITIES,
  EVALUATION_PERMISSION_RESOURCES,
  EVALUATION_PHASE_KINDS,
  type EvaluationApplicability,
  type EvaluationPermissionResource,
  type EvaluationPhaseKind,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EvaluationPhaseDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
  /** Advisory: this phase is only relevant to driver applicants (e.g. Driving Test). */
  driversOnly: boolean;
  /** How the phase is worked: batch (Security, Driving) or individual (Medical) — RW6. */
  kind: EvaluationPhaseKind;
  applicability: EvaluationApplicability;
  /** The permission resource gating this phase (RW7). */
  permissionResource: EvaluationPermissionResource;
  appointmentEnabled: boolean;
  requiresResultDocument: boolean;
}

const evaluationPhaseSchema = new Schema<EvaluationPhaseDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    order: { type: Number, required: true },
    active: { type: Boolean, required: true, default: true },
    driversOnly: { type: Boolean, required: true, default: false },
    kind: { type: String, enum: EVALUATION_PHASE_KINDS, required: true, default: 'individual' },
    applicability: {
      type: String,
      enum: EVALUATION_APPLICABILITIES,
      required: true,
      default: 'all',
    },
    permissionResource: {
      type: String,
      enum: EVALUATION_PERMISSION_RESOURCES,
      required: true,
      default: 'evaluation',
    },
    appointmentEnabled: { type: Boolean, required: true, default: false },
    requiresResultDocument: { type: Boolean, required: true, default: false },
    ...baseFields,
  },
  baseSchemaOptions,
);

evaluationPhaseSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);
// The sequence position is unique among active phases.
evaluationPhaseSchema.index(
  { order: 1 },
  { unique: true, name: 'ux_active_order', partialFilterExpression: { isDeleted: false, active: true } },
);

export const EvaluationPhaseModel = model<EvaluationPhaseDoc>(
  'EvaluationPhase',
  evaluationPhaseSchema,
  'hr_evaluation_phases',
);
