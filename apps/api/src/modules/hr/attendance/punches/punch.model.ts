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
  /**
   * The EMPLOYEE's branch at the moment of the punch — the reader's axis, and nothing else.
   *
   * Split out in AT-D1 because D12.7 made `branchIdAtPunch` mean what it always said it meant:
   * the DEVICE's location. Until then the two were the same value, so this repository could scope
   * on the evidence field and nobody noticed the conflation. Once they diverge, scoping on
   * evidence would answer a different question than the one a reader is asking — a manager would
   * see punches made ON their wall by other branches' people, and LOSE their own employee's punch
   * made at head office. Reach follows the person; evidence records the place.
   *
   * Nullable only so documents written before AT-D1 still load; the migration backfills them and
   * every write path sets it.
   */
  employeeBranchId: Types.ObjectId | null;
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
    employeeBranchId: { type: Schema.Types.ObjectId, default: null },
    importBatchId: { type: String, default: null },
    supersededBy: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    recordedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

punchSchema.index({ employeeId: 1, at: 1 }, { name: 'ix_employee_at' });
// The reader's axis (AT-D1) — list reads narrow on it, so it is indexed with the instant beside it.
punchSchema.index({ employeeBranchId: 1, at: 1 }, { name: 'ix_employeeBranch_at' });
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
