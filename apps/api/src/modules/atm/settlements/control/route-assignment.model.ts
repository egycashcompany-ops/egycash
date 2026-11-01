// Which crew line a plan line travels on — one live document per line (S-8 b, DS-17;
// docs/12-planning/atm-settlements-phase1.md §4.7). A line is assigned whole (all its bags), to at
// most one route (`ux_line`). Removing an assignment soft-deletes it, so its line returns to «لم
// يُوزّع بعد».
import { Schema, model, type Types } from 'mongoose';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AtmRouteAssignmentDoc extends BaseDocFields {
  lineId: Types.ObjectId;
  routeId: Types.ObjectId;
  branchId: Types.ObjectId;
  replenishDate: string;
}

const routeAssignmentSchema = new Schema<AtmRouteAssignmentDoc>(
  {
    lineId: { type: Schema.Types.ObjectId, required: true },
    routeId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    replenishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    ...baseFields,
  },
  baseSchemaOptions,
);

routeAssignmentSchema.index(
  { lineId: 1 },
  { unique: true, name: 'ux_line', partialFilterExpression: { isDeleted: false } },
);
routeAssignmentSchema.index({ routeId: 1 }, { name: 'ix_route' });
routeAssignmentSchema.index({ branchId: 1, replenishDate: 1 }, { name: 'ix_branch_date' });

export const AtmRouteAssignmentModel = model<AtmRouteAssignmentDoc>(
  'AtmRouteAssignment',
  routeAssignmentSchema,
  'atm_route_assignments',
);
