// The licensing board's marks (التراخيص) — one row per VEHICLE, four ticks on it.
//
// WHAT IS DELIBERATELY ABSENT: which cars are on the board. That is DERIVED from the registry —
// a vehicle is on it because its licence class is named «… ت» — and storing a copy here would be
// a second answer to the same question, stale the first time an admin renamed a class. This
// collection holds only what a clerk DID, which nothing else can derive.
//
// A row is written the first time one of its four squares is ticked. A vehicle with no row is a
// vehicle with nothing done yet, and reads as four falses — so the board never has to create a
// row for a car merely to look at it.
//
// AND IT IS RETIRED WHEN THE CAR LEAVES THE BOARD — «لو رجعت كل العلامات تتشال». Soft-deleted,
// not blanked: what a clerk did stays in the database and leaves the screen, and because both
// the unique index and the tick's upsert filter on `isDeleted: false`, a car that comes back
// simply starts a new row beside the retired one.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetVehicleLicensingDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  /** التأمينات — handed in, and collected back. */
  insuranceHandover: boolean;
  insuranceReceipt: boolean;
  /** الضرائب — the same pair, for the other paper. */
  taxHandover: boolean;
  taxReceipt: boolean;
}

const licensingSchema = new Schema<FleetVehicleLicensingDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    insuranceHandover: { type: Boolean, required: true, default: false },
    insuranceReceipt: { type: Boolean, required: true, default: false },
    taxHandover: { type: Boolean, required: true, default: false },
    taxReceipt: { type: Boolean, required: true, default: false },
    ...baseFields,
  },
  baseSchemaOptions,
);

/**
 * One row per vehicle — the collection's whole identity rule, declared ONCE and read by both the
 * schema below and `fleet.migration.ts`, because `autoIndex` is off outside development and two
 * hand-written copies of an index definition drift. Partial on `isDeleted: false` for the same
 * reason the fixed crew's is: a soft-deleted row must not keep a live vehicle's slot.
 *
 * It is also what makes the tick safe to write as an upsert: two clerks ticking the two squares
 * of the same car at the same instant race to insert, and the loser retries into an update rather
 * than creating a second row that would hide half the board's state.
 */
export const VEHICLE_LICENSING_INDEX_KEY = { vehicleId: 1 } as const;
export const VEHICLE_LICENSING_INDEX_OPTIONS = {
  unique: true,
  name: 'ux_licensing_vehicle',
  partialFilterExpression: { isDeleted: false },
} as const;

licensingSchema.index(VEHICLE_LICENSING_INDEX_KEY, VEHICLE_LICENSING_INDEX_OPTIONS);

export const FleetVehicleLicensingModel = model<FleetVehicleLicensingDoc>(
  'FleetVehicleLicensing',
  licensingSchema,
  'fleet_vehicle_licensing',
);
