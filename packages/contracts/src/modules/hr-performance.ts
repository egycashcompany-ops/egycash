// الأداء — الدورة ونطاقها (P-HR-PRF §1، القرارات D1، D2، D3، D8، D14).
//
// A CYCLE IS THE UNIT OF EVERYTHING (D1). No review exists outside one and no goal exists outside
// one, which is what makes «how did this person do in 2026» a question with an answer rather than
// a scan over loose feedback. «Continuous feedback with no cycle» is a different product, and
// building both would leave the company with two answers to the same question.
//
// OPENING IS AN ACT, NOT A DATE (D2). A cycle sits in `draft` while somebody decides who is in it,
// and `open` MATERIALIZES the reviews — one row per employee in scope. That is the same stance the
// recruitment queue takes: «waiting» is a persisted row, never the absence of one, so every queue
// and counter downstream is a plain indexed read instead of a derivation of who *should* be there.
//
// WHAT IS ABSENT ON PURPOSE, each a decision rather than an omission:
//
//   • NO WEIGHTS AND NO COMPUTED RATING (D8, D9). The cycle names a SCALE; the evaluator names a
//     number on it. Nothing averages goal scores into a judgement — weighting is a business rule
//     nobody has given, and arithmetic presented as an assessment is the characteristic failure of
//     a performance module.
//   • NO DISTRIBUTION, NO CURVE, NO RANK (D11). «The top 10% get X» is a real policy and an
//     unstated one. A distribution the company has not agreed to would still produce a list people
//     are treated by.
//   • NO PAY CONSEQUENCE (D12). Nothing here reaches Payroll.
//   • NO INFERRED SCOPE (D3). There is no «everybody employed on date X» rule, because that is
//     really a rule about probation, transfers and unpaid leave that nobody has written down.
import { z } from 'zod';
import {
  objectId,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type LocalizedString,
} from '../common/index.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

/**
 * Where a cycle stands (§4).
 *
 * `draft` is the only state its scope may still change in: once opened, the reviews exist and
 * moving the scope underneath them would orphan rows people have already written on.
 *
 * `closed` is terminal. Re-opening a closed round would put finalized reviews (D7) back into a
 * state that can be written to, which is exactly what «finalized» is supposed to rule out.
 */
export const PERFORMANCE_CYCLE_STATUSES = ['draft', 'open', 'closed'] as const;
export const PerformanceCycleStatusSchema = z.enum(PERFORMANCE_CYCLE_STATUSES);
export type PerformanceCycleStatus = z.infer<typeof PerformanceCycleStatusSchema>;

// ── The scale (D8) ──────────────────────────────────────────────────────────

/**
 * The rating scale, STATED BY THE CYCLE rather than compiled into the module.
 *
 * §8 Q5 asks the owner what the company's scale is, and this is the shape that keeps the question
 * from blocking anything: `1..5` is the default, a company that uses `1..10` or a lettered band
 * says so on the cycle, and every review carries the scale it was rated on. Ratings from two
 * different scales still cannot be COMPARED — but with this they can at least be told apart, which
 * a bare number could not.
 *
 * `labels` is optional and is not a second source of truth for the bounds: it names the points that
 * have names («يحتاج تطوير», «يفوق التوقعات»), and a scale with no labels is a scale of numbers.
 */
export const PerformanceScaleSchema = z
  .object({
    min: z.number().int().min(0).max(100),
    max: z.number().int().min(1).max(100),
    /** One entry per named point. Nothing requires every point to be named. */
    labels: z
      .array(
        z.object({ value: z.number().int().min(0).max(100), name: LocalizedStringSchema }).strict(),
      )
      .max(101)
      .optional(),
  })
  .strict()
  .superRefine((scale, ctx) => {
    if (scale.max <= scale.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max'],
        message: 'a scale has to go somewhere — max must be above min',
      });
    }
    for (const [index, label] of (scale.labels ?? []).entries()) {
      if (label.value < scale.min || label.value > scale.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['labels', index, 'value'],
          message: 'a labelled point has to be a point on this scale',
        });
      }
    }
  });
export type PerformanceScale = z.infer<typeof PerformanceScaleSchema>;

/** What a cycle gets when it names no scale. Stated once, here, so it is one decision. */
export const DEFAULT_PERFORMANCE_SCALE = { min: 1, max: 5 } as const;

// ── The scope (D3) ──────────────────────────────────────────────────────────

const ids = z.array(objectId()).min(1).max(500);

/**
 * Who a cycle is for. Two shapes, and the wide one has to be said out loud.
 *
 * The same stance `AnnouncementAudienceSchema` takes, and for the same reason: an empty filter is
 * not «everybody». A cycle whose last department was removed and not noticed would otherwise open
 * reviews for the whole company — several hundred rows naming evaluators nobody chose. Reaching
 * everybody is `{ kind: 'everyone' }`, and it is never what somebody gets by clearing a field.
 */
