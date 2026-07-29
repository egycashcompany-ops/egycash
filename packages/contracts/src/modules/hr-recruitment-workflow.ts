// HR / Recruitment — cross-stage workflow vocabulary (frozen design
// docs/12-planning/recruitment-workflow-design.md). Everything here is shared by MORE than one
// recruitment stage, which is why it lives in its own module contract rather than inside any
// single stage's file: the Placement value object (RW1), the attempt/supersede markers that make
// history append-only (RW13/I1), the candidate Timeline (RW14/I5), the workflow envelope every
// workflow endpoint returns (I6), the shared bulk contract (RW17/I4), and the single aggregated
// stage-counter read model (RW15/I3).
//
// Import direction: this file imports only from `../common`. Stage contracts (hr-recruitment,
// hr-screening, hr-interview, hr-evaluation, hr-job-offer) import FROM here — never the reverse.
import { z } from 'zod';
import { objectId, type LocalizedString } from '../common/index.js';

// ── Placement: Position + Branch (RW1) ──────────────────────────────────────

/**
 * WHERE a candidate is being considered. Every field is nullable: intake may carry no placement
 * at all (a direct application with no requisition — ADR-016), and the placement is completed as
 * the candidate progresses. Moving to the Job Offer stage requires `branchId` plus at least one
 * of `jobPositionId` / `jobTitleId` (RW1).
 */
export const PlacementSchema = z
  .object({
    /** The seat (platform `job_positions`) — carries its own department. */
    jobPositionId: objectId().nullable().default(null),
    /** The role name (platform `job_titles`). */
    jobTitleId: objectId().nullable().default(null),
    departmentId: objectId().nullable().default(null),
    branchId: objectId().nullable().default(null),
    sectionId: objectId().nullable().default(null),
  })
  .strict();
export type Placement = z.infer<typeof PlacementSchema>;

export interface PlacementDto {
  jobPositionId: string | null;
  jobTitleId: string | null;
  departmentId: string | null;
  branchId: string | null;
  sectionId: string | null;
}

/**
 * Denormalized display names captured WITH a placement snapshot, so a historical record still
 * renders correctly after a position is renamed, moved or deactivated (RW4).
 */
export interface PlacementLabelDto {
  position: string | null;
  branch: string | null;
  department: string | null;
}

/** A placement snapshot as stored on a stage record: immutable, never rewritten (RW4). */
export interface PlacementSnapshotDto {
  placement: PlacementDto;
  label: PlacementLabelDto;
  at: string;
}

/** Where a reassignment originated — e.g. accepting an interview panel's recommendation (RW5). */
export const PLACEMENT_CHANGE_SOURCES = ['manual', 'interview', 'evaluation', 'offer'] as const;
export const PlacementChangeSourceSchema = z.enum(PLACEMENT_CHANGE_SOURCES);
export type PlacementChangeSource = z.infer<typeof PlacementChangeSourceSchema>;

/** One audited entry in the applicant's `placementHistory[]` (RW2). */
export interface PlacementChangeDto {
  from: PlacementDto;
  to: PlacementDto;
  fromLabel: PlacementLabelDto;
  toLabel: PlacementLabelDto;
  /** Which dimensions actually moved — drives the per-dimension timeline entries (I2/A2). */
  changed: ('position' | 'branch' | 'department' | 'section' | 'title')[];
  reason: string;
  note: string | null;
  source: PlacementChangeSource;
  sourceRef: { entityType: string; entityId: string } | null;
  by: string | null;
  at: string;
  /** Groups the per-dimension timeline entries produced by this one change (A2). */
  correlationId: string;
}

/**
 * Reassign a live candidate's Position and/or Branch (RW2). NOT part of the applicant PATCH — a
 * routine data correction must never silently move a candidate. A reason is always required.
 * Allowed from Screening through Offer Acceptance; refused once an offer is accepted (RW3/OQ-3).
 */
