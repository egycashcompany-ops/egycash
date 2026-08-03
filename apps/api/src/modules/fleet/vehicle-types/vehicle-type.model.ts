// Vehicle type catalog (fleet design §2.2) — the carrier of the per-TYPE maintenance rule.
// The interval lives here rather than on the vehicle because that is the business fact the
// legacy alarm ran on: a غزالة is serviced every N km whichever plate it carries. Archived
// (never hard-deleted) so vehicles keep referencing a retired type.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetVehicleTypeDoc extends BaseDocFields {
  name: LocalizedString;
  maintenanceIntervalKm: number;
  isActive: boolean;
}

const vehicleTypeSchema = new Schema<FleetVehicleTypeDoc>(
  {
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    maintenanceIntervalKm: { type: Number, required: true, default: 0, min: 0 },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Uniqueness on the ARABIC name (the operational language of the fleet); the English label is
// display-only. Partial so a soft-deleted type frees its name.
vehicleTypeSchema.index(
  { 'name.ar': 1 },
  { unique: true, name: 'ux_name_ar', partialFilterExpression: { isDeleted: false } },
);

export const FleetVehicleTypeModel = model<FleetVehicleTypeDoc>(
  'FleetVehicleType',
  vehicleTypeSchema,
  'fleet_vehicle_types',
);
