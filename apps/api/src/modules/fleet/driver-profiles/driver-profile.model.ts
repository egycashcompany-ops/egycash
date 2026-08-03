// Driver profile (fleet design §2.3, FR-11) — the fleet-owned EXTENSION of an HR employee.
// Nothing personal or employment-related is stored here: name, phone, NID, department all live
// in HR and are read through the platform directory seam. This row holds only the facts Fleet
// is the authority on.
//
// `kind` is an internal forward-compatibility discriminator (owner instruction FL-3 §3): today
// every profile is `driver`, and the unique index is (employeeId, kind), so a future profile
// kind (e.g. a workshop technician) is an additive value — not a schema migration and not a
// second collection. It is deliberately NOT in the DTO until a second kind exists.
import { Schema, model, type Types } from 'mongoose';
import { FLEET_DRIVER_SPECIALIZATIONS, type FleetDriverSpecialization } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export const DRIVER_PROFILE_KIND = 'driver';

export interface FleetDriverProfileDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  kind: string;
  licenseNumber: string;
  licenseExpiresAt: Date;
  specialization: FleetDriverSpecialization;
  area: string | null;
  isActive: boolean;
}

const driverProfileSchema = new Schema<FleetDriverProfileDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true, default: DRIVER_PROFILE_KIND },
    licenseNumber: { type: String, required: true, trim: true },
    licenseExpiresAt: { type: Date, required: true },
    specialization: { type: String, required: true, enum: FLEET_DRIVER_SPECIALIZATIONS },
    area: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

driverProfileSchema.index(
  { employeeId: 1, kind: 1 },
  { unique: true, name: 'ux_employee_kind', partialFilterExpression: { isDeleted: false } },
);
driverProfileSchema.index({ isActive: 1, licenseExpiresAt: 1 }, { name: 'ix_license_sweep' });

export const FleetDriverProfileModel = model<FleetDriverProfileDoc>(
  'FleetDriverProfile',
  driverProfileSchema,
  'fleet_driver_profiles',
);
