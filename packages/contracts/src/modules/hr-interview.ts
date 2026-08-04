// HR / Recruitment — Interviews (Stage 3). Shared contracts for the third stage of the
// approved seven-stage recruitment workflow: an applicant who passed Initial Screening
// (Stage 2) advances through one or more interview rounds. The number, names, and order of
// the rounds are ADMINISTRATOR-CONFIGURABLE (OQ-31 — two rounds is only the shipped
// default). Each interview is a scheduled round with a panel of one or more interviewers
// and per-interviewer evaluations (domain model: an interviewer evaluates at most once per
// round). Scope is Stage 3 only: nothing here describes Job Offer (Stage 4) or later.
import { z } from 'zod';
import {
  objectId,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type LocalizedString,
  listQuery,
} from '../common/index.js';
import {
  BulkRequestBaseSchema,
  type AttemptMarkerDto,
  type PlacementDto,
  type PlacementLabelDto,
} from './hr-recruitment-workflow.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Interview lifecycle. `scheduled` (a date/time + panel are set) → `inProgress` (the interviewer
 * started it — RW12) → terminal `completed` (a pass/fail decision was recorded) or `cancelled`.
 * Rescheduling keeps a scheduled interview `scheduled` (only the date/time and panel change); a
 * round already in progress is completed or cancelled, never rescheduled.
 *
 * `inProgress` was ADDED by the workflow refactor — consumers are tolerant readers (ADR-008), and
 * every existing filter keeps working unchanged.
 */
export const INTERVIEW_STATUSES = [
  'waiting',
  'scheduled',
  'inProgress',
  'completed',
  'cancelled',
] as const;
export const InterviewStatusSchema = z.enum(INTERVIEW_STATUSES);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

/** Round outcome. `pending` until decided; `passed` advances the applicant, `failed` rejects. */
export const INTERVIEW_OUTCOMES = ['pending', 'passed', 'failed'] as const;
export const InterviewOutcomeSchema = z.enum(INTERVIEW_OUTCOMES);
export type InterviewOutcome = z.infer<typeof InterviewOutcomeSchema>;

/** The decision an interview may be closed with (the two terminal outcomes). */
export const INTERVIEW_DECISIONS = ['passed', 'failed'] as const;
export const InterviewDecisionSchema = z.enum(INTERVIEW_DECISIONS);
export type InterviewDecision = z.infer<typeof InterviewDecisionSchema>;

/** A single panel member's recommendation (per-interviewer evaluation). */
export const INTERVIEW_RECOMMENDATIONS = ['recommend', 'neutral', 'notRecommend'] as const;
export const InterviewRecommendationSchema = z.enum(INTERVIEW_RECOMMENDATIONS);
export type InterviewRecommendation = z.infer<typeof InterviewRecommendationSchema>;

/**
 * Per-interviewer evaluation state. `pending` until the panel member acts; `submitted` once
 * they record an evaluation; `skipped` when they are marked absent/excused. A decision is
 * blocked while any panel member is still `pending` (prevents premature decisions without
 * deadlocking on a no-show).
 */
export const INTERVIEW_EVALUATION_STATES = ['pending', 'submitted', 'skipped'] as const;
export const InterviewEvaluationStateSchema = z.enum(INTERVIEW_EVALUATION_STATES);
export type InterviewEvaluationState = z.infer<typeof InterviewEvaluationStateSchema>;

// ── Interview stages (admin-configurable reference catalog, OQ-31) ──────────

export const CreateInterviewStageSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    /** 1-based position in the interview sequence; must be unique among active stages. */
    order: z.number().int().min(1).max(20),
  })
  .strict();
export type CreateInterviewStage = z.infer<typeof CreateInterviewStageSchema>;

export const UpdateInterviewStageSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    order: z.number().int().min(1).max(20).optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateInterviewStage = z.infer<typeof UpdateInterviewStageSchema>;

export const ListInterviewStagesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
}).strict();
export type ListInterviewStagesQuery = z.infer<typeof ListInterviewStagesQuerySchema>;

export interface InterviewStageDto {
  id: string;
  key: string;
  name: LocalizedString;
  order: number;
  active: boolean;
  version: number;
}

// ── Schedule / reschedule / cancel ──────────────────────────────────────────

