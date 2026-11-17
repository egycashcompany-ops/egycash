// Manager day decisions (stage 3) — the record of somebody JUDGING a day rather than the device
// reading one.
//
// WHY THIS IS A SEPARATE COLLECTION and not a field on the day row. A day row is derived: it is
// rewritten every time a branch server calls `days/recompute`, which on this deployment is every
// few seconds all morning. A judgement stored on it would be erased by the next recompute, and the
// one thing a decision must survive is exactly that. Kept here, it is an input to the derivation
// instead of a casualty of it.
//
// NOTHING IS EVER DELETED OR EDITED. A decision that turns out to be wrong is REVOKED, which
// writes a second row pointing back at the first and leaves the first standing, marked `revoked`.
// That is the same discipline the punches follow (superseding, never editing) and for the same
// reason: a correction is a new fact about an old one, and erasing the old one destroys the only
// evidence that the correction was needed.
import { Schema, model, type Types } from 'mongoose';
import { type AttendanceDecisionStatus, type AttendanceDecisionType } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendanceDecisionDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  workDate: Date;
  type: AttendanceDecisionType;
  /** The times a `markPresent` or `editTimes` vouches for; both null on `markAbsent` and `revoke`. */
  inAt: Date | null;
  outAt: Date | null;
  reason: string;
  status: AttendanceDecisionStatus;
  /**
   * The day held device evidence when this was decided. Recorded AT DECISION TIME rather than
   * derived later, because the punches can change afterwards and the question a reviewer asks is
   * what the manager was looking at when they decided.
   */
  overrodePunch: boolean;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  hrDecidedBy: Types.ObjectId | null;
  hrDecidedAt: Date | null;
  hrComment: string | null;
  /** Set on a `revoke` row: the decision it undoes. Null on every other row. */
  revokesId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
}

const decisionSchema = new Schema<AttendanceDecisionDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    workDate: { type: Date, required: true },
    type: { type: String, required: true },
    inAt: { type: Date, default: null },
    outAt: { type: Date, default: null },
    reason: { type: String, required: true },
    status: { type: String, required: true },
    overrodePunch: { type: Boolean, required: true, default: false },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    hrDecidedBy: { type: Schema.Types.ObjectId, default: null },
    hrDecidedAt: { type: Date, default: null },
    hrComment: { type: String, default: null },
    revokesId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The derivation's own lookup: "is there a live decision for this employee-day?", asked once per
// `computeDay` and therefore in the hot path of every branch recompute.
decisionSchema.index({ employeeId: 1, workDate: 1, status: 1 }, { name: 'ix_employee_workDate_status' });
// The HR queue (`pendingHr`) and the §4 accountability read (by manager, newest first).
decisionSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
decisionSchema.index({ decidedBy: 1, createdAt: -1 }, { name: 'ix_decidedBy_createdAt' });

export const AttendanceDecisionModel = model<AttendanceDecisionDoc>(
  'AttendanceDecision',
  decisionSchema,
  'hr_attendance_day_decisions',
);
