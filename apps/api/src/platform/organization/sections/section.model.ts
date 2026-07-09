import { Schema, model, type Types } from 'mongoose';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface SectionDoc extends OrgUnitDoc {
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
}

const sectionSchema = new Schema<SectionDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(sectionSchema);
sectionSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const SectionModel = model<SectionDoc>('Section', sectionSchema, 'sections');
