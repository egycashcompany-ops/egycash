// Shift assignments (v1.1 §2, D2) — which shift an employee works, over dated intervals.
// One OPEN interval (`toDate: null`) per employee is the current assignment; a bounded interval —
// down to a single day — is an override that wins over the open one. `branchId` is the ADR-015
// scope field, denormalized from the employee at write time like every HR collection.
import { Schema, model, type Types } from 'mongoose';
import { JOB_VALUE_SOURCES, type JobValueSource } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ShiftAssignmentDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  shiftId: Types.ObjectId;
  /** Date-only (UTC midnight of the Cairo calendar date). */
  fromDate: Date;
  toDate: Date | null;
  note: string | null;
  branchId: Types.ObjectId | null;
  /**
   * P-HR-22 / D-JOB-4 — whether the chosen shift is one the employee's job lists.
   *
   * Derived when the row is written, never accepted from the caller. Absent reads as `manual`,
   * which protects every assignment made before this field existed.
   */
  source: JobValueSource;
}

const shiftAssignmentSchema = new Schema<ShiftAssignmentDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    shiftId: { type: Schema.Types.ObjectId, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, default: null },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    source: { type: String, enum: JOB_VALUE_SOURCES, default: 'manual' },
    ...baseFields,
  },
  baseSchemaOptions,
);

shiftAssignmentSchema.index({ employeeId: 1, fromDate: 1 }, { name: 'ix_employee_fromDate' });
// The design's "partial unique on open interval": at most one current assignment per employee.
shiftAssignmentSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    name: 'ux_open_interval',
    partialFilterExpression: { toDate: null, isDeleted: false },
  },
);

export const ShiftAssignmentModel = model<ShiftAssignmentDoc>(
  'AttendanceShiftAssignment',
  shiftAssignmentSchema,
  'hr_shift_assignments',
);
