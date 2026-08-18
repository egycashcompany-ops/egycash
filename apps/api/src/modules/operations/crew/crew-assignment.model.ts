// The cash-transfer crew assignment — the legacy tashghela row normalized (discovery §8): one row
// per (operating day, vehicle) holding captain + specialist 1/2 + direction/time/notes. This row
// is what later slices resolve crews through: `day + vehicle → crew`, and with the shipment legs,
// `day + vehicle + leg → crew` — the legacy (car_num, date) join preserved as an entity instead of
// being duplicated onto every shipment (discovery §4.1: specialists were NEVER on the shipment).
//
// The row ANCHORS on the Fleet duty assignment for the same (vehicle, date) — the frozen §9.4
// boundary: Fleet owns (vehicle, drivers, mission type)/day; Operations attaches the cash crew to
// that row by id and never re-models it. Legacy `tybe` therefore has no field here (it is Fleet's
// missionTypeId); legacy `car_status` arrives with the vault/dispatch slice that writes it.
//
// Upsert-in-place per (day, vehicle) exactly as legacy replaced the tashghela row
// (contad_app.js:2413) — no history row; the audit trail carries the changes.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsCrewAssignmentDoc extends BaseDocFields {
  operationsDayId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  fleetDutyAssignmentId: Types.ObjectId;
  /**
   * The three slots, each now holding up to `CREW_SLOT_CAPACITY` people (six per vehicle). The
   * cap is a contract rule (`PlanOperationsCrewRowSchema`), enforced where the payload arrives
   * rather than restated here — Mongoose runs document validators on `save()` and this row is
   * only ever written through an upsert, so a schema validator would be decoration.
   *
   * WHY THE FIELDS ARE RENAMED AND NOT WIDENED IN PLACE. Mongo matches `{ captainEmployeeId: x }`
   * against an ARRAY containing `x` just as happily as against the scalar `x`. Had the names
   * stayed, every stored query — including `findForCaptainDay`, the captaincy anchor of the whole
   * mobile identity chain — would have gone on returning the right documents while every
   * `String(row.captainEmployeeId) === employeeId` in TypeScript quietly became false for a
   * two-captain crew. That is a defect that passes its own tests. Renaming makes the compiler
   * enumerate all 24 call sites instead.
   */
  captainEmployeeIds: Types.ObjectId[];
  specialist1EmployeeIds: Types.ObjectId[];
  specialist2EmployeeIds: Types.ObjectId[];
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
}

/** Empty slot = `[]`. There is no null slot: "nobody assigned" is a list of nobody. */
const crewSlot = {
  type: [Schema.Types.ObjectId],
  default: (): Types.ObjectId[] => [],
};

const crewAssignmentSchema = new Schema<OperationsCrewAssignmentDoc>(
  {
    operationsDayId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    fleetDutyAssignmentId: { type: Schema.Types.ObjectId, required: true },
    captainEmployeeIds: crewSlot,
    specialist1EmployeeIds: crewSlot,
    specialist2EmployeeIds: crewSlot,
    // The pre-capacity `captainEmployeeId` / `specialist1EmployeeId` / `specialist2EmployeeId`
    // columns are deliberately ABSENT from this map, and their DATA is deliberately still in the
    // collection. Nothing deletes them — `migrateCrewSlotsToArrays` reads them, converts them, and
    // leaves them exactly as written, because the source of a conversion is the only way to check
    // it afterwards. What un-mapping them buys is the thing a `@deprecated` comment cannot: with
    // the paths off the document type, `row.captainEmployeeId` stops compiling. Left declared,
    // every one of the 24 reads this rename is meant to surface would have gone on type-checking
    // while returning null — the same silent-success failure that made the rename necessary.
    direction: { type: String, default: null },
    plannedTime: { type: String, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The legacy (car_num, date) identity, normalized: one crew row per vehicle per operating day.
// A concurrent double-plan for the same vehicle-day collides here (the fleet ux_vehicle_date
// precedent); the crew-member half spans three multi-valued fields and is service-checked (Q11).
crewAssignmentSchema.index(
  { operationsDayId: 1, vehicleId: 1 },
  { unique: true, name: 'ux_day_vehicle', partialFilterExpression: { isDeleted: false } },
);
crewAssignmentSchema.index({ operationsDayId: 1 }, { name: 'ix_day' });
// "Which vehicles am I a captain of today?" — the captaincy anchor the mobile surface resolves
// identity through (design §20-هـ). Without it that read is a day-wide scan filtered in memory.
// MULTIKEY now, and under a NEW NAME: `ix_day_captain` indexed the retired scalar, and an index
// keeps its key spec for its lifetime, so re-declaring the same name over a different field is a
// conflict rather than a change. The stale index is left in place on existing databases — it now
// covers a column that is always null, which costs nothing to keep and would cost a boot-time
// `dropIndex` to remove.
crewAssignmentSchema.index(
  { operationsDayId: 1, captainEmployeeIds: 1 },
  { name: 'ix_day_captains' },
);

export const OperationsCrewAssignmentModel = model<OperationsCrewAssignmentDoc>(
  'OperationsCrewAssignment',
  crewAssignmentSchema,
  'operations_crew_assignments',
);
