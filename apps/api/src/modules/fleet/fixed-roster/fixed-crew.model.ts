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

/**
 * One crew per vehicle — the collection's whole identity rule, declared ONCE.
 *
 * A concurrent double-save for the same car collides here; the driver half spans two fields
 * across two rows and is service-checked, as it is for the daily plan.
 *
 * Exported as data rather than written inline because `autoIndex` is off outside development
 * (infrastructure/database/mongo.ts), so in production this index is built by a deploy-time
 * migration instead. Two hand-written copies of the same definition would drift, and mongo
 * answers a mismatched rebuild with `IndexOptionsConflict` rather than a fix — so both the
 * schema below and `fleet.migration.ts` read these two constants and nothing else.
 *
 * Partial on `isDeleted: false`: a soft-deleted row must not keep a live vehicle's slot. Every
 * document written through the base repository carries the field (`baseFields` makes it
 * `required` with a `false` default), so the filter never silently excludes a live row.
 */
export const FIXED_CREW_VEHICLE_INDEX_KEY = { vehicleId: 1 } as const;
export const FIXED_CREW_VEHICLE_INDEX_OPTIONS = {
  unique: true,
  name: 'ux_fixed_vehicle',
  partialFilterExpression: { isDeleted: false },
} as const;

fixedCrewSchema.index(FIXED_CREW_VEHICLE_INDEX_KEY, FIXED_CREW_VEHICLE_INDEX_OPTIONS);

export const FleetFixedCrewModel = model<FleetFixedCrewDoc>(
  'FleetFixedCrew',
  fixedCrewSchema,
  'fleet_fixed_crews',
);
