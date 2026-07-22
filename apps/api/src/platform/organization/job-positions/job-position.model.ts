// Job Positions are a reusable organization master entity: a role owned by a Department (required)
// and optionally placed at a Section within it. They are NOT tied to Recruitment and require no Job
// Requisition (ADR-016). The owning Department is set at creation and immutable thereafter.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { localizedField } from '../shared/org-unit';

export interface JobPositionDoc extends BaseDocFields {
  name: LocalizedString;
  departmentId: Types.ObjectId;
  sectionId: Types.ObjectId | null;
  description: LocalizedString | null;
  status: 'active' | 'inactive';
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const jobPositionSchema = new Schema<JobPositionDoc>(
  {
    name: localizedField,
    departmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    description: { type: localizedSubSchema, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
jobPositionSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });
jobPositionSchema.index({ sectionId: 1 }, { name: 'ix_sectionId' });
jobPositionSchema.index({ status: 1 }, { name: 'ix_status' });

export const JobPositionModel = model<JobPositionDoc>(
  'JobPosition',
  jobPositionSchema,
  'job_positions',
);
