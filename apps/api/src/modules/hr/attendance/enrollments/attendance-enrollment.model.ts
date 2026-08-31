// The device↔employee enrolment map (AT-D3, D12-T·6) — who the device thinks it saw.
//
// WHY THIS COLLECTION HAS TO EXIST, from the confirmed export. The K40 Pro's own export names
// people by `Ac-No`: 257 distinct ids running `1` … `702255`. An ECMS `employeeNumber` is a
// zero-padded global sequence starting `000001`. They are two namespaces that merely look alike,
// and the import keyed on the ECMS one — so a relay forwarding real device rows would have
// resolved nobody, and would have resolved the WRONG PERSON on the day the sequence reached six
// figures. Neither failure announces itself.
//
// THE KEY IS PER DEVICE, and that is a decision rather than an accident. `{deviceId, enrollmentNo}`
// treats two devices as two namespaces until somebody proves otherwise. A per-device key that
// turns out to be globally unique costs one redundant row; a global key that turns out to be
// per-device attributes one person's punches to another, silently, forever.
//
// `enrollmentNo` IS TRIMMED AND NOTHING ELSE — no uppercasing, no numeric normalization. A device
// code is a name a person chose for a wall, so `hq-gate-1` and `HQ-GATE-1` are one wall; an
// enrolment number is an opaque token the device compares byte for byte, where `01` and `1` may be
// two different people. Merging them would join two employees' attendance with nothing to show it.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendanceEnrollmentDoc extends BaseDocFields {
  /** The registered device whose namespace this enrolment belongs to. */
  deviceId: Types.ObjectId;
  /** What the device reports for this person, verbatim. */
  enrollmentNo: string;
  employeeId: Types.ObjectId;
  /**
   * The scope axis, COPIED from the employee on write.
   *
   * Declared for the same reason `attendance-device.model.ts` declares its own: an undeclared
   * scope field makes `BaseRepository.scopeFilter` return an empty filter that `baseFilter` then
   * drops, serving a branch-scoped reader the whole organization with nothing failing.
   */
  employeeBranchId: Types.ObjectId | null;
  note: string | null;
}

const attendanceEnrollmentSchema = new Schema<AttendanceEnrollmentDoc>(
  {
    deviceId: { type: Schema.Types.ObjectId, required: true },
    enrollmentNo: { type: String, required: true, trim: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeBranchId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One enrolment id per device answers to one employee. Partial so a soft-deleted row frees its
// key — a finger re-enrolled under the same id after a correction must be able to be mapped again.
attendanceEnrollmentSchema.index(
  { deviceId: 1, enrollmentNo: 1 },
  { name: 'ux_device_enrollment', unique: true, partialFilterExpression: { isDeleted: false } },
);
// The reader's axis, and the lookup the import performs once per distinct enrolment in a batch.
attendanceEnrollmentSchema.index({ employeeBranchId: 1, enrollmentNo: 1 }, { name: 'ix_branch_enrollment' });
attendanceEnrollmentSchema.index({ employeeId: 1 }, { name: 'ix_employee' });

export const AttendanceEnrollmentModel = model<AttendanceEnrollmentDoc>(
  'HrAttendanceEnrollment',
  attendanceEnrollmentSchema,
  'hr_attendance_enrollments',
);
