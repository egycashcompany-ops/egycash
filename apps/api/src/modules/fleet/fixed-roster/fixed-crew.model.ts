// The fixed crew (الطقم الثابت) — one row per VEHICLE, and the vehicle alone is its identity.
//
// Deliberately not a row in `fleet_duty_assignments`: that collection's identity is the pair
// (vehicle, date), enforced by a unique index, and every read of it — the roster board, the
// workshop check-in's crew lookup — is a read of one DAY. A dateless fact stored there would
// need a sentinel date and would surface in both, which is exactly the mixing the fixed crew
// must not do. So it lives here, with no date, no mission and no notes: the standing answer to
// "who is this car's crew", true until somebody changes it.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetFixedCrewDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  driver1EmployeeId: Types.ObjectId | null;
  driver2EmployeeId: Types.ObjectId | null;
}

const fixedCrewSchema = new Schema<FleetFixedCrewDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    driver1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    driver2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One crew per vehicle. A concurrent double-save for the same car collides here; the driver
// half spans two fields across two rows and is service-checked, as it is for the daily plan.
fixedCrewSchema.index(
  { vehicleId: 1 },
  { unique: true, name: 'ux_fixed_vehicle', partialFilterExpression: { isDeleted: false } },
);

export const FleetFixedCrewModel = model<FleetFixedCrewDoc>(
  'FleetFixedCrew',
  fixedCrewSchema,
  'fleet_fixed_crews',
);
