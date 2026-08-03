// The odometer log (fleet design §2.5, FR-2). The model's central invariant is CONTINUITY: one
// physical reading closes the previous period and opens the next, so `inReading` of entry k is
// identically `outReading` of entry k+1. `km` is stored but SERVER-DERIVED — persisted only
// because it is pure arithmetic over two immutable-once-validated fields on the same row, and
// recomputed by the service on every write that touches either.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetOdometerLogDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  date: Date;
  outReading: number;
  /** null = the vehicle's OPEN period; closed by the next recorded reading. */
  inReading: number | null;
  km: number | null;
  driver1EmployeeId: Types.ObjectId | null;
  driver2EmployeeId: Types.ObjectId | null;
  notes: string | null;
}

const odometerSchema = new Schema<FleetOdometerLogDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    outReading: { type: Number, required: true, min: 0 },
    inReading: { type: Number, default: null },
    km: { type: Number, default: null },
    driver1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    driver2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// AT MOST ONE open period per vehicle — the database's own statement of the continuity flow.
// A concurrent double-record cannot create two open periods; the second write fails here.
odometerSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: 'ux_open_period',
    partialFilterExpression: { isDeleted: false, inReading: null },
  },
);
// The chain is ordered by reading (monotonic, FR-2), which is what neighbor lookups walk.
odometerSchema.index({ vehicleId: 1, outReading: -1 }, { name: 'ix_vehicle_reading' });
odometerSchema.index({ vehicleId: 1, date: -1 }, { name: 'ix_vehicle_date' });

export const FleetOdometerLogModel = model<FleetOdometerLogDoc>(
  'FleetOdometerLog',
  odometerSchema,
  'fleet_odometer_logs',
);
