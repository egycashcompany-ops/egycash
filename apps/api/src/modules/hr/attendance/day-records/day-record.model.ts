// Derived day records (v1.1 §2/§3) — one answer per employee per work date, NEVER the primary
// evidence: any row is recomputable from punches + calendar + leave, and a bug is fixed by
// correcting an input and recomputing, not by editing a row (→ ADR-027).
//
// `frozenAt` is the §4 guard: once stamped (by the Payroll-owned freeze, AT-4/D-PR-07) the
// engine refuses to overwrite the row, forever. The unique {employeeId, workDate} index is what
// makes recomputation safe — the engine upserts, so running twice cannot answer twice.
import { Schema, model, type Types } from 'mongoose';
import { type AttendanceDayFlag, type AttendanceDayStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendanceDayDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /** UTC-midnight date-only, keyed by SHIFT START (D3). */
  workDate: Date;
  status: AttendanceDayStatus;
  shiftId: Types.ObjectId | null;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  workedMinutes: number;
  /** Raw minutes past grace (D4) — Payroll prices them, this module never does. */
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** Derived by the engine; worth nothing to Payroll until approval releases it (D5). */
  overtimeMinutes: number;
  /** Stamped by the AT-5 approval, always ≤ overtimeMinutes; the only number the feed carries. */
  approvedOvertimeMinutes: number;
  /** The covering leave request when `status = onLeave` (the paid split stays in Leave, R7). */
  leaveId: Types.ObjectId | null;
  flags: AttendanceDayFlag[];
  /** The EMPLOYEE's branch (D8/ADR-015) — the payroll/GL axis, never the punch's. */
  branchId: Types.ObjectId;
  computedAt: Date;
  frozenAt: Date | null;
}

const dayRecordSchema = new Schema<AttendanceDayDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    workDate: { type: Date, required: true },
    status: { type: String, required: true },
    shiftId: { type: Schema.Types.ObjectId, default: null },
    firstInAt: { type: Date, default: null },
    lastOutAt: { type: Date, default: null },
    workedMinutes: { type: Number, required: true, default: 0 },
    lateMinutes: { type: Number, required: true, default: 0 },
    earlyLeaveMinutes: { type: Number, required: true, default: 0 },
    overtimeMinutes: { type: Number, required: true, default: 0 },
    approvedOvertimeMinutes: { type: Number, required: true, default: 0 },
    leaveId: { type: Schema.Types.ObjectId, default: null },
    flags: { type: [String], default: [] },
    branchId: { type: Schema.Types.ObjectId, required: true },
    computedAt: { type: Date, required: true },
    frozenAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

dayRecordSchema.index(
  { employeeId: 1, workDate: 1 },
  { unique: true, name: 'ux_employee_workDate' },
);
dayRecordSchema.index({ workDate: 1, branchId: 1 }, { name: 'ix_workDate_branch' });
dayRecordSchema.index({ status: 1 }, { name: 'ix_status' });

export const AttendanceDayModel = model<AttendanceDayDoc>(
  'AttendanceDay',
  dayRecordSchema,
  'hr_attendance_days',
);
