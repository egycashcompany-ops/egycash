// One person's review in one round (P-HR-PRF D2, D4, D6, D7, D14).
//
// THE ROW EXISTS BEFORE ANYBODY WRITES ON IT. Opening a cycle materializes one of these per
// employee in scope, exactly as recruitment's queue materializer opens a `waiting` stage record:
// «not started» is a persisted status, never the absence of a row. That is what makes every queue,
// counter and badge downstream a plain indexed read instead of a derivation of who ought to be
// there — and it is what lets a round say what happened to everybody, including the people nobody
// got to.
//
// BOTH AXES, STAMPED FROM THE EMPLOYEE (D14). This is the fourth collection to carry a spec that
// requires them, after Payroll's and Recruitment's each caught the same silent widening:
// `BaseRepository.scopeFilter` answers an undeclared scope field with an EMPTY filter, `baseFilter`
// drops the empty clause, and a department-scoped reader is quietly served the whole company.
//
// THE DENORMALIZED NAMES ARE A CACHE UNTIL FINALIZE AND A SNAPSHOT AFTER IT (D7) — the same two
// lives the training record's copy has. While the review is open they save a lookup per row; the
// moment it is finalized they stop tracking their sources, because a department renamed in 2028
// must not change what a 2026 review says.
import { Schema, model, type Types } from 'mongoose';
import {
  PERFORMANCE_REVIEW_STATUSES,
  type LocalizedString,
  type PerformanceReviewStatus,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface PerformanceReviewDoc extends BaseDocFields {
  cycleId: Types.ObjectId;
  cycleName: LocalizedString;
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  /**
   * The assigned evaluator, AS AN EMPLOYEE and not as a login (D4).
   *
   * A manager is a person in the org chart; whether IT has created them an account is a separate
   * fact with its own timing. Keying this to a user id would make a review unassignable because
   * somebody has no login yet, and would break the assignment the day the login is replaced. P4
   * answers «is the caller this evaluator» by finding the employee whose `userId` is the caller —
   * one lookup, in the direction that survives both.
   *
   * Null when nothing named a manager to default to; `assignEvaluator` is how that is fixed.
   */
  evaluatorId: Types.ObjectId | null;
  evaluatorName: string | null;
  status: PerformanceReviewStatus;
  /** A point on the CYCLE's scale (D8). Written by P4; nothing computes it. */
  rating: number | null;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  submittedAt: Date | null;
  submittedBy: Types.ObjectId | null;
  finalizedAt: Date | null;
  finalizedBy: Types.ObjectId | null;
  excusedAt: Date | null;
  excusedBy: Types.ObjectId | null;
  excusedReason: string | null;
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const performanceReviewSchema = new Schema<PerformanceReviewDoc>(
  {
    ...baseFields,
    cycleId: { type: Schema.Types.ObjectId, required: true },
    cycleName: { type: localized, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    evaluatorId: { type: Schema.Types.ObjectId, default: null },
    evaluatorName: { type: String, default: null },
    status: {
      type: String,
      enum: PERFORMANCE_REVIEW_STATUSES,
      required: true,
      default: 'draft',
    },
    rating: { type: Number, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, default: null },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: Schema.Types.ObjectId, default: null },
    excusedAt: { type: Date, default: null },
    excusedBy: { type: Schema.Types.ObjectId, default: null },
    excusedReason: { type: String, default: null },
  },
  baseSchemaOptions,
);

// ONE REVIEW PER PERSON PER ROUND. Two would each claim to be the assessment of the same period,
// and nothing downstream could say which one the raise was based on. This is also what makes
// opening IDEMPOTENT: a re-run of the materializer finds the row rather than minting a second.
performanceReviewSchema.index(
  { cycleId: 1, employeeId: 1 },
  { unique: true, name: 'ux_cycle_employee', partialFilterExpression: { isDeleted: false } },
);
performanceReviewSchema.index({ cycleId: 1, status: 1 }, { name: 'ix_cycle_status' });
performanceReviewSchema.index({ evaluatorId: 1, status: 1 }, { name: 'ix_evaluator_status' });
performanceReviewSchema.index({ employeeId: 1, createdAt: -1 }, { name: 'ix_employee_createdAt' });
performanceReviewSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

export const PerformanceReviewModel = model<PerformanceReviewDoc>(
  'HrPerformanceReview',
  performanceReviewSchema,
  'hr_performance_reviews',
);
