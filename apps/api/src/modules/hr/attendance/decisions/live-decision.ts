// The one question the derivation asks of this feature: "has a manager decided this day?"
//
// IT LIVES IN ITS OWN FILE TO BREAK A CYCLE, and the cycle is real rather than theoretical: the
// decision service recomputes the day it just decided, so it imports `dayRecordService`; if
// `dayRecordService` then imported the decision service back, the two modules would initialise
// into each other. This file imports the model and nothing else, so both sides can depend on it.
//
// It is also in the HOT PATH. Every `days/recompute` from every branch server runs it once per
// employee-day, which on this deployment is a few calls a second all morning — hence the single
// indexed lookup on `ix_employee_workDate_status` and no joins.
import { Types } from 'mongoose';
import { AttendanceDecisionModel, type AttendanceDecisionDoc } from './decision.model';

/** What the engine needs of a decision, and nothing more. */
export interface LiveDecision {
  type: 'markPresent' | 'markAbsent' | 'editTimes';
  inAt: Date | null;
  outAt: Date | null;
}

/**
 * The decision in force for one employee-day, or null.
 *
 * ONLY `applied` COUNTS. A decision waiting for HR (`pendingHr`) has been recorded and has changed
 * nothing — that is the entire meaning of the old-day path — and a `rejected` or `revoked` one has
 * been undone. Reading any of those as live would make the queue decorative.
 *
 * The NEWEST applied decision wins when a day has more than one. That is not arbitrary: the only
 * way to supersede a decision is to revoke it (which takes it out of `applied`) or to record a
 * later one, so the most recent applied row is by construction the standing judgement.
 */
export const liveDecisionFor = async (
  employeeId: string,
  workDate: Date,
): Promise<LiveDecision | null> => {
  const doc = await AttendanceDecisionModel.findOne({
    employeeId: new Types.ObjectId(employeeId),
    workDate,
    status: 'applied',
    type: { $ne: 'revoke' },
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select({ type: 1, inAt: 1, outAt: 1 })
    .lean<Pick<AttendanceDecisionDoc, 'type' | 'inAt' | 'outAt'>>()
    .exec();
  if (doc === null) return null;
  if (doc.type === 'revoke') return null;
  return { type: doc.type, inAt: doc.inAt, outAt: doc.outAt };
};
