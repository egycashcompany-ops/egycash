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
// THE ASSESSMENT ARRIVED IN P4, and with it the four transitions the state machine has always
// described. The half-open lifecycle P2 shipped on purpose is now closed: a round opened can be
// worked, finished and closed.
//
// THE RATING IS AN ARGUMENT, NEVER A COMPUTATION (D8). It arrives from the evaluator and is checked
// against the CYCLE's stated scale — `isOnScale` has sat in `cycle-rules.ts` since P2 waiting for
// exactly this call site. Nothing averages the goals into it, nothing suggests it, and nothing
// defaults it.
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
  /** A point on the CYCLE's scale (D8), written by the evaluator. Null until they submit. */
  rating: number | null;
  /**
   * The assessment in words — the half that matters.
   *
   * A number with no sentence behind it is indefensible in the one conversation this module exists
   * for, and «3» tells nobody anything they can act on. Two fields rather than one box because
   * they are different conversations, and a single box reliably becomes only one of them.
   */
  strengths: string | null;
  improvements: string | null;
  /** Why HR sent it back, kept after the return so the evaluator can see what to change. */
  returnedReason: string | null;
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

// ── The four acts (P4, D6) ──────────────────────────────────────────────────

/**
 * The evaluator's act.
 *
 * Both texts are REQUIRED. An assessment with nothing to improve is not a kind review, it is an
 * unwritten one — and the person reading it a year later, deciding something, gets nothing from a
 * blank half.
 */
export const SubmitPerformanceReviewSchema = z
  .object({
    /**
     * A point on the cycle's scale. The wide bound here is the SHAPE; the round's own `min`/`max`
     * is the rule, and the service checks it — a schema cannot know which cycle this review is in.
     */
    rating: z.number().int().min(0).max(100),
    strengths: z.string().trim().min(10).max(4000),
    improvements: z.string().trim().min(10).max(4000),
    version: z.number().int().min(0),
  })
  .strict();
export type SubmitPerformanceReview = z.infer<typeof SubmitPerformanceReviewSchema>;

/**
 * HR sending it back, with a reason.
 *
 * IT CLEARS NOTHING. The rating and both texts stay exactly as written, so the evaluator edits
 * rather than retypes. A return that wiped the work would make «send it back for one sentence» the
 * most expensive thing HR could do, and the predictable result is that nobody would ever do it —
 * which turns the return into a button that exists and is never pressed.
 */
export const ReturnPerformanceReviewSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
    version: z.number().int().min(0),
  })
  .strict();
export type ReturnPerformanceReview = z.infer<typeof ReturnPerformanceReviewSchema>;

/**
 * HR closing it (D6) — the act that makes the row immutable (D7).
 *
 * IT TAKES NO ASSESSMENT OF ITS OWN. Finalizing is agreeing that what the evaluator wrote is the
 * record, not writing over it. A `finalize` that accepted a rating would put a second author on
 * one person's assessment with nothing in the row to say which of them meant it.
 */
export const FinalizePerformanceReviewSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type FinalizePerformanceReview = z.infer<typeof FinalizePerformanceReviewSchema>;

/**
 * Somebody who could not be reviewed this round — newly hired, on long leave, already left.
 *
 * A REAL OUTCOME, NOT A DELETION. The round has to be able to say what happened to everybody it
 * opened a row for, and «excused, because they joined in November» is an answer where a missing
 * row is not. It is also what lets a cycle close without pretending.
 */
export const ExcusePerformanceReviewSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
    version: z.number().int().min(0),
  })
  .strict();
export type ExcusePerformanceReview = z.infer<typeof ExcusePerformanceReviewSchema>;

// ── Events (ADR-008) ────────────────────────────────────────────────────────

export const HrPerformanceReviewEvents = {
  Submitted: 'hr.performanceReview.submitted',
  Returned: 'hr.performanceReview.returned',
  Finalized: 'hr.performanceReview.finalized',
  Excused: 'hr.performanceReview.excused',
} as const;
export type HrPerformanceReviewEventName =
  (typeof HrPerformanceReviewEvents)[keyof typeof HrPerformanceReviewEvents];

/**
 * THE PAYLOAD CARRIES NO RATING, and that is D12 in the event layer.
 *
 * `hr.performanceReview.finalized` is the single most attractive event in this system to hang a
 * consequence off — a bonus, a flag, a letter. Publishing the number would make that a five-line
 * subscriber, written in good faith, implementing a pay rule nobody has ever stated. A consumer
 * that genuinely needs the assessment can read the review through the API, where the permission
 * that gates it still applies.
 */
export const PerformanceReviewEventPayloadV1 = z.object({
  reviewId: objectId(),
  cycleId: objectId(),
  employeeId: objectId(),
});
