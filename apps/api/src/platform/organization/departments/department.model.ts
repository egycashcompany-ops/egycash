import { Schema, model, type Types } from 'mongoose';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface DepartmentDoc extends OrgUnitDoc {
  branchId: Types.ObjectId;
}

const departmentSchema = new Schema<DepartmentDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(departmentSchema);
departmentSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });

export const DepartmentModel = model<DepartmentDoc>('Department', departmentSchema, 'departments');
