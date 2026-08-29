// الأداء — الأهداف (P-HR-PRF §1، القرارات D1، D9، D14).
//
// A GOAL IS ONE THING ONE PERSON IS TRYING TO DO, inside one round. It hangs off the REVIEW rather
// than off the cycle and the employee separately, and that is not a shortcut: opening a cycle
// materializes exactly one review per person in scope (D2), so the review is the row that already
// proves the pair is in the round and carries both scope axes. A goal keyed on `(cycleId,
// employeeId)` would be a second place that fact is asserted, and a day when the two disagree.
//
// A GOAL IS PROGRESSED, NOT SCORED (D9). It records a target, where things currently stand, and a
// status a HUMAN sets. Nothing turns the numbers into a score, nothing turns the statuses into a
// rating, and nothing closes a goal because a date passed:
//
//   • NO WEIGHT. A goal that carried «this one is worth 40%» would be the first half of the
//     weighted average D8 refuses, and the second half is always added later by somebody who finds
//     the field already there.
//   • NO AUTOMATIC TRANSITION. «Target reached, so mark it achieved» sounds like a convenience and
//     is a judgement: a number hit by luck in December is not the same outcome as one hit by work
//     in March, and only a person can say which happened.
//   • NO ROLL-UP. There is no «3 of 5 goals achieved» field, because the moment that number exists
//     somebody puts it beside a rating and the rating stops being a judgement.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

/**
 * Where a goal stands (§4).
 *
 * `dropped` earns its place beside `missed`. A goal abandoned because the company changed
 * direction is not a goal somebody failed, and collapsing the two would make an honest record of
 * a reorganisation read as a record of the people in it underperforming.
 */
export const PERFORMANCE_GOAL_STATUSES = ['active', 'achieved', 'missed', 'dropped'] as const;
export const PerformanceGoalStatusSchema = z.enum(PERFORMANCE_GOAL_STATUSES);
export type PerformanceGoalStatus = z.infer<typeof PerformanceGoalStatusSchema>;

/** The three a goal may be closed into — `active` is where it starts and never returns to. */
export const CLOSED_GOAL_STATUSES = ['achieved', 'missed', 'dropped'] as const;
/**
 * The closed subset as a TYPE, so a screen holding «which outcome» in state needs no cast.
 *
 * Without it every caller writes `status as 'achieved' | 'missed' | 'dropped'`, and a cast is
 * exactly where a fourth outcome added later would fail to be noticed.
 */
export type ClosedGoalStatus = (typeof CLOSED_GOAL_STATUSES)[number];

export const CreatePerformanceGoalSchema = z
  .object({
    reviewId: objectId(),
    /** «Reduce cash-count variance to under 0.2%» — what the person is trying to do, as written. */
    title: z.string().trim().min(3).max(300),
    description: z.string().trim().max(2000).optional(),
    /**
     * The measure, when there is one. THREE OPTIONAL FIELDS AND NO ARITHMETIC OVER THEM.
     *
     * Plenty of real goals are not numeric («hand over the vault procedure to a second person»),
     * so a required number would push people into inventing one — and an invented number is worse
     * than no number, because it looks like a measurement.
     */
    targetValue: z.number().optional(),
    currentValue: z.number().optional(),
    /** As written: «%», «EGP», «incidents». Not a closed list — nobody has given one. */
    unit: z.string().trim().max(30).optional(),
    dueAt: z.coerce.date().optional(),
  })
  .strict();
export type CreatePerformanceGoal = z.infer<typeof CreatePerformanceGoalSchema>;

/** Editing the goal's definition, while it is still `active`. */
export const UpdatePerformanceGoalSchema = z
  .object({
    title: z.string().trim().min(3).max(300).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    targetValue: z.number().nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdatePerformanceGoal = z.infer<typeof UpdatePerformanceGoalSchema>;

/**
 * Recording where things stand — the ONLY write that happens repeatedly on a goal.
 *
 * It is its own endpoint rather than a field on the update, because it is the act somebody does
 * every few weeks while the definition stays put, and because a note explaining the movement is
 * worth far more later than the number by itself.
 */
export const ProgressPerformanceGoalSchema = z
  .object({
    currentValue: z.number().optional(),
    note: z.string().trim().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.currentValue === undefined && (value.note ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'say what moved — a number, a note, or both',
      });
    }
  });
export type ProgressPerformanceGoal = z.infer<typeof ProgressPerformanceGoalSchema>;

/**
 * Closing a goal — a HUMAN saying how it ended (D9).
 *
 * The outcome is given, never inferred from `currentValue` against `targetValue`. A number reached
 * for reasons nobody intended is not an achievement, and a target missed because the work was
 * cancelled is not a failure; the system holds both numbers and has no way to tell those apart.
 */
export const ClosePerformanceGoalSchema = z
  .object({
    status: z.enum(CLOSED_GOAL_STATUSES),
    note: z.string().trim().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== 'achieved' && (value.note ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'a goal that was missed or dropped has to say why',
      });
    }
  });
export type ClosePerformanceGoal = z.infer<typeof ClosePerformanceGoalSchema>;

export const ListPerformanceGoalsQuerySchema = PaginationQuerySchema.extend({
  reviewId: objectId().optional(),
  cycleId: objectId().optional(),
  employeeId: objectId().optional(),
  status: z.union([PerformanceGoalStatusSchema, z.array(PerformanceGoalStatusSchema)]).optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListPerformanceGoalsQuery = z.infer<typeof ListPerformanceGoalsQuerySchema>;

export interface PerformanceGoalDto {
  id: string;
  reviewId: string;
  cycleId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  title: string;
  description: string | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  status: PerformanceGoalStatus;
  dueAt: string | null;
  /** The last note left by `progress` or `close`. The trail lives in the audit log, not here. */
  lastNote: string | null;
  progressedAt: string | null;
  closedAt: string | null;
  version: number;
}

// ── Events (ADR-008) ────────────────────────────────────────────────────────

export const HrPerformanceGoalEvents = {
  Created: 'hr.performanceGoal.created',
  Progressed: 'hr.performanceGoal.progressed',
  Closed: 'hr.performanceGoal.closed',
} as const;
export type HrPerformanceGoalEventName =
  (typeof HrPerformanceGoalEvents)[keyof typeof HrPerformanceGoalEvents];

/**
 * The payload carries NO VALUES, and that is D9 in the event layer.
 *
 * A subscriber handed `currentValue` and `targetValue` is a subscriber one afternoon away from
 * computing a completion rate — and an event is exactly where that happens, because it looks like
 * reporting rather than like inventing a rule.
 */
export const PerformanceGoalEventPayloadV1 = z.object({
  goalId: objectId(),
  reviewId: objectId(),
  cycleId: objectId(),
});
