// Evaluation-phase catalog — the administrator-configurable post-interview check sequence
// (Security Check, Medical Examination, Driving Test, …). Mirrors the interview-stage catalog:
// localized, ordered, extensible, deactivated (never hard-deleted) so historical evaluations keep
// referencing a phase.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EvaluationPhaseDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
  /** Advisory: this phase is only relevant to driver applicants (e.g. Driving Test). */
  driversOnly: boolean;
}

const evaluationPhaseSchema = new Schema<EvaluationPhaseDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    order: { type: Number, required: true },
    active: { type: Boolean, required: true, default: true },
    driversOnly: { type: Boolean, required: true, default: false },
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
