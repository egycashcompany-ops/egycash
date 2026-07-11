// HR / Recruitment — Interviews (Stage 3). Shared contracts for the third stage of the
// approved seven-stage recruitment workflow: an applicant who passed Initial Screening
// (Stage 2) advances through one or more interview rounds. The number, names, and order of
// the rounds are ADMINISTRATOR-CONFIGURABLE (OQ-31 — two rounds is only the shipped
// default). Each interview is a scheduled round with a panel of one or more interviewers
// and per-interviewer evaluations (domain model: an interviewer evaluates at most once per
// round). Scope is Stage 3 only: nothing here describes Job Offer (Stage 4) or later.
import { z } from 'zod';
import { objectId, LocalizedStringSchema, PaginationQuerySchema, type LocalizedString } from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Interview lifecycle. `scheduled` (a date/time + panel are set) → terminal `completed`
 * (a pass/fail decision was recorded) or `cancelled`. Rescheduling keeps a scheduled
 * interview `scheduled` (only the date/time and panel change).
 */
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
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
    /** The panel — one or more interviewers (domain model: INTERVIEW }o--o{ USER). */
    interviewerIds: z.array(objectId()).min(1).max(20),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type ScheduleInterview = z.infer<typeof ScheduleInterviewSchema>;

/** Reschedule keeps the interview `scheduled`; the panel may be adjusted at the same time. */
export const RescheduleInterviewSchema = z
  .object({
    scheduledAt: z.coerce.date(),
    interviewerIds: z.array(objectId()).min(1).max(20).optional(),
    reason: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type RescheduleInterview = z.infer<typeof RescheduleInterviewSchema>;

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
  status: InterviewStatusSchema.optional(),
  outcome: InterviewOutcomeSchema.optional(),
  applicantId: objectId().optional(),
  stageId: objectId().optional(),
  interviewerId: objectId().optional(),
  branchId: objectId().optional(),
  scheduledFrom: z.coerce.date().optional(),
  scheduledTo: z.coerce.date().optional(),
}).strict();
export type ListInterviewsQuery = z.infer<typeof ListInterviewsQuerySchema>;

// ── Interview DTO ──────────────────────────────────────────────────────────

export interface InterviewEvaluationDto {
  interviewerId: string;
  recommendation: InterviewRecommendation;
  rating: number | null;
  notes: string | null;
  submittedAt: string;
}

export interface InterviewDecisionDto {
  outcome: InterviewDecision;
  notes: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface InterviewDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  branchId: string | null;
  stageId: string;
  stageOrder: number;
  stageName: LocalizedString;
  status: InterviewStatus;
  outcome: InterviewOutcome;
  scheduledAt: string;
  interviewerIds: string[];
  location: string | null;
  notes: string | null;
  evaluations: InterviewEvaluationDto[];
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
  InterviewRescheduled: 'hr.interview.rescheduled',
  InterviewCancelled: 'hr.interview.cancelled',
  InterviewEvaluated: 'hr.interview.evaluated',
  InterviewDecided: 'hr.interview.decided',
} as const;
export type HrInterviewEventName = (typeof HrInterviewEvents)[keyof typeof HrInterviewEvents];

export const InterviewEventPayloadV1 = z.object({
  interviewId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  stageOrder: z.number().int(),
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
