// Cost centres (P-HR-23) — an organization-wide catalog, like job titles and unlike a branch:
// no hierarchy (D-CC-4) and no place in the Branch → Department → Section tree.
//
// The catalog holds IDENTITY only. Who belongs to a centre is a dated assignment on the employee
// side (D-CC-1), and what a centre means to accounting is a decision this system has not been
// given — no account, no mapping, no posting rule appears here or anywhere near here.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { localizedField } from '../shared/org-unit';

export interface CostCenterDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  description: LocalizedString | null;
  status: 'active' | 'inactive';
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const costCenterSchema = new Schema<CostCenterDoc>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: localizedField,
    description: { type: localizedSubSchema, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Unique among the living, exactly as the job-title catalog does it: a soft-deleted code frees up.
costCenterSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
costCenterSchema.index({ status: 1 }, { name: 'ix_status' });

export const CostCenterModel = model<CostCenterDoc>(
  'CostCenter',
  costCenterSchema,
  'cost_centers',
);
