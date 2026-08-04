// HR / Recruitment — Initial Screening (Sprint 4.2, Stage 2). Shared contracts for the
// second stage of the approved seven-stage recruitment workflow: an applicant, once
// registered (Stage 1), is screened to a single terminal outcome — Accepted or Rejected
// (OQ-32). "Needs more information" is NOT a state: it is a note added to a screening that
// stays `waiting`. Screening notes and rejection reasons are first-class and stored.
// Scope is Stage 2 only: nothing here describes Interviews (Stage 3) or later.
import { z } from 'zod';
import { objectId, PaginationQuerySchema,
  listQuery,
} from '../common/index.js';
import { EducationLevelSchema } from './hr-recruitment.js';
import {
  BulkRequestBaseSchema,
  type AttemptMarkerDto,
  type PlacementDto,
  type PlacementLabelDto,
} from './hr-recruitment-workflow.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * The screening's single status enum (I10/I11). Every value is PERSISTED: the record is
 * materialized in `waiting` the moment the applicant is registered, so the queue is real rows and
 * never the absence of one. `waiting` = under review, notes may accumulate; `accepted` and
 * `rejected` are the two terminal decisions (OQ-32). A rejected screening transitions its
 * applicant to the terminal `rejected` status; an accepted one leaves the applicant `new` (live).
 * The page's three tabs, the list filter and the counter buckets all use these exact values.
 *
 * `waiting` replaced the former `pending` (I10); stored values are rewritten by the boot
 * migration and `pending` is still accepted as a query alias for one release.
 */
/**
 * `cancelled` is the terminal state a still-`waiting` screening reaches when the CANDIDATE leaves
 * the pipeline — withdrawn, rejected elsewhere, or hired (I14). It is never a decision: the two
 * decisions stay `accepted` / `rejected`. It exists so a departed candidate stops matching the
 * queue through the status itself, rather than through a mirrored lifecycle flag (I1/I10).
 */
export const SCREENING_STATUSES = ['waiting', 'accepted', 'rejected', 'cancelled'] as const;
export const ScreeningStatusSchema = z.enum(SCREENING_STATUSES);
export type ScreeningStatus = z.infer<typeof ScreeningStatusSchema>;

/** The two allowed screening decisions (OQ-32). */
export const SCREENING_OUTCOMES = ['accepted', 'rejected'] as const;
export const ScreeningOutcomeSchema = z.enum(SCREENING_OUTCOMES);
export type ScreeningOutcome = z.infer<typeof ScreeningOutcomeSchema>;

// ── Create / note / decide ──────────────────────────────────────────────────

/**
 * Open a screening for an applicant. Since the record is materialized at registration (I11) this
 * is now a find-or-create that stores an optional first note — kept so the manual "open screening"
 * flow and its permission keep working unchanged.
 */
