// `it_maintenance_plans` — a preventive schedule for one asset (design §2.7).
//
// `nextDueAt` is the schedule's only clock, and it advances from the COMPLETION date rather than
// the due date. That is the Fleet alarm-baseline lesson: advancing from the due date compounds
// drift every time a service runs late, so a plan that slips once slips forever.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItMaintenancePlanDoc extends BaseDocFields {
  assetId: Types.ObjectId;
  name: string;
  intervalDays: number;
  checklist: string | null;
  lastCompletedAt: Date | null;
  nextDueAt: Date;
  active: boolean;
  /**
   * Denormalized from the asset at creation — same anchor, same reason, same precedent as the
   * order's. A plan is a schedule for one asset, and it is read by that asset's branch.
   */
  branchId: Types.ObjectId;
}

const planSchema = new Schema<ItMaintenancePlanDoc>(
  {
    assetId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    intervalDays: { type: Number, required: true, min: 1 },
    checklist: { type: String, default: null },
    lastCompletedAt: { type: Date, default: null },
    nextDueAt: { type: Date, required: true },
    active: { type: Boolean, required: true, default: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

planSchema.index({ assetId: 1, active: 1 }, { name: 'ix_asset_active' });
planSchema.index({ branchId: 1, active: 1 }, { name: 'ix_branch_active' });
// THE SWEEP INDEX (§4.6): "active plans due within the horizon", the only question it asks.
planSchema.index(
  { nextDueAt: 1 },
  { name: 'ix_due_active', partialFilterExpression: { active: true, isDeleted: false } },
);

export const ItMaintenancePlanModel = model<ItMaintenancePlanDoc>(
  'ItMaintenancePlan',
  planSchema,
  'it_maintenance_plans',
);
