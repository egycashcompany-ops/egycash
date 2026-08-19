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

/** The link to the licence scan in platform Files — the bytes are never stored here. */
export interface FleetDriverLicenseImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

export interface FleetDriverProfileDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  kind: string;
  licenseNumber: string;
  licenseExpiresAt: Date;
  specialization: FleetDriverSpecialization;
  area: string | null;
  isActive: boolean;
  licenseImage: FleetDriverLicenseImage | null;
}

const licenseImageSchema = new Schema<FleetDriverLicenseImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const driverProfileSchema = new Schema<FleetDriverProfileDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true, default: DRIVER_PROFILE_KIND },
    licenseNumber: { type: String, required: true, trim: true },
    licenseExpiresAt: { type: Date, required: true },
    specialization: { type: String, required: true, enum: FLEET_DRIVER_SPECIALIZATIONS },
    area: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
    // `default: null` applies on WRITE only, so a profile stored before this field existed has no
    // key at all. Every reader below therefore tests `== null`, never `=== null`.
    licenseImage: { type: licenseImageSchema, default: null },
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
