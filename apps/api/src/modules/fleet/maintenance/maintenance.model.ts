// Workshop visits (fleet design §2.6, §4.2). `outDate: null` IS the open state — no status
// field to forget to flip. FR-4's "one open visit per vehicle" is a database invariant, not a
// convention. Visits whose work type counts for the alarm are the ONLY thing that resets the
// maintenance cycle (owner FL-4 point 5).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetMaintenanceVisitDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  inDate: Date;
  outDate: Date | null;
  workshopId: Types.ObjectId;
  workTypeId: Types.ObjectId;
  /**
   * Legacy free text, still ACCEPTED and stored verbatim — see the DTO.
   *
   * The web form does not send it and `sparePartIds` replaced it, but the check-in and update
   * contracts still take it so a caller written before the catalog existed is not refused
   * outright, and the service still writes exactly what it was given. It is never matched against
   * the catalog: guessing which part a spelling meant is the silent data loss the catalog
   * replaced.
   */
  spareParts: string[];
  sparePartIds: Types.ObjectId[];
  odometerAtService: number;
  /** The counter on the way OUT; null while open, and on visits closed before it was collected. */
  exitOdometer: number | null;
  /** Who drove it IN — stored, not read from the roster. Null only on visits predating the field. */
  driverInEmployeeId: Types.ObjectId | null;
  /** Who drove it OUT. Null while open, and on visits predating the field. */
  driverOutEmployeeId: Types.ObjectId | null;
  takenInByEmployeeId: Types.ObjectId | null;
  takenOutByEmployeeId: Types.ObjectId | null;
  notes: string | null;
}

const maintenanceSchema = new Schema<FleetMaintenanceVisitDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    inDate: { type: Date, required: true },
    outDate: { type: Date, default: null },
    workshopId: { type: Schema.Types.ObjectId, required: true },
    workTypeId: { type: Schema.Types.ObjectId, required: true },
    spareParts: { type: [String], default: [] },
    sparePartIds: { type: [Schema.Types.ObjectId], default: [] },
    odometerAtService: { type: Number, required: true, min: 0 },
    exitOdometer: { type: Number, default: null, min: 0 },
    driverInEmployeeId: { type: Schema.Types.ObjectId, default: null },
    driverOutEmployeeId: { type: Schema.Types.ObjectId, default: null },
    takenInByEmployeeId: { type: Schema.Types.ObjectId, default: null },
    takenOutByEmployeeId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// FR-4 — nothing in the domain wants a car in two workshops (the legacy allowed it by accident).
maintenanceSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: 'ux_open_visit',
    partialFilterExpression: { isDeleted: false, outDate: null },
  },
);
maintenanceSchema.index({ vehicleId: 1, outDate: -1 }, { name: 'ix_vehicle_out' });
maintenanceSchema.index({ workTypeId: 1, outDate: -1 }, { name: 'ix_worktype_out' });

export const FleetMaintenanceVisitModel = model<FleetMaintenanceVisitDoc>(
  'FleetMaintenanceVisit',
  maintenanceSchema,
  'fleet_maintenance_visits',
);
