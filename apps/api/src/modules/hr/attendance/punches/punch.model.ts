// Raw punches (v1.1 §2, D1/D9) — the record of truth. IMMUTABLE: no update path exists in the
// service, no soft delete applies (the row is evidence), and a wrong punch is superseded by a
// new one via `supersededBy` with the original retained. Day records are derived from these and
// are always recomputable; these are never derived from anything.
import { Schema, model, type Types } from 'mongoose';
import {
  type AttendancePunchDirection,
  type AttendancePunchSource,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendancePunchDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  at: Date;
  direction: AttendancePunchDirection;
  source: AttendancePunchSource;
  deviceId: string | null;
  /** Where the punch physically happened (D8) — evidence; the payroll axis is the employee's branch. */
  branchIdAtPunch: Types.ObjectId | null;
  importBatchId: string | null;
  /** D9: set once when a later record supersedes this one; the only field that ever changes. */
  supersededBy: Types.ObjectId | null;
  note: string | null;
  recordedBy: Types.ObjectId | null;
}

const punchSchema = new Schema<AttendancePunchDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
    direction: { type: String, required: true, default: 'unknown' },
    source: { type: String, required: true },
    deviceId: { type: String, default: null },
    branchIdAtPunch: { type: Schema.Types.ObjectId, default: null },
    importBatchId: { type: String, default: null },
    supersededBy: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    recordedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

punchSchema.index({ employeeId: 1, at: 1 }, { name: 'ix_employee_at' });
punchSchema.index({ importBatchId: 1 }, { name: 'ix_importBatch' });
// Import idempotency (§3): a device row re-imported is a duplicate, not a second punch.
punchSchema.index(
  { deviceId: 1, at: 1, employeeId: 1 },
  {
    unique: true,
    name: 'ux_device_at_employee',
    partialFilterExpression: { deviceId: { $type: 'string' } },
  },
);

export const AttendancePunchModel = model<AttendancePunchDoc>(
  'AttendancePunch',
  punchSchema,
  'hr_attendance_punches',
);
