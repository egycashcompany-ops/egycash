// The odometer log (fleet design §2.5, FR-2). The model's central invariant is CONTINUITY: one
// physical reading closes the previous period and opens the next, so `inReading` of entry k is
// identically `outReading` of entry k+1. `km` is stored but SERVER-DERIVED — persisted only
// because it is pure arithmetic over two immutable-once-validated fields on the same row, and
// recomputed by the service on every write that touches either.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetOdometerLogDoc extends BaseDocFields {
  /**
   * `null` ONLY on a reading brought across from the old book for a car the registry never had.
   * «احنا بنبقى محتاجين الداتا دى نرجع ليها»: the row is kept, the car is not invented, and
   * `vehicleCode` carries the code the book wrote. Every write path that takes a reading from a
   * person still requires a vehicle; nothing here relaxes that.
   */
  vehicleId: Types.ObjectId | null;
  /** The old book's car code, set only where `vehicleId` is null. */
  vehicleCode: string | null;
  date: Date;
  outReading: number;
  /** null = the vehicle's OPEN period; closed by the next recorded reading. */
  inReading: number | null;
  km: number | null;
  driver1EmployeeId: Types.ObjectId | null;
  driver2EmployeeId: Types.ObjectId | null;
  /**
   * The driver's NAME as the old book wrote it, kept only where HR has no employee for the
   * spelling — a driver who was there and has gone. Set only where the employee id is null.
   */
  driver1Name: string | null;
  driver2Name: string | null;
  notes: string | null;
}

const odometerSchema = new Schema<FleetOdometerLogDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    date: { type: Date, required: true },
    outReading: { type: Number, required: true, min: 0 },
    inReading: { type: Number, default: null },
    km: { type: Number, default: null },
    driver1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    driver2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    driver1Name: { type: String, default: null },
    driver2Name: { type: String, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// AT MOST ONE open period per vehicle — the database's own statement of the continuity flow.
// A concurrent double-record cannot create two open periods; the second write fails here.
//
// Among rows that HAVE a vehicle: a reading kept from the old book for a car the registry never
// had (`vehicleId: null`) is not on any chain, and two such cars' open tails would otherwise
// collide on the one value `null`. `fleet.migration.ts` drops the earlier shape of this index so
// the builder can rebuild it with this filter.
odometerSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: 'ux_open_period',
    partialFilterExpression: { isDeleted: false, inReading: null, vehicleId: { $type: 'objectId' } },
  },
);
// Readings kept by the old book's code, for the code filter and the screen's code column.
odometerSchema.index({ vehicleCode: 1, date: -1 }, { name: 'ix_code_date', sparse: true });
// The chain is ordered by reading (monotonic, FR-2), which is what neighbor lookups walk.
odometerSchema.index({ vehicleId: 1, outReading: -1 }, { name: 'ix_vehicle_reading' });
odometerSchema.index({ vehicleId: 1, date: -1 }, { name: 'ix_vehicle_date' });

export const FleetOdometerLogModel = model<FleetOdometerLogDoc>(
  'FleetOdometerLog',
  odometerSchema,
  'fleet_odometer_logs',
);