export const ScheduleInterviewSchema = z
  .object({
    applicantId: objectId(),
    stageId: objectId(),
    scheduledAt: z.coerce.date(),
    /**
     * The interview committee (domain model: INTERVIEW }o--o{ USER). OPTIONAL at scheduling —
     * an interview may be scheduled before a committee is assigned; members are added later via
     * the reassign-panel action. Defaults to an empty committee.
     */
    interviewerIds: z.array(objectId()).max(20).default([]),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type ScheduleInterview = z.infer<typeof ScheduleInterviewSchema>;

/**
 * START AN INTERVIEW IMMEDIATELY (RW12/A3) — the alternative to scheduling. The round is created
 * already `inProgress`: the server assigns the CURRENTLY AUTHENTICATED user as the interviewer,
 * stamps `startedAt` from the server clock, and the client opens the evaluation form straight
 * away. Interviewer and start time are never supplied or edited by the client, which is why this
 * schema carries neither. Works from Screening → first stage and from Interview N → N+1.
 */
export const StartInterviewSchema = z
  .object({
    applicantId: objectId(),
    stageId: objectId(),
    /** Optional co-interviewers; the caller is always on the panel regardless. */
    interviewerIds: z.array(objectId()).max(20).default([]),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type StartInterview = z.infer<typeof StartInterviewSchema>;

/**
 * Start a round that was already SCHEDULED: `scheduled → inProgress`, stamping `startedAt` and
 * `startedBy` server-side and adding the caller to the panel if they are not already on it.
 */
export const StartScheduledInterviewSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type StartScheduledInterview = z.infer<typeof StartScheduledInterviewSchema>;

/** Reschedule only changes the date/time (the interview stays `scheduled`). */
export const RescheduleInterviewSchema = z
  .object({
    scheduledAt: z.coerce.date(),
    reason: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type RescheduleInterview = z.infer<typeof RescheduleInterviewSchema>;

/**
 * Replace the interviewer panel WITHOUT touching the schedule. Retained members keep their
 * evaluation state; newly added members start `pending`; removed members drop off.
 */
export const ReassignInterviewPanelSchema = z
  .object({
    interviewerIds: z.array(objectId()).min(1).max(20),
    version: z.number().int().min(0),
  })
  .strict();
export type ReassignInterviewPanel = z.infer<typeof ReassignInterviewPanelSchema>;

/** Mark an assigned interviewer as skipped/absent so a decision is no longer blocked on them. */
export const SkipInterviewerSchema = z
  .object({
    interviewerId: objectId(),
    reason: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SkipInterviewer = z.infer<typeof SkipInterviewerSchema>;

export const CancelInterviewSchema = z
  .object({
    reason: z.string().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export type CancelInterview = z.infer<typeof CancelInterviewSchema>;

// ── Evaluation (per interviewer) ────────────────────────────────────────────

/**
 * A panel member records their own evaluation; re-submitting replaces their prior one
 * (an interviewer evaluates at most once per round). Only an assigned interviewer may.
 */
export const SubmitInterviewEvaluationSchema = z
  .object({
    recommendation: InterviewRecommendationSchema,
    rating: z.number().int().min(1).max(5).optional(),
    notes: z.string().max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SubmitInterviewEvaluation = z.infer<typeof SubmitInterviewEvaluationSchema>;

// ── Decide (close the round) ────────────────────────────────────────────────

/**
 * Close a scheduled interview with a terminal outcome. `passed` advances the applicant to
 * the next configured stage (or completes the interview phase after the last stage);
 * `failed` transitions the applicant to the terminal `rejected` status.
 */
export const DecideInterviewSchema = z
  .object({
    outcome: InterviewDecisionSchema,
    notes: z.string().max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecideInterview = z.infer<typeof DecideInterviewSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

export const ListInterviewsQuerySchema = PaginationQuerySchema.extend({
  /** Doubles as the stage page's tab (I10): `waiting` lists applicants with no round yet. */
  status: listQuery(InterviewStatusSchema),
  outcome: listQuery(InterviewOutcomeSchema),
  applicantId: objectId().optional(),
  stageId: listQuery(objectId()),
  interviewerId: objectId().optional(),
  branchId: listQuery(objectId()),
  scheduledFrom: z.coerce.date().optional(),
  scheduledTo: z.coerce.date().optional(),
  /** Include rounds belonging to superseded attempts (default false for queues). */
  includeSuperseded: z.coerce.boolean().default(false),
  search: z.string().max(200).optional(),
}).strict();
export type ListInterviewsQuery = z.infer<typeof ListInterviewsQuerySchema>;

/** Per-stage report export; reuses the list filter (paging ignored). */
export const ExportInterviewsQuerySchema = ListInterviewsQuerySchema.omit({
  page: true,
  pageSize: true,
}).strict();
export type ExportInterviewsQuery = z.infer<typeof ExportInterviewsQuerySchema>;

// ── Bulk (RW17/I4 — per-item transaction, partial success) ──────────────────

export const BULK_INTERVIEW_ACTIONS = ['cancel', 'pass', 'fail', 'reassignPanel'] as const;
export const BulkInterviewActionSchema = z.enum(BULK_INTERVIEW_ACTIONS);
export type BulkInterviewAction = z.infer<typeof BulkInterviewActionSchema>;

export const BulkInterviewsSchema = BulkRequestBaseSchema.extend({
  action: BulkInterviewActionSchema,
  /** Required for `reassignPanel`; ignored otherwise. */
  interviewerIds: z.array(objectId()).max(20).optional(),
  notes: z.string().max(2000).optional(),
})
  .strict()
  .refine((v) => v.action !== 'cancel' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to cancel interviews',
  })
  .refine(
    (v) =>
      v.action !== 'reassignPanel' ||
      (v.interviewerIds !== undefined && v.interviewerIds.length > 0),
    { path: ['interviewerIds'], message: 'at least one interviewer is required' },
  );
export type BulkInterviews = z.infer<typeof BulkInterviewsSchema>;

/** Schedule one date/panel across a selection of WAITING applicants (RW17). */
export const BulkScheduleInterviewsSchema = z
  .object({
    applicantIds: z.array(objectId()).min(1).max(200),
    stageId: objectId(),
    scheduledAt: z.coerce.date(),
    interviewerIds: z.array(objectId()).max(20).default([]),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type BulkScheduleInterviews = z.infer<typeof BulkScheduleInterviewsSchema>;

/** Start rounds immediately for a selection of WAITING applicants (RW12 semantics, per item). */
export const BulkStartInterviewsSchema = z
  .object({
    applicantIds: z.array(objectId()).min(1).max(200),
    stageId: objectId(),
    location: z.string().max(200).optional(),
  })
  .strict();
export type BulkStartInterviews = z.infer<typeof BulkStartInterviewsSchema>;

// ── Interview DTO ──────────────────────────────────────────────────────────

/**
 * One panel member and their evaluation state. `recommendation`/`rating`/`notes`/`submittedAt`
 * are populated once `state` is `submitted`; null otherwise (including `pending`/`skipped`).
 */
export interface InterviewPanelistDto {
  interviewerId: string;
  state: InterviewEvaluationState;
  recommendation: InterviewRecommendation | null;
  rating: number | null;
  notes: string | null;
  submittedAt: string | null;
}

export interface InterviewDecisionDto {
  outcome: InterviewDecision;
  notes: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface InterviewDto extends AttemptMarkerDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name) — tables never show bare codes. */
  applicantName: string;
  /** Data-scope field: follows the applicant on reassignment (RW2 step 3). */
  branchId: string | null;
  stageId: string;
  stageKey: string;
  stageOrder: number;
  stageName: LocalizedString;
  /**
   * The round's single status (I10/I11). Every value is PERSISTED, including `waiting`: the record
   * is materialized the moment the candidate reaches the stage, so a queue is never inferred from
   * a missing row.
   */
  status: InterviewStatus;
  outcome: InterviewOutcome;
  /** null while `waiting` — a round that has not been scheduled yet has no date (I11). */
  scheduledAt: string | null;
  /** Server-stamped when the round was started (RW12); null while merely scheduled. */
  startedAt: string | null;
  startedBy: string | null;
  /** The panel: every assigned interviewer with their individual evaluation state. */
  panel: InterviewPanelistDto[];
  location: string | null;
  notes: string | null;
  /** The placement in force when the round was created; immutable (RW4). */
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  /** Advisory: a different seat/branch this round recommends (RW5). Never moves the candidate. */
  recommendedPlacement: PlacementDto | null;
  recommendationNote: string | null;
  decision: InterviewDecisionDto | null;
  rescheduleCount: number;
  cancelledReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrInterviewEvents = {
  InterviewScheduled: 'hr.interview.scheduled',
  /** The round was started — interviewer + timestamp assigned server-side (RW12/I2). */
  InterviewStarted: 'hr.interview.started',
  InterviewRescheduled: 'hr.interview.rescheduled',
  InterviewCancelled: 'hr.interview.cancelled',
  InterviewEvaluated: 'hr.interview.evaluated',
  /**
   * The original decision event. KEPT and still emitted alongside `completed`, so existing
   * subscribers keep working (I2 — names are added to, never renamed).
   */
  InterviewDecided: 'hr.interview.decided',
  InterviewCompleted: 'hr.interview.completed',
} as const;
export type HrInterviewEventName = (typeof HrInterviewEvents)[keyof typeof HrInterviewEvents];

export const InterviewEventPayloadV1 = z.object({
  interviewId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  stageOrder: z.number().int(),
});

export const InterviewStartedPayloadV1 = z.object({
  interviewId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  stageOrder: z.number().int(),
  startedBy: objectId(),
  startedAt: z.coerce.date(),
});

export const InterviewDecidedPayloadV1 = z.object({
  interviewId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  stageOrder: z.number().int(),
  outcome: InterviewDecisionSchema,
  /** True when this was the final configured stage — the applicant cleared all interviews. */
  finalStage: z.boolean(),
});

// ── Notification template keys (seeded at boot by the HR module) ────────────

export const HrInterviewTemplates = {
  Scheduled: 'hr.interviewScheduled',
  Rescheduled: 'hr.interviewRescheduled',
  Cancelled: 'hr.interviewCancelled',
} as const;
