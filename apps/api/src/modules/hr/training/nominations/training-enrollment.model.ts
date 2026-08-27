// One person's seat in one session (P-HR-TRN D5, D6, D7).
//
// THE SEAT, not the request. It may exist with no nomination behind it — HR putting somebody in
// directly — which is why `nominationId` is nullable rather than required.
//
// THE STATUS VOCABULARY IS THE WHOLE ONE, and T3 can produce only `enrolled` and `cancelled`.
// `attended`, `absent` and `excused` are marked when the session runs, and `completed` is written
// by the session's completion act (D6, D7) — both T4. It is declared in full now so the badge, the
// mapper and the roster are written once against the shape the design froze.
//
// `occupiesSeat` IN THE RULES DECIDES WHICH OF THEM COUNTS against capacity, and only `cancelled`
// frees one: an absent seat was still taken, and counting it as free would let a session quietly
// overfill on the day it runs.
import { Schema, model, type Types } from 'mongoose';
import { TRAINING_ENROLLMENT_STATUSES, type TrainingEnrollmentStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface TrainingEnrollmentDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  sessionId: Types.ObjectId;
  sessionCode: string;
  courseKey: string;
  status: TrainingEnrollmentStatus;
  /** Null when HR put them in directly rather than through a request. */
  nominationId: Types.ObjectId | null;
  note: string | null;
  cancelledReason: string | null;
  enrolledAt: Date;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}

const trainingEnrollmentSchema = new Schema<TrainingEnrollmentDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    sessionId: { type: Schema.Types.ObjectId, required: true },
    sessionCode: { type: String, required: true },
    courseKey: { type: String, required: true },
    status: {
      type: String,
      enum: TRAINING_ENROLLMENT_STATUSES,
      required: true,
      default: 'enrolled',
    },
    nominationId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    cancelledReason: { type: String, default: null },
    enrolledAt: { type: Date, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

/**
 * ONE LIVE SEAT PER (person, session), and the partial filter is the whole guard.
 *
 * `cancelled` is excluded so somebody whose seat was taken back can be put in again — which is
 * ordinary, and the reason this is not a plain unique index. Every other status is a seat that
 * still exists, so a second one cannot be created while it does. Two approvals racing for the last
 * seat meet this index, and one of them loses cleanly rather than both winning.
 */
trainingEnrollmentSchema.index(
  { employeeId: 1, sessionId: 1 },
  {
    name: 'ux_live_employee_session',
    unique: true,
    partialFilterExpression: { status: { $ne: 'cancelled' }, isDeleted: false },
  },
);
trainingEnrollmentSchema.index({ sessionId: 1, status: 1 }, { name: 'ix_session_status' });
trainingEnrollmentSchema.index({ employeeId: 1, enrolledAt: -1 }, { name: 'ix_employee_enrolledAt' });
trainingEnrollmentSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
trainingEnrollmentSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const TrainingEnrollmentModel = model<TrainingEnrollmentDoc>(
  'HrTrainingEnrollment',
  trainingEnrollmentSchema,
  'hr_training_enrollments',
);
