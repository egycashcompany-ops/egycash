// A request that somebody be taught something (P-HR-TRN D3, D4).
//
// A REQUEST, NOT A SEAT. It may be refused, and a refused nomination stays on the record as the
// thing that happened — the enrollment it would have created lives in its own collection, written
// only when somebody approves this.
//
// THE EMPLOYEE AND THE SESSION ARE DENORMALIZED because the queue crosses hundreds of people and
// must be one query rather than hundreds. These are caches, not the record's permanent snapshot:
// D8's copy-at-write-time argument is about `hr_training_records`, which T4 brings, and a
// nomination is short-lived enough that a rename during it is not the case worth designing for.
//
// BOTH SCOPE AXES, from the EMPLOYEE (D14). A nomination is about a person, so it is readable by
// whoever may read that person — and an undeclared axis is the silent widening P-SCOPE-1 and
// F-REQ-1 were each written to catch.
import { Schema, model, type Types } from 'mongoose';
import { TRAINING_NOMINATION_STATUSES, type TrainingNominationStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface TrainingNominationDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  sessionId: Types.ObjectId;
  sessionCode: string;
  courseKey: string;
  courseNameAr: string;
  courseNameEn: string;
  sessionStartsAt: Date;
  status: TrainingNominationStatus;
  reason: string;
  note: string | null;
  /** Who asked. The two-person rule reads this and nothing else (D3). */
  nominatedBy: Types.ObjectId | null;
  submittedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  /** The seat an approval created. Null until then, and null forever on a refusal. */
  enrollmentId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}

const trainingNominationSchema = new Schema<TrainingNominationDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    sessionId: { type: Schema.Types.ObjectId, required: true },
    sessionCode: { type: String, required: true },
    courseKey: { type: String, required: true },
    courseNameAr: { type: String, required: true },
    courseNameEn: { type: String, required: true },
    sessionStartsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: TRAINING_NOMINATION_STATUSES,
      required: true,
      default: 'pendingApproval',
    },
    reason: { type: String, required: true },
    note: { type: String, default: null },
    nominatedBy: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    enrollmentId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

/**
 * ONE LIVE NOMINATION PER (person, session).
 *
 * Partial on the two statuses that are still going somewhere: a refused nomination must not stop
 * somebody nominating the same person again after the reason for the refusal is gone, and a
 * withdrawn one even less so. Without this, two managers nominating the same person on the same
 * morning would both succeed and one seat would be decided twice.
 */
trainingNominationSchema.index(
  { employeeId: 1, sessionId: 1 },
  {
    name: 'ux_live_employee_session',
    unique: true,
    partialFilterExpression: { status: { $in: ['draft', 'pendingApproval'] }, isDeleted: false },
  },
);
trainingNominationSchema.index({ status: 1, sessionStartsAt: 1 }, { name: 'ix_status_startsAt' });
trainingNominationSchema.index({ sessionId: 1, status: 1 }, { name: 'ix_session_status' });
trainingNominationSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
trainingNominationSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const TrainingNominationModel = model<TrainingNominationDoc>(
  'HrTrainingNomination',
  trainingNominationSchema,
  'hr_training_nominations',
);
