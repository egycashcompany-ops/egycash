// The vehicle registry (fleet design §2.1). What is deliberately ABSENT is as designed as what
// is present: no `driver` (a roster fact), no `inWorkshop` (derived from open maintenance
// visits, FR-12), no alarm state (derived, FR-3). A stored copy of any of those is a copy that
// goes stale.
import { Schema, model, type Types } from 'mongoose';
import { FLEET_VEHICLE_STATUSES, type FleetVehicleStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetVehicleDoc extends BaseDocFields {
  code: string;
  typeId: Types.ObjectId;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: Date;
  licenseExpiresAt: Date;
  licenseClass: string | null;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  radio: { issi: string | null; motorolaSn: string | null };
  status: FleetVehicleStatus;
  statusReason: string | null;
}

const vehicleSchema = new Schema<FleetVehicleDoc>(
  {
    code: { type: String, required: true, trim: true },
    typeId: { type: Schema.Types.ObjectId, required: true },
    plateNumber: { type: String, required: true, trim: true },
    chassisNumber: { type: String, required: true, trim: true },
    motorNumber: { type: String, required: true, trim: true },
    joinedAt: { type: Date, required: true },
    licenseExpiresAt: { type: Date, required: true },
    licenseClass: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    radio: {
      issi: { type: String, default: null },
      motorolaSn: { type: String, default: null },
    },
    status: { type: String, required: true, enum: FLEET_VEHICLE_STATUSES, default: 'active' },
    statusReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// FR-1 — the four physical identifiers are each unique among non-deleted vehicles. Partial
// indexes free an identifier when its vehicle is soft-deleted (a scrapped car's plate returns
// to the authority and may reappear on another).
for (const [field, name] of [
  ['code', 'ux_code'],
  ['plateNumber', 'ux_plate'],
  ['chassisNumber', 'ux_chassis'],
  ['motorNumber', 'ux_motor'],
] as const) {
  vehicleSchema.index(
    { [field]: 1 },
    { unique: true, name, partialFilterExpression: { isDeleted: false } },
  );
}
vehicleSchema.index({ status: 1, licenseExpiresAt: 1 }, { name: 'ix_license_sweep' });

export const FleetVehicleModel = model<FleetVehicleDoc>(
  'FleetVehicle',
  vehicleSchema,
  'fleet_vehicles',
);
