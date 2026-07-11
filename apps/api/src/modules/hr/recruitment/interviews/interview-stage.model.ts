// Interview stage catalog (Stage 3, OQ-31) — the administrator-configurable interview
// sequence. Two rounds ("First Interview", "Second Interview") is only the shipped default;
// the number, names, and order are admin-managed. Localized, extensible, deactivated
// (never hard-deleted) so historical interviews keep referencing a stage.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface InterviewStageDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
}

const interviewStageSchema = new Schema<InterviewStageDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    order: { type: Number, required: true },
    active: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

interviewStageSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);
// The sequence position is unique among active stages (one interview per position).
interviewStageSchema.index(
  { order: 1 },
  { unique: true, name: 'ux_active_order', partialFilterExpression: { isDeleted: false, active: true } },
);

export const InterviewStageModel = model<InterviewStageDoc>(
  'InterviewStage',
  interviewStageSchema,
  'hr_interview_stages',
);