export const PerformanceCycleScopeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('everyone') }).strict(),
    z
      .object({
        kind: z.literal('filter'),
        branchIds: ids.optional(),
        departmentIds: ids.optional(),
      })
      .strict(),
  ])
  // The emptiness check sits on the UNION rather than inside the member, because a discriminated
  // union's members must be plain objects — a refined member is a `ZodEffects` and Zod refuses it.
  // `AnnouncementAudienceSchema` hit the same wall and solved it by moving the check onto the
  // field; there is no inner field here to move it to, so it moves outward instead.
  .superRefine((scope, ctx) => {
    if (scope.kind !== 'filter') return;
    if (scope.branchIds === undefined && scope.departmentIds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a filtered cycle needs a branch or a department — use "everyone" for the company',
      });
    }
  });
export type PerformanceCycleScope = z.infer<typeof PerformanceCycleScopeSchema>;

// ── The cycle ───────────────────────────────────────────────────────────────

export const CreatePerformanceCycleSchema = z
  .object({
    /** «H1 2026» — what people call this round, not a generated key. */
    name: LocalizedStringSchema,
    /**
     * The PERIOD BEING REVIEWED, which is not when the reviewing happens.
     *
     * A round run in July assesses January to June, and a review that said «2026» without saying
     * which months would be unreadable the moment a second round exists in the same year.
     */
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    scope: PerformanceCycleScopeSchema,
    scale: PerformanceScaleSchema.optional(),
    /** Advisory, and deliberately not enforced: nothing here closes a review on a date (D9). */
    dueAt: z.coerce.date().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.periodEnd.getTime() < value.periodStart.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEnd'],
        message: 'a period cannot end before it starts',
      });
    }
  });
export type CreatePerformanceCycle = z.infer<typeof CreatePerformanceCycleSchema>;

/**
 * Editing a cycle. Everything here is refused once the cycle is open — the service says so, because
 * «what may change» is a question about the row's state and not about the request's shape.
 */
export const UpdatePerformanceCycleSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    scope: PerformanceCycleScopeSchema.optional(),
    scale: PerformanceScaleSchema.optional(),
    dueAt: z.coerce.date().nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdatePerformanceCycle = z.infer<typeof UpdatePerformanceCycleSchema>;

/**
 * Opening a cycle — the act that materializes the reviews (D2).
 *
 * It takes nothing but the version. Everything the materializer needs is already on the cycle,
 * and an `open` that accepted a scope would be a second place the scope is decided.
 */
export const OpenPerformanceCycleSchema = z.object({ version: z.number().int().min(0) }).strict();
export type OpenPerformanceCycle = z.infer<typeof OpenPerformanceCycleSchema>;

/**
 * Closing a cycle. Refused while any review is still open (§4) — the service names how many, so
 * the refusal tells somebody what to go and do rather than only that they may not.
 */
export const ClosePerformanceCycleSchema = z
  .object({ note: z.string().trim().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type ClosePerformanceCycle = z.infer<typeof ClosePerformanceCycleSchema>;

export const ListPerformanceCyclesQuerySchema = PaginationQuerySchema.extend({
  status: z.union([PerformanceCycleStatusSchema, z.array(PerformanceCycleStatusSchema)]).optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListPerformanceCyclesQuery = z.infer<typeof ListPerformanceCyclesQuerySchema>;

export interface PerformanceCycleDto {
  id: string;
  name: LocalizedString;
  periodStart: string;
  periodEnd: string;
  status: PerformanceCycleStatus;
  scope: PerformanceCycleScope;
  scale: PerformanceScale;
  dueAt: string | null;
  note: string | null;
  /** Written by `open`, and the receipt for what the materializer actually did. */
  openedAt: string | null;
  reviewCount: number;
  closedAt: string | null;
  version: number;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────
//
// Both are FACTS, and neither is consumed by another module. D10 and D12 restated in the event
// layer: publishing that a round opened is not asking Payroll, Attendance or anything else to do
// something about it. A subscriber that computed a consequence from one of these would be inventing
// the rule the design refuses.

export const HrPerformanceEvents = {
  CycleOpened: 'hr.performanceCycle.opened',
  CycleClosed: 'hr.performanceCycle.closed',
} as const;
export type HrPerformanceEventName = (typeof HrPerformanceEvents)[keyof typeof HrPerformanceEvents];

export const PerformanceCycleEventPayloadV1 = z.object({
  cycleId: objectId(),
  /** How many reviews the round carries — the receipt, and the only number either event states. */
  reviewCount: z.number().int().min(0),
});
