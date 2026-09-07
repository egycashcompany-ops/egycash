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
  /** The company-wide section this row declares the department has (P-ORG-2), or `null`. */
  catalogId: Types.ObjectId | null;
  /** Optional bilingual description (Phase 3.3). */
  description: LocalizedString | null;
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const sectionSchema = new Schema<SectionDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    catalogId: { type: Schema.Types.ObjectId, default: null },
    description: { type: localizedSubSchema, default: null },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(sectionSchema);
sectionSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

/** One department declares a company-wide section at most once — see the department model. */
sectionSchema.index(
  { departmentId: 1, catalogId: 1 },
  {
    unique: true,
    name: 'ux_department_catalog',
    partialFilterExpression: { isDeleted: false, catalogId: { $type: 'objectId' } },
  },
);

export const SectionModel = model<SectionDoc>('Section', sectionSchema, 'sections');
