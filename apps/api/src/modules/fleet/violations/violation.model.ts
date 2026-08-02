// Violations (fleet design §2.9) — ONE collection, two discriminated shapes. Vehicle rows are
// bulk yearly statement entries where the YEAR is the stored fact (H8's fate: the legacy
// synthesized a fake date from it, which is exactly how its rollups went wrong); driver rows
// are per-event. `amount` is SERVER-computed for vehicle rows (FR-9) and entered for driver
// rows. The per-(vehicle, year) grievance figure lives in its own single-row collection —
// H9's fate: the legacy stamped it redundantly onto every violation row via updateMany.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { FLEET_VIOLATION_KINDS, type FleetViolationKind } from '@ecms/contracts';

export interface FleetViolationDoc extends BaseDocFields {
  kind: FleetViolationKind;
  vehicleId: Types.ObjectId;
  violationTypeId: Types.ObjectId;
  amount: number;
  /** vehicle shape */
  year: number | null;
  count: number | null;
  unitValue: number | null;
  /** driver shape */
  date: Date | null;
  driverEmployeeId: Types.ObjectId | null;
}

const violationSchema = new Schema<FleetViolationDoc>(
  {
    kind: { type: String, enum: FLEET_VIOLATION_KINDS, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    violationTypeId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
    year: { type: Number, default: null },
    count: { type: Number, default: null },
    unitValue: { type: Number, default: null },
    date: { type: Date, default: null },
    driverEmployeeId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

violationSchema.index({ vehicleId: 1, year: 1 }, { name: 'ix_vehicle_year' });
violationSchema.index({ vehicleId: 1, date: -1 }, { name: 'ix_vehicle_date' });
violationSchema.index({ driverEmployeeId: 1, date: -1 }, { name: 'ix_driver_date' });

export const FleetViolationModel = model<FleetViolationDoc>(
  'FleetViolation',
  violationSchema,
  'fleet_violations',
);

export interface FleetGrievanceDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  year: number;
  totalBeforeGrievance: number;
}

const grievanceSchema = new Schema<FleetGrievanceDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    year: { type: Number, required: true },
    totalBeforeGrievance: { type: Number, required: true, min: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

// ONE figure per (vehicle, year) — the collection's whole reason to exist.
grievanceSchema.index(
  { vehicleId: 1, year: 1 },
  { unique: true, name: 'ux_vehicle_year', partialFilterExpression: { isDeleted: false } },
);

export const FleetGrievanceModel = model<FleetGrievanceDoc>(
  'FleetViolationGrievance',
  grievanceSchema,
  'fleet_violation_grievances',
);
