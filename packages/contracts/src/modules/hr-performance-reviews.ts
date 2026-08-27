// الأداء — المراجعة (P-HR-PRF §1، القرارات D2، D4، D5، D6، D7، D14).
//
// A REVIEW IS MATERIALIZED, NOT CREATED. There is no «create a review» endpoint and there will not
// be one: opening a cycle writes one row per employee in scope (D2), which is what makes the queue
// somebody works through a plain indexed read instead of a derivation of who ought to be in it.
// Creating one by hand would put a person in a round the cycle's scope does not name.
//
// THE EVALUATOR IS STORED, NOT DERIVED (D4). The row records who was assigned, defaulted from the
// employee's department manager at the moment the cycle opened. Reading the manager back at display
// time would mean a manager who leaves in October silently becomes the person who reviewed somebody
// in June — a rewriting of history no audit could see happen.
//
// WHAT THIS PHASE SHIPS is the row and the reading of it. `submitted`, `finalized` and `excused`
// are declared here because the state machine is one thing and is written down once (§4) — the
// TRANSITIONS that reach them are P4, along with the evaluator's screen. Until then a materialized
// review can be seen and cannot be written on, and a cycle therefore cannot yet be closed. That is
// stated rather than worked around: a half-open lifecycle is honest, a `finalize` with nowhere to
// write the assessment would not be.
import { z } from 'zod';
import { objectId, PaginationQuerySchema, type LocalizedString } from '../common/index.js';

/**
 * Where one review stands (§4).
 *
 * `draft` is the evaluator thinking. `submitted` is their assessment, handed on. `finalized` is
 * HR closing it, and is IMMUTABLE (D7). `excused` is the person who could not be reviewed this
 * round — newly hired, on long leave, already left — and it is a real outcome rather than a
 * deletion, because a cycle has to be able to say what happened to everybody it opened a row for.
 */
export const PERFORMANCE_REVIEW_STATUSES = ['draft', 'submitted', 'finalized', 'excused'] as const;
export const PerformanceReviewStatusSchema = z.enum(PERFORMANCE_REVIEW_STATUSES);
export type PerformanceReviewStatus = z.infer<typeof PerformanceReviewStatusSchema>;

/** The two states a cycle may close over (§4). Stated once so the guard and the UI agree. */
export const TERMINAL_REVIEW_STATUSES = ['finalized', 'excused'] as const;

export const ListPerformanceReviewsQuerySchema = PaginationQuerySchema.extend({
  cycleId: objectId().optional(),
  employeeId: objectId().optional(),
  evaluatorId: objectId().optional(),
  status: z
    .union([PerformanceReviewStatusSchema, z.array(PerformanceReviewStatusSchema)])
    .optional(),
  branchId: objectId().optional(),
  departmentId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListPerformanceReviewsQuery = z.infer<typeof ListPerformanceReviewsQuerySchema>;

export interface PerformanceReviewDto {
  id: string;
  cycleId: string;
  /** Copied at materialization so a list is one query, and frozen at finalize so it is a record. */
  cycleName: LocalizedString;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** Null when the department had no manager when the cycle opened — assignable, not derived. */
  evaluatorId: string | null;
  evaluatorName: string | null;
  status: PerformanceReviewStatus;
  /** Null until P4 writes one. The scale it is a point on is the CYCLE's (D8). */
  rating: number | null;
  branchId: string | null;
  departmentId: string | null;
  submittedAt: string | null;
  finalizedAt: string | null;
  excusedAt: string | null;
  excusedReason: string | null;
  version: number;
}

/**
 * Assigning the evaluator (D4).
 *
 * The one WRITE this phase ships on a review, and it is here rather than in P4 because
 * materialization can leave it empty: a department with no manager produces rows nobody is
 * responsible for, and a queue of those with no way to fix them would be a phase that opened a
 * round nobody can run. Refused once the review has left `draft` — reassigning after somebody has
 * written an assessment would attribute their words to a person who did not write them.
 */
export const AssignPerformanceEvaluatorSchema = z
  .object({ evaluatorId: objectId(), version: z.number().int().min(0) })
  .strict();
export type AssignPerformanceEvaluator = z.infer<typeof AssignPerformanceEvaluatorSchema>;

/** What `open` did, returned by the transition so the count is a receipt rather than a guess. */
export interface PerformanceCycleOpenResultDto {
  cycleId: string;
  /** Employees the scope matched. */
  matched: number;
  /** Reviews written. Below `matched` only when a row already existed — opening is idempotent. */
  created: number;
  /** Reviews whose department named no manager, and which therefore need assigning by hand. */
  unassigned: number;
}
