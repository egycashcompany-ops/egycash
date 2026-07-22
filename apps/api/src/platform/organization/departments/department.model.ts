import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  localizedField,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface DepartmentDoc extends OrgUnitDoc {
  branchId: Types.ObjectId;
  /** Optional bilingual description (Phase 3.2). */
  description: LocalizedString | null;
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const departmentSchema = new Schema<DepartmentDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
    description: { type: localizedSubSchema, default: null },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(departmentSchema);
departmentSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });

export const DepartmentModel = model<DepartmentDoc>('Department', departmentSchema, 'departments');
