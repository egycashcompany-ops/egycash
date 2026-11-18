// Quarantined device rows (Task 2 §4) — the scans that arrived and could not be placed.
//
// WHY THEY ARE KEPT NOW. The import has reported its quarantine since §13 and stored none of it,
// which was a fair trade while a batch was a relay's few hundred rows: whoever posted it read the
// response. The history breaks that trade. 153 people are no longer on the machines and so have no
// enrolment link, which means their scans — going back to December 2024 — quarantine on arrival,
// in a nightly batch nobody is watching. A reason returned to a process that is not reading it is
// a dropped row with extra steps.
//
// A ROW HERE IS NOT EVIDENCE OF ATTENDANCE. It is evidence that a scan could not be attributed,
// which is a different fact with a different lifetime: once the enrolment exists the row is
// re-offered to the import and becomes a punch, and from then on the punch is the evidence and
// this is just the note saying it took two attempts. Discarding one asserts that the machine id
// will never be a person here — it deletes nothing, and the punch collection never sees it.
import { Schema, model } from 'mongoose';
import { type AttendancePunchDirection, type AttendanceQuarantineStatus } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AttendanceQuarantineDoc extends BaseDocFields {
  /** The batch that FIRST held this row. A retry records its own batch on the punch, not here. */
  batchId: string;
  /** The device CODE as sent — not an id: an unregistered device is one of the reasons. */
  deviceId: string;
  enrollmentNo: string | null;
  employeeNumber: string | null;
  at: Date;
  direction: AttendancePunchDirection;
  reason: string;
  status: AttendanceQuarantineStatus;
  retries: number;
  firstSeenAt: Date;
  lastTriedAt: Date | null;
  resolvedAt: Date | null;
}

const quarantineSchema = new Schema<AttendanceQuarantineDoc>(
  {
    batchId: { type: String, required: true },
    deviceId: { type: String, required: true, trim: true },
    enrollmentNo: { type: String, default: null, trim: true },
    employeeNumber: { type: String, default: null, trim: true },
    at: { type: Date, required: true },
    direction: { type: String, required: true, default: 'unknown' },
    reason: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    retries: { type: Number, required: true, default: 0 },
    firstSeenAt: { type: Date, required: true },
    lastTriedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// THE IDEMPOTENCY. A branch re-sends its whole file as often as it likes, and the same unplaceable
// scan must stay ONE row with a refreshed reason — not 40 copies after 40 nights. The key is the
// row's own identity, exactly the fields the device sent, and it is partial on `pending` so a row
// that has since been imported or discarded does not block the device re-offering it.
quarantineSchema.index(
  { deviceId: 1, at: 1, enrollmentNo: 1, employeeNumber: 1 },
  {
    name: 'ux_device_at_identity_pending',
    unique: true,
    partialFilterExpression: { status: 'pending' },
  },
);
// The queue read and the «unmatched ids» report, both of which start from the pending rows.
quarantineSchema.index({ status: 1, deviceId: 1, at: 1 }, { name: 'ix_status_device_at' });
// Retrying one enrolment the moment somebody links it.
quarantineSchema.index(
  { deviceId: 1, enrollmentNo: 1, status: 1 },
  { name: 'ix_device_enrollment_status' },
);

export const AttendanceQuarantineModel = model<AttendanceQuarantineDoc>(
  'AttendanceQuarantine',
  quarantineSchema,
  'hr_attendance_quarantine',
);
