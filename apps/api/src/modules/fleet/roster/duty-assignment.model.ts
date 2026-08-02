// The daily duty assignment (fleet design §2.7) — one row per (vehicle, date), the upsert
// target of every plan save. This row is the OPS boundary: OPS will attach work orders to it;
// Fleet owns who/which/what-kind per day. There is deliberately NO soft-delete surface:
// clearing a day's plan empties the row's facts in place, so the planning trail never loses
// the row the history hangs on (owner FL-5 point 5).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetDutyAssignmentDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  /** Normalized to UTC midnight — the pair (vehicleId, date) IS the row's identity. */
  date: Date;
  missionTypeId: Types.ObjectId | null;
  driver1EmployeeId: Types.ObjectId | null;
  driver2EmployeeId: Types.ObjectId | null;
  notes: string | null;
}

const dutyAssignmentSchema = new Schema<FleetDutyAssignmentDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    missionTypeId: { type: Schema.Types.ObjectId, default: null },
    driver1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    driver2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// FR-7's vehicle half — one assignment row per (vehicle, date). A concurrent double-plan for
// the same vehicle-day collides here; the driver half spans two fields and is service-checked.
dutyAssignmentSchema.index(
  { vehicleId: 1, date: 1 },
  { unique: true, name: 'ux_vehicle_date', partialFilterExpression: { isDeleted: false } },
);
dutyAssignmentSchema.index({ date: 1 }, { name: 'ix_date' });

export const FleetDutyAssignmentModel = model<FleetDutyAssignmentDoc>(
  'FleetDutyAssignment',
  dutyAssignmentSchema,
  'fleet_duty_assignments',
);
