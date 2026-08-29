// One thing one person is trying to do, inside one round (P-HR-PRF D1, D9, D14).
//
// IT HANGS OFF THE REVIEW. The review already proves this person is in this round and already
// carries both scope axes, so keying the goal to it means there is one place that fact lives.
// `cycleId` and `employeeId` are kept beside it as a DENORMALIZATION for querying — «this person's
// goals across rounds» must not be a join — and are written from the review at creation, never
// supplied by a caller.
//
// BOTH AXES, STAMPED FROM THE REVIEW (D14). A goal is about a PERSON, so it is readable by whoever
// may read that person. Fifth collection to carry the requirement, and `performance-scope-guards`
// names it.
//
// NO `weight`, NO `progressPercent`, NO `outcomeScore`. The absence spec forbids all three by name.
// A weight is the first half of the weighted average D8 refuses; a percentage is a rating wearing
// a different unit; and a score is the thing this module exists not to compute.
import { Schema, model, type Types } from 'mongoose';
import { PERFORMANCE_GOAL_STATUSES, type PerformanceGoalStatus } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface PerformanceGoalDoc extends BaseDocFields {
  reviewId: Types.ObjectId;
  cycleId: Types.ObjectId;
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  title: string;
  description: string | null;
  /** The measure, when the goal has one. Recorded; never computed with. */
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  status: PerformanceGoalStatus;
  /** Advisory. Nothing closes a goal because this passed — that would be D9 decided by a clock. */
  dueAt: Date | null;
  /** The last thing somebody wrote about it. The full trail is the audit log's job, not this row's. */
  lastNote: string | null;
  progressedAt: Date | null;
  progressedBy: Types.ObjectId | null;
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}

const performanceGoalSchema = new Schema<PerformanceGoalDoc>(
  {
    ...baseFields,
    reviewId: { type: Schema.Types.ObjectId, required: true },
    cycleId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    targetValue: { type: Number, default: null },
    currentValue: { type: Number, default: null },
    unit: { type: String, default: null },
    status: {
      type: String,
      enum: PERFORMANCE_GOAL_STATUSES,
      required: true,
      default: 'active',
    },
    dueAt: { type: Date, default: null },
    lastNote: { type: String, default: null },
    progressedAt: { type: Date, default: null },
    progressedBy: { type: Schema.Types.ObjectId, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

// NO UNIQUE INDEX, and the absence is the point: several goals per review is the normal case, and
// two goals with the same title are somebody's business rather than a conflict to refuse.
performanceGoalSchema.index({ reviewId: 1, status: 1 }, { name: 'ix_review_status' });
performanceGoalSchema.index({ employeeId: 1, createdAt: -1 }, { name: 'ix_employee_createdAt' });
performanceGoalSchema.index({ cycleId: 1, status: 1 }, { name: 'ix_cycle_status' });
performanceGoalSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const PerformanceGoalModel = model<PerformanceGoalDoc>(
  'HrPerformanceGoal',
  performanceGoalSchema,
  'hr_performance_goals',
);
