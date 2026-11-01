// A crew line («خط», called a route in code) — a named group of plan lines for one branch and one
// replenishment day (S-8 b, DS-17; docs/12-planning/atm-settlements-phase1.md §4.7).
//
// It may hold lines of every bank's plan of that day; a plan line is assigned whole, to at most one
// route (`atm_route_assignments`). The leader is free text, as the board's is. Routes have no set
// document whose revision could serialise writers (the zones' set does), so names are unique per
// branch-day by `ux_branch_date_name`, and `ux_zone_route` keeps two concurrent «إنشاء الخطوط من
// القطاعات» calls from creating one zone's route twice.
import { Schema, model, type Types } from 'mongoose';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';
import { NO_CONTROL } from '../shared/slot.schema';

export interface AtmDispatchRouteDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  replenishDate: string;
  /** 1..60. */
  name: string;
  /** The name trimmed, spaces collapsed, case-folded. */
  nameKey: string;
  /** ≤ 80. */
  leaderName: string | null;
  order: number;
  /** The map zone the route was made from, if any. */
  zoneId: Types.ObjectId | null;
}

const dispatchRouteSchema = new Schema<AtmDispatchRouteDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    replenishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, minlength: 1, maxlength: 60, match: NO_CONTROL },
    nameKey: { type: String, required: true },
    leaderName: { type: String, default: null, maxlength: 80, match: NO_CONTROL },
    order: { type: Number, required: true, min: 0 },
    zoneId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

dispatchRouteSchema.index(
  { branchId: 1, replenishDate: 1, order: 1 },
  { name: 'ix_branch_date_order' },
);
dispatchRouteSchema.index(
  { branchId: 1, replenishDate: 1, nameKey: 1 },
  { unique: true, name: 'ux_branch_date_name', partialFilterExpression: { isDeleted: false } },
);
dispatchRouteSchema.index(
  { branchId: 1, replenishDate: 1, zoneId: 1 },
  {
    unique: true,
    name: 'ux_zone_route',
    partialFilterExpression: { zoneId: { $type: 'objectId' }, isDeleted: false },
  },
);

export const AtmDispatchRouteModel = model<AtmDispatchRouteDoc>(
  'AtmDispatchRoute',
  dispatchRouteSchema,
  'atm_dispatch_routes',
);
