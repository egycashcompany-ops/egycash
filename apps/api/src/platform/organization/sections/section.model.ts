import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  localizedField,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface SectionDoc extends OrgUnitDoc {
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
  /** Optional bilingual description (Phase 3.3). */
  description: LocalizedString | null;
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const sectionSchema = new Schema<SectionDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    description: { type: localizedSubSchema, default: null },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(sectionSchema);
sectionSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const SectionModel = model<SectionDoc>('Section', sectionSchema, 'sections');
