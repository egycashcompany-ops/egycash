import { Schema, model } from 'mongoose';
import { type Address } from '@ecms/contracts';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface BranchDoc extends OrgUnitDoc {
  address: Address | null;
}

const addressSchema = new Schema(
  {
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    governorate: { type: String, required: true },
    postalCode: { type: String },
  },
  { _id: false },
);

const branchSchema = new Schema<BranchDoc>(
  {
    ...orgUnitFields,
    address: { type: addressSchema, default: null },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(branchSchema);

export const BranchModel = model<BranchDoc>('Branch', branchSchema, 'branches');
