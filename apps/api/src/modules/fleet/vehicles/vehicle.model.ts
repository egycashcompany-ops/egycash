// The vehicle registry (fleet design §2.1). What is deliberately ABSENT is as designed as what
// is present: no `driver` (a roster fact), no `inWorkshop` (derived from open maintenance
// visits, FR-12), no alarm state (derived, FR-3). A stored copy of any of those is a copy that
// goes stale.
import { Schema, model, type Types } from 'mongoose';
import { FLEET_VEHICLE_STATUSES, type FleetVehicleStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** The link to the platform Files row holding the scanned license. Bytes live in Files, never here. */
export interface FleetVehicleLicenseImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

export interface FleetVehicleDoc extends BaseDocFields {
  code: string;
  typeId: Types.ObjectId;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: Date;
  licenseExpiresAt: Date;
  /**
   * LEGACY, read-only, absent from the DTO. The free-text license class every vehicle carried
   * before `licenseClassId` existed. The migration copied each distinct value into a `licenseClass`
   * catalog item and pointed `licenseClassId` at it; this column is kept, never written again, as
   * the migration's own audit trail — deleting it would destroy the evidence of what was converted.
   */
  licenseClass: string | null;
  licenseClassId: Types.ObjectId | null;
  operationId: Types.ObjectId | null;
  insuranceCompanyId: Types.ObjectId | null;
  /**
   * Required for every vehicle created from the catalogs slice onward. Rows predating the rule may
   * still hold null — `required` binds `create` (which runs validators) and not `findOneAndUpdate`,
   * so legacy vehicles stay readable and editable instead of becoming unreachable.
   */
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  radio: { issi: string | null; motorolaSn: string | null };
  status: FleetVehicleStatus;
  statusReason: string | null;
  licenseImage: FleetVehicleLicenseImage | null;
}

const licenseImageSchema = new Schema<FleetVehicleLicenseImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

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
    licenseClassId: { type: Schema.Types.ObjectId, default: null },
    operationId: { type: Schema.Types.ObjectId, default: null },
    insuranceCompanyId: { type: Schema.Types.ObjectId, default: null },
    // `required` is the last line of defence behind the schema and the service: it binds `create`,
    // so no code path anywhere can insert a branchless vehicle.
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    licenseImage: { type: licenseImageSchema, default: null },
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
// The three catalog filters on the registry list page. Separate indexes rather than one compound:
// the filters are independently optional, so no single field order would serve them all.
vehicleSchema.index({ licenseClassId: 1 }, { name: 'ix_license_class' });
vehicleSchema.index({ operationId: 1 }, { name: 'ix_operation' });
vehicleSchema.index({ insuranceCompanyId: 1 }, { name: 'ix_insurance_company' });

export const FleetVehicleModel = model<FleetVehicleDoc>(
  'FleetVehicle',
  vehicleSchema,
  'fleet_vehicles',
);