export const CreateScreeningSchema = z
  .object({
    applicantId: objectId(),
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type CreateScreening = z.infer<typeof CreateScreeningSchema>;

/**
 * Append a note to a `waiting` screening — the "needs more information" flow (OQ-32): the
 * screening stays `waiting`; the note is recorded with author + timestamp.
 */
export const AddScreeningNoteSchema = z
  .object({
    note: z.string().min(1).max(2000),
    version: z.number().int().min(0),
  })
  .strict();
export type AddScreeningNote = z.infer<typeof AddScreeningNoteSchema>;

/**
 * Decide a screening (terminal). `reason` is REQUIRED when rejecting (OQ-32 — rejection
 * reasons must be stored) and optional (recorded as a decision note) when accepting.
 */
export const DecideScreeningSchema = z
  .object({
    outcome: ScreeningOutcomeSchema,
    reason: z.string().min(1).max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.outcome !== 'rejected' || (v.reason !== undefined && v.reason.trim() !== ''), {
    message: 'a reason is required when rejecting an applicant',
    path: ['reason'],
  });
export type DecideScreening = z.infer<typeof DecideScreeningSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * The filter surface, unrefined, so the export schema can still `.omit()` the paging fields —
 * `.refine()` produces a ZodEffects, which has no `.omit()`. Both exported schemas apply the same
 * age-ordering rule below.
 */
const ListScreeningsQueryShape = PaginationQuerySchema.extend({
  /** Doubles as the screening page's tab (I10): waiting | accepted | rejected. */
  status: listQuery(ScreeningStatusSchema),
  applicantId: objectId().optional(),
  branchId: objectId().optional(),
  decidedFrom: z.coerce.date().optional(),
  decidedTo: z.coerce.date().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  /** Include screenings belonging to superseded attempts (default false for queues). */
  includeSuperseded: z.coerce.boolean().default(false),
  search: z.string().max(200).optional(),
  /**
   * Candidate-attribute filters. These live on the APPLICANT, not the screening — the screening
   * denormalizes only what it displays (`applicantCode`, `applicantName`, `branchId`), and I1 is
   * explicit about that list. The service resolves them against `hr_applicants` first and narrows
   * the screening query by id, which is the batched-`$in` shape I3 permits.
   *
   * Age is expressed in whole years and converted to a `birthDate` range at the boundary, so the
   * stored field stays the date it always was. An applicant with no `birthDate` is excluded when
   * either bound is supplied — "unknown age" cannot satisfy a range, and silently including them
   * would make the filter mean nothing.
   */
  ageFrom: z.coerce.number().int().min(0).max(120).optional(),
  ageTo: z.coerce.number().int().min(0).max(120).optional(),
  /** Highest completed education level. Applicants with no education record are excluded. */
  educationLevel: listQuery(EducationLevelSchema),
}).strict();

/** An inverted age range is a validation failure (400), not an empty result the user must decode. */
const AGE_ORDER_ISSUE = {
  message: 'ageFrom must be less than or equal to ageTo',
  path: ['ageFrom'],
};

export const ListScreeningsQuerySchema = ListScreeningsQueryShape.refine(
  (q) => q.ageFrom === undefined || q.ageTo === undefined || q.ageFrom <= q.ageTo,
  AGE_ORDER_ISSUE,
);
export type ListScreeningsQuery = z.infer<typeof ListScreeningsQuerySchema>;

export const ExportScreeningsQuerySchema = ListScreeningsQueryShape.omit({
  page: true,
  pageSize: true,
})
  .strict()
  .refine(
    (q) => q.ageFrom === undefined || q.ageTo === undefined || q.ageFrom <= q.ageTo,
    AGE_ORDER_ISSUE,
  );
export type ExportScreeningsQuery = z.infer<typeof ExportScreeningsQuerySchema>;

// ── Bulk (RW17/I4 — per-item transaction, partial success) ──────────────────

export const BULK_SCREENING_ACTIONS = ['approve', 'reject'] as const;
export const BulkScreeningActionSchema = z.enum(BULK_SCREENING_ACTIONS);
export type BulkScreeningAction = z.infer<typeof BulkScreeningActionSchema>;

export const BulkScreeningsSchema = BulkRequestBaseSchema.extend({
  action: BulkScreeningActionSchema,
})
  .strict()
  .refine((v) => v.action !== 'reject' || (v.reason !== undefined && v.reason.trim() !== ''), {
    path: ['reason'],
    message: 'a reason is required when rejecting applicants',
  });
export type BulkScreenings = z.infer<typeof BulkScreeningsSchema>;

// ── Screening DTO ─────────────────────────────────────────────────────────────

export interface ScreeningNoteDto {
  text: string;
  by: string | null;
  at: string;
}

export interface ScreeningDecisionDto {
  outcome: ScreeningOutcome;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface ScreeningDto extends AttemptMarkerDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name) — tables never show bare codes. */
  applicantName: string;
  /** Data-scope field: follows the applicant on reassignment (RW2 step 3). */
  branchId: string | null;
  status: ScreeningStatus;
  /** The placement in force when the screening was opened; immutable (RW4). */
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  notes: ScreeningNoteDto[];
  /** Present once the screening has been decided; null while `waiting`. */
  decision: ScreeningDecisionDto | null;
  /** Optimistic-concurrency token (__v) — echo back in note/decide. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrScreeningEvents = {
  ScreeningCreated: 'hr.screening.created',
  ScreeningDecided: 'hr.screening.decided',
} as const;
export type HrScreeningEventName = (typeof HrScreeningEvents)[keyof typeof HrScreeningEvents];

export const ScreeningCreatedPayloadV1 = z.object({
  screeningId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
});

export const ScreeningDecidedPayloadV1 = z.object({
  screeningId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  outcome: ScreeningOutcomeSchema,
});
