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
  captainEmployeeId: Types.ObjectId | null;
  specialist1EmployeeId: Types.ObjectId | null;
  specialist2EmployeeId: Types.ObjectId | null;
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
}

const crewAssignmentSchema = new Schema<OperationsCrewAssignmentDoc>(
  {
    operationsDayId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    fleetDutyAssignmentId: { type: Schema.Types.ObjectId, required: true },
    captainEmployeeId: { type: Schema.Types.ObjectId, default: null },
    specialist1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    specialist2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    direction: { type: String, default: null },
    plannedTime: { type: String, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The legacy (car_num, date) identity, normalized: one crew row per vehicle per operating day.
// A concurrent double-plan for the same vehicle-day collides here (the fleet ux_vehicle_date
// precedent); the crew-member half spans three fields and is service-checked (Q11).
crewAssignmentSchema.index(
  { operationsDayId: 1, vehicleId: 1 },
  { unique: true, name: 'ux_day_vehicle', partialFilterExpression: { isDeleted: false } },
);
crewAssignmentSchema.index({ operationsDayId: 1 }, { name: 'ix_day' });

export const OperationsCrewAssignmentModel = model<OperationsCrewAssignmentDoc>(
  'OperationsCrewAssignment',
  crewAssignmentSchema,
  'operations_crew_assignments',
);