export const ReassignPlacementSchema = z
  .object({
    placement: PlacementSchema,
    reason: z.string().min(1).max(500),
    note: z.string().max(1000).optional(),
    /** Set when accepting a stage recommendation (RW5); defaults to a manual reassignment. */
    source: PlacementChangeSourceSchema.default('manual'),
    sourceRef: z
      .object({ entityType: z.string().min(1), entityId: objectId() })
      .strict()
      .optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type ReassignPlacement = z.infer<typeof ReassignPlacementSchema>;

/** A stage's advisory placement recommendation (RW5) — never moves the candidate by itself. */
export const SetPlacementRecommendationSchema = z
  .object({
    recommendedPlacement: PlacementSchema.nullable(),
    recommendationNote: z.string().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SetPlacementRecommendation = z.infer<typeof SetPlacementRecommendationSchema>;

// ── Workflow stages, attempts & supersede markers (RW13 / I1) ───────────────

export const RECRUITMENT_STAGE_KINDS = [
  'applicants',
  'screening',
  'interview',
  'evaluation',
  'jobOffer',
  'employeesReady',
] as const;
export const RecruitmentStageKindSchema = z.enum(RECRUITMENT_STAGE_KINDS);
export type RecruitmentStageKind = z.infer<typeof RecruitmentStageKindSchema>;

/**
 * A stage address. `refId` names the concrete interview stage / evaluation phase for the two
 * catalog-driven kinds and is null for the singleton stages.
 */
export const StageRefSchema = z
  .object({ kind: RecruitmentStageKindSchema, refId: objectId().nullable().default(null) })
  .strict();
export type StageRef = z.infer<typeof StageRefSchema>;

export interface StageRefDto {
  kind: RecruitmentStageKind;
  refId: string | null;
  /** Stable key — `screening`, `interview:<id>`, `evaluation:<id>`, … */
  key: string;
  name: LocalizedString | null;
}

/**
 * The append-only attempt marker every stage record carries (RW13/I1). `attempt` starts at 1;
 * returning to a stage opens attempt N+1 and marks the previous one superseded. A superseded
 * record is READ-ONLY forever — the marker itself is the only write it will ever receive.
 */
export interface AttemptMarkerDto {
  attempt: number;
  supersededAt: string | null;
  supersededBy: string | null;
  /** The timeline entry id of the return that superseded this attempt. */
  supersededByReturnId: string | null;
}

/**
 * Return a candidate to an earlier stage (RW13/A8). History is NEVER modified: forward records
 * are superseded (not deleted, not edited), and a fresh attempt opens at the target stage.
 * The reason is mandatory and is carried into the timeline.
 */
export const ReturnToStageSchema = z
  .object({
    target: StageRefSchema,
    reason: z.string().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export type ReturnToStage = z.infer<typeof ReturnToStageSchema>;

/** What a return WILL do — rendered as a confirmation preview before the destructive-looking act. */
export interface ReturnToStagePreviewDto {
  target: StageRefDto;
  /** Records that would be superseded, grouped by kind — nothing is deleted. */
  supersedes: { entityType: string; entityId: string; label: string; status: string }[];
  /** Active offers that would be withdrawn, interviews that would be cancelled. */
  cancels: { entityType: string; entityId: string; label: string }[];
  newAttempt: number;
}

// ── Candidate timeline (RW14 / I5) ──────────────────────────────────────────

/**
 * The complete chronological history of one candidate. This is THE recruitment history (I5):
 * every screen reads it, no screen keeps its own. Append-only and permanently retained.
 */
export const RECRUITMENT_TIMELINE_TYPES = [
  'applied',
  'identityVerified',
  'screeningOpened',
  'screeningDecided',
  // A lifecycle exit closes an undecided screening (I14). That is not a decision, so it has its
  // own type — the same distinction `interviewCancelled` already draws for a round.
  'screeningCancelled',
  'interviewScheduled',
  'interviewStarted',
  'interviewCompleted',
  'interviewCancelled',
  'evaluationOpened',
  'evaluationScheduled',
  'evaluationDecided',
  /** Closed by a lifecycle exit rather than decided (I14). */
  'evaluationCancelled',
  'batchAdded',
  'batchIssued',
  'batchResultRecorded',
  'offerDrafted',
  'offerSent',
  'offerRevised',
  'offerAccepted',
  'offerRejected',
  'offerWithdrawn',
  'offerExpired',
  'hired',
  'positionChanged',
  'branchChanged',
  'returnedToStage',
  'withdrawn',
  'rejected',
  'restored',
  'note',
] as const;
export const RecruitmentTimelineTypeSchema = z.enum(RECRUITMENT_TIMELINE_TYPES);
export type RecruitmentTimelineType = z.infer<typeof RecruitmentTimelineTypeSchema>;

/**
 * The episode a timeline entry belongs to (I9). `correlationId` is the SUBJECT's id — the
 * interview round, the batch, the offer, the placement change — and the type names its kind, so
 * the UI groups and labels entries without inspecting event types.
 */
export const TIMELINE_CORRELATION_TYPES = [
  'applicant',
  'screening',
  'interview',
  'evaluation',
  'batch',
  'offer',
  'placementChange',
  'return',
  'hire',
] as const;
export const TimelineCorrelationTypeSchema = z.enum(TIMELINE_CORRELATION_TYPES);
export type TimelineCorrelationType = z.infer<typeof TimelineCorrelationTypeSchema>;

export interface RecruitmentTimelineEntryDto {
  /**
   * This entry's immutable public identity (I9) — assigned once at write, time-sortable, never
   * reused and never rewritten, including by the reconciliation repair task.
   */
  eventId: string;
  applicantId: string;
  applicantCode: string;
  at: string;
  actorUserId: string | null;
  /** Denormalized at write time so history survives user renames and deletions. */
  actorName: string;
  type: RecruitmentTimelineType;
  stage: StageRefDto | null;
  fromStatus: string | null;
  toStatus: string | null;
  /** The placement in force when the event happened (RW4a: history shows its own snapshot). */
  placement: PlacementDto | null;
  placementLabel: PlacementLabelDto | null;
  /** Deep-link target for "open the record this entry is about". */
  entityRef: { entityType: string; entityId: string } | null;
  reason: string | null;
  note: string | null;
  /** The episode this entry belongs to (I9) — always set, never null. */
  correlationType: TimelineCorrelationType;
  correlationId: string;
  /**
   * When the attempt this entry belongs to was superseded (RW13/A8); null while current.
   * A timestamp, never an `isSuperseded` flag (I10) — superseded entries stay visible.
   */
  supersededAt: string | null;
  metadata: Record<string, unknown>;
}

export const ListRecruitmentTimelineQuerySchema = z
  .object({
    type: RecruitmentTimelineTypeSchema.optional(),
    /** Filter to one episode kind ("all interview activity") or one episode (I9). */
    correlationType: TimelineCorrelationTypeSchema.optional(),
    correlationId: objectId().optional(),
    stageKind: RecruitmentStageKindSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Include entries belonging to superseded attempts (default true — history stays visible). */
    includeSuperseded: z.coerce.boolean().default(true),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();
export type ListRecruitmentTimelineQuery = z.infer<typeof ListRecruitmentTimelineQuerySchema>;

/** Append a free-text note to the candidate's history (the only user-authored entry type). */
export const AddTimelineNoteSchema = z.object({ note: z.string().min(1).max(2000) }).strict();
export type AddTimelineNote = z.infer<typeof AddTimelineNoteSchema>;

/**
 * The timeline slice returned with every workflow response (I6) — what this action just wrote,
 * plus the newest entries, so the client updates its history view with no follow-up request.
 */
export interface TimelineSummaryDto {
  produced: RecruitmentTimelineEntryDto[];
  latest: RecruitmentTimelineEntryDto[];
  total: number;
}

// ── Workflow state + response envelope (I6) ─────────────────────────────────

/** One action the caller may (or may not) take next, with the reason when it is unavailable. */
export interface WorkflowActionDto {
  key: string;
  permission: string;
  enabled: boolean;
  reason: string | null;
}

/**
 * The candidate's CURRENT workflow state, always DERIVED from the latest active attempt (I1) —
 * never stored, never cached, never duplicated on the applicant document.
 */
export interface WorkflowStateDto {
  applicantId: string;
  applicantCode: string;
  applicantStatus: string;
  /** Where the candidate stands now; null once hired or terminally closed. */
  stage: StageRefDto | null;
  /**
   * The stage object's single status enum value (I10) — `waiting` when no active record exists
   * yet. Never a set of booleans, and never a second vocabulary alongside the record's status.
   */
  status: string | null;
  attempt: number;
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  /**
   * What the caller may do next. Capability lives HERE and nowhere else (I10) — there is no
   * `placementEditable` boolean; "can I reassign?" is `availableActions`' `reassign` entry.
   */
  availableActions: WorkflowActionDto[];
}

/**
 * What EVERY recruitment workflow endpoint returns (I6): the updated aggregate, the derived
 * workflow state, the timeline slice this action produced, and the refreshed stage counters —
 * so the frontend never issues an additional request to learn what just happened.
 */
export interface WorkflowEnvelopeDto<T> {
  data: T;
  workflow: WorkflowStateDto;
  timeline: TimelineSummaryDto;
  counters: StageCountDto[];
}

// ── Shared bulk contract (RW17 / I4) ────────────────────────────────────────

/** Every bulk endpoint takes this shape; `action` is narrowed per resource. */
export const BulkRequestBaseSchema = z.object({
  ids: z.array(objectId()).min(1).max(200),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * The universal partial-success envelope. Each item runs in its OWN transaction (I4): its state
 * change, audit entry, domain event and timeline entry commit together or not at all, so a
 * failed item can never leave a half-applied record behind.
 */
export interface BulkActionResultDto {
  requested: number;
  succeeded: number;
  failed: number;
  results: { id: string; ok: boolean; error?: string }[];
}

/** Bulk responses carry the refreshed counters + the timeline entries the batch produced (I6). */
export interface BulkWorkflowResultDto extends BulkActionResultDto {
  timeline: TimelineSummaryDto;
  counters: StageCountDto[];
}

// ── Stage counters — ONE aggregated read model (RW15 / I3) ──────────────────

/**
 * Per-stage queue counts. `count` is ALWAYS the `waiting` bucket — "applicants currently waiting
 * there" — so the number in the navigation is exactly the size of the page's first tab. The other
 * buckets ride along in the same response to fill the tab badges at no extra round trip.
 */
export interface StageCountDto {
  key: string;
  kind: RecruitmentStageKind;
  refId: string | null;
  name: LocalizedString | null;
  route: string;
  /** The permission the caller needed to see this stage at all (stages they can't view are omitted). */
  permission: string;
  count: number;
  buckets: Record<string, number>;
  order: number;
}

export const RecruitmentStageCountsQuerySchema = z
  .object({ branchId: objectId().optional() })
  .strict();
export type RecruitmentStageCountsQuery = z.infer<typeof RecruitmentStageCountsQuerySchema>;

export interface RecruitmentStageCountsDto {
  stages: StageCountDto[];
  /** When the aggregation ran — the client shows staleness rather than guessing. */
  generatedAt: string;
}

// Stage tabs, list filters and counter buckets all use the OBJECT'S OWN STATUS ENUM (I10) —
// there is no second "bucket" vocabulary to keep in sync. Each stage contract owns its enum
// (`InterviewStatus`, `EvaluationStatus`, `ScreeningStatus`, `OfferStatus`), and `waiting` is the
// value meaning "no active record yet": derived at the stage level, never persisted on a record.
// `buckets` on StageCountDto is therefore keyed by that enum's values.

// ── Navigation (RW16 / OQ-2) ────────────────────────────────────────────────
// Stage navigation is DYNAMIC BUSINESS DATA served by the counters endpoint, never Platform
// Application catalog rows. The web sidebar merges these children client-side.

export interface StageNavItemDto {
  key: string;
  label: LocalizedString;
  route: string;
  count: number;
  parentRoute: string;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`; every action emits one — I2) ─

export const HrRecruitmentWorkflowEvents = {
  /** Position and/or Branch reassigned on a live candidate (RW2). */
  PlacementChanged: 'hr.applicant.placementChanged',
  /** Candidate returned to an earlier stage; forward attempts superseded (RW13). */
  ReturnedToStage: 'hr.applicant.returnedToStage',
  /** The candidate became an Employee — the pipeline's terminal success (I2). */
  ApplicantHired: 'hr.applicant.hired',
} as const;
export type HrRecruitmentWorkflowEventName =
  (typeof HrRecruitmentWorkflowEvents)[keyof typeof HrRecruitmentWorkflowEvents];

const placementPayload = z.object({
  jobPositionId: objectId().nullable(),
  jobTitleId: objectId().nullable(),
  departmentId: objectId().nullable(),
  branchId: objectId().nullable(),
  sectionId: objectId().nullable(),
});

export const PlacementChangedPayloadV1 = z.object({
  applicantId: objectId(),
  applicantCode: z.string(),
  from: placementPayload,
  to: placementPayload,
  changed: z.array(z.string()),
  reason: z.string(),
  source: PlacementChangeSourceSchema,
  correlationId: z.string(),
});

export const ReturnedToStagePayloadV1 = z.object({
  applicantId: objectId(),
  applicantCode: z.string(),
  fromStage: z.string(),
  toStage: z.string(),
  newAttempt: z.number().int().min(1),
  supersededCount: z.number().int().min(0),
  reason: z.string(),
});

export const ApplicantHiredPayloadV1 = z.object({
  applicantId: objectId(),
  applicantCode: z.string(),
  employeeId: objectId(),
  employeeCode: z.string(),
  jobOfferId: objectId(),
  placement: placementPayload,
});

// ── The recruitment workflow ENGINE's own event surface (declared at A-2.1) ──
//
// The engine (`apps/api/src/modules/hr/recruitment/workflow/`) publishes one event per validated
// transition and mirrors every one onto the platform bus. Those names were never declared in
// `@ecms/contracts`, so the event catalogue could not see them and an automation could not
// subscribe to a recruitment transition at all. They are declared here for the same reason every
// other event is: the catalogue is only canonical if it is complete.
//
// The payload is the TRANSITION, not the entity: which candidate, which record, and the states it
// moved between. Transition-specific extras ride along and vary by event, which is why this schema
// is read non-strict like every other payload.

export const HrWorkflowEngineEvents = {
  StageEntered: 'hr.recruitment.stageEntered',
  StageLeft: 'hr.recruitment.stageLeft',

  ScreeningAccepted: 'hr.screening.accepted',
  ScreeningRejected: 'hr.screening.rejected',
  ScreeningCancelled: 'hr.screening.cancelled',
  ScreeningRedecided: 'hr.screening.redecided',

  InterviewRedecided: 'hr.interview.redecided',

  EvaluationCancelled: 'hr.evaluation.cancelled',
  EvaluationRedecided: 'hr.evaluation.redecided',
  EvaluationReopened: 'hr.evaluation.reopened',

  OfferSuperseded: 'hr.jobOffer.superseded',

  ApplicantReactivated: 'hr.applicant.reactivated',
} as const;
export type HrWorkflowEngineEventName =
  (typeof HrWorkflowEngineEvents)[keyof typeof HrWorkflowEngineEvents];

export const WorkflowTransitionPayloadV1 = z.object({
  applicantId: objectId(),
  applicantCode: z.string(),
  /** The stage record the transition happened on; absent for applicant-level transitions. */
  entityId: objectId().optional(),
  /** `null` when the record is being materialized — there is no state to have come from. */
  from: z.string().nullable(),
  to: z.string(),
});
