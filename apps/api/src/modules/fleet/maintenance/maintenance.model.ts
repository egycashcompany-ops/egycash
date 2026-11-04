// Workshop visits (fleet design §2.6, §4.2). `outDate: null` IS the open state — no status
// field to forget to flip. FR-4's "one open visit per vehicle" is a database invariant, not a
// convention. Visits whose work type counts for the alarm are the ONLY thing that resets the
// maintenance cycle (owner FL-4 point 5).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetMaintenanceVisitDoc extends BaseDocFields {
  /** `null` ONLY on a visit from the old book for a car the registry never had — see the odometer log. */
  vehicleId: Types.ObjectId | null;
  /** The old book's car code, set only where `vehicleId` is null. */
  vehicleCode: string | null;
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
  /** `null` — no counter was written on arrival. */
  odometerAtService: number | null;
  /** The counter on the way OUT; null while open, and on visits closed before it was collected. */
  exitOdometer: number | null;
  /** Who drove it IN — stored, not read from the roster. Null only on visits predating the field. */
  driverInEmployeeId: Types.ObjectId | null;
  /** Who drove it OUT. Null while open, and on visits predating the field. */
  driverOutEmployeeId: Types.ObjectId | null;
  /** The drivers' NAMES as the old book wrote them, where HR has no employee — see the odometer log. */
  driverInName: string | null;
  driverOutName: string | null;
  takenInByEmployeeId: Types.ObjectId | null;
  takenOutByEmployeeId: Types.ObjectId | null;
  notes: string | null;
}

const maintenanceSchema = new Schema<FleetMaintenanceVisitDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    inDate: { type: Date, required: true },
    outDate: { type: Date, default: null },
    workshopId: { type: Schema.Types.ObjectId, required: true },
    workTypeId: { type: Schema.Types.ObjectId, required: true },
    spareParts: { type: [String], default: [] },
    sparePartIds: { type: [Schema.Types.ObjectId], default: [] },
    odometerAtService: { type: Number, default: null, min: 0 },
    exitOdometer: { type: Number, default: null, min: 0 },
    driverInEmployeeId: { type: Schema.Types.ObjectId, default: null },
    driverOutEmployeeId: { type: Schema.Types.ObjectId, default: null },
    driverInName: { type: String, default: null },
    driverOutName: { type: String, default: null },
    takenInByEmployeeId: { type: Schema.Types.ObjectId, default: null },
    takenOutByEmployeeId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// FR-4 — nothing in the domain wants a car in two workshops (the legacy allowed it by accident).
// Among rows that HAVE a vehicle — a visit kept from the old book for a car the registry never
// had is not the car being in two workshops; see the odometer's `ux_open_period`.
maintenanceSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: 'ux_open_visit',
    partialFilterExpression: { isDeleted: false, outDate: null, vehicleId: { $type: 'objectId' } },
  },
);
maintenanceSchema.index({ vehicleCode: 1, inDate: -1 }, { name: 'ix_code_in', sparse: true });
maintenanceSchema.index({ vehicleId: 1, outDate: -1 }, { name: 'ix_vehicle_out' });
maintenanceSchema.index({ workTypeId: 1, outDate: -1 }, { name: 'ix_worktype_out' });
// The visits by CHECK-IN day across the whole fleet (fleet dashboard plan K-22, P1-05): «visits that
// started in [from, to]» for the period tabs and the recent records. Every other index leads with the
// car or the work type, which answers a fleet-wide day question only by walking every car's history.
// It constrains nothing — a read index, not a rule.
maintenanceSchema.index({ inDate: -1 }, { name: 'ix_in_date' });
// Each car's NEWEST visit (`newestVisits`: the alarm board and the period km, every car on every
// read) in one index seek per car, already in the `$sort` order — never its whole history sorted
// in memory. Also the period km's «في الورشة طوال الفترة» (`workshopThroughoutFilter`: the asked
// cars' visits in before the period began). A read index, not a rule.
maintenanceSchema.index({ vehicleId: 1, inDate: -1, _id: -1 }, { name: 'ix_vehicle_in' });
// The visits by CHECK-OUT day across the fleet: the recent records' «checked in OR out on or after
// `since`» (`recentWritten`'s `$or` — each branch needs its own index) and the workshop-now count
// (`outDate: null`, which also matches an old row without the field). A read index, not a rule.
maintenanceSchema.index({ outDate: -1 }, { name: 'ix_out_date' });
// The REGISTER's own order (`GET /fleet/maintenance` opens on «تاريخ الدخول» newest first): live
// visits by check-in day, and `_id` after it — the tie-break `BaseRepository.list` appends to every
// sort. `ix_in_date` answers the day but not the tie-break or the soft delete, so each page was a
// top-k sort in memory and each total read every visit to look at `isDeleted`. A read index.
maintenanceSchema.index({ isDeleted: 1, inDate: -1, _id: -1 }, { name: 'ix_list_in' });

export const FleetMaintenanceVisitModel = model<FleetMaintenanceVisitDoc>(
  'FleetMaintenanceVisit',
  maintenanceSchema,
  'fleet_maintenance_visits',
);
