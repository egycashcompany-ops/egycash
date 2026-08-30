// The punch device registry (frozen design v1.3 §17.2, D12.5) — a device is a thing in a place.
//
// BEFORE THIS COLLECTION, `deviceId` WAS A STRING ON A PUNCH. Nothing recorded which devices
// exist, none could be retired, and none could be observed to have stopped reporting. Three
// questions with no answer, and the third is the one that makes device-only attendance dangerous:
// a device that goes quiet marks everybody absent, silently.
//
// `branchId` IS DECLARED AS A SCOPE AXIS on the repository, and that is load-bearing rather than
// decorative: `BaseRepository.scopeFilter` answers an UNDECLARED field with an empty filter and
// `baseFilter` drops the empty clause, so a collection carrying a branch that forgets to say so
// serves the whole organization to a branch-scoped reader — with nothing failing and nothing
// warning. `attendance-scope-guards.spec.ts` holds the declaration in place for that reason.
//
// The code is stored UPPERCASE. A device reporting `hq-gate-1` and one reporting `HQ-GATE-1` are
// one device; without a single normalization the registry would grow a second row for the same
// wall and quietly split its history.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendanceDeviceDoc extends BaseDocFields {
  /** What the device reports on a punch row. Uppercase; the resolution key for `deviceId`. */
  code: string;
  name: string;
  /** D12.7 — where the device stands. This is what a punch records as `branchIdAtPunch`. */
  branchId: Types.ObjectId;
  isActive: boolean;
  note: string | null;
}

const attendanceDeviceSchema = new Schema<AttendanceDeviceDoc>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    isActive: { type: Boolean, required: true, default: true },
    note: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One live row per code — the same partial-unique shape the ATM machine master uses, so a
// deactivated device keeps its code and a soft-deleted one lets the code return.
attendanceDeviceSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
attendanceDeviceSchema.index({ branchId: 1, isActive: 1 }, { name: 'ix_branch_active' });

export const AttendanceDeviceModel = model<AttendanceDeviceDoc>(
  'AttendanceDevice',
  attendanceDeviceSchema,
  'hr_attendance_devices',
);
