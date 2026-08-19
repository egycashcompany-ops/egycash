// The bank branch — the legacy "location" (discovery §11). The legacy string join
// (`transactions.from_name` → `bank_branches.branche_name`) becomes the `bankId` ref + unique
// per-bank name/code, which is exactly the uniqueness the legacy `check_branch_exists` endpoint
// enforced per bank (contad_app.js:1935). `name` stays a PLAIN string — legacy branch names are
// Arabic-only, and inventing an English side would be inventing data.
//
// `location` is the design-§17.4 abstraction: optional address/coordinates, null everywhere on
// day one because the legacy system carries no geo data at all (discovery §11.2).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsBranchLocation {
  addressLine: string | null;
  coordinates: { lat: number; lng: number } | null;
}

export interface OperationsBankBranchDoc extends BaseDocFields {
  bankId: Types.ObjectId;
  name: string;
  code: string;
  /** Legacy `area` — operations area ("للعمليات"). */
  opsAreaName: string | null;
  /** Legacy `area2` — finance area ("للحسابات"), defaulted to `area` on add (Q24 PRESERVE). */
  financeAreaName: string | null;
  location: OperationsBranchLocation | null;
  isActive: boolean;
}

const bankBranchSchema = new Schema<OperationsBankBranchDoc>(
  {
    bankId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    opsAreaName: { type: String, default: null },
    financeAreaName: { type: String, default: null },
    location: {
      type: {
        addressLine: { type: String, default: null },
        coordinates: {
          type: { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
          default: null,
        },
      },
      default: null,
    },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

bankBranchSchema.index(
  { bankId: 1, name: 1 },
  { unique: true, name: 'ux_bank_name', partialFilterExpression: { isDeleted: false } },
);
bankBranchSchema.index(
  { bankId: 1, code: 1 },
  { unique: true, name: 'ux_bank_code', partialFilterExpression: { isDeleted: false } },
);
bankBranchSchema.index({ opsAreaName: 1 }, { name: 'ix_ops_area' });

export const OperationsBankBranchModel = model<OperationsBankBranchDoc>(
  'OperationsBankBranch',
  bankBranchSchema,
  'operations_bank_branches',
);
