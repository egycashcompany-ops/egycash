// The recruitment timeline (frozen design RW14 / invariants I5, I9) — THE chronological history
// of a candidate, from application to hire. Append-only: entries are never updated and never
// deleted, and the collection is excluded from retention purge, so the history a decision was
// taken against stays readable forever.
//
// Three ids, three jobs (I9):
//   • `eventId`        — the entry's immutable PUBLIC identity: assigned once, time-sortable,
//                        never reused, never rewritten (not even by the repair task).
//   • `correlationId` + `correlationType` — the EPISODE the entry belongs to (an interview round,
//                        a batch, an offer, one placement change), so the UI groups and labels
//                        without inspecting event types.
//   • `sourceKey`      — the internal deterministic idempotency key. Uniquely indexed so the
//                        reconciliation task can rebuild a missing entry and never duplicate one.
//
// Every stage feature writes here through `recruitmentTimelineService.record()` and nowhere else
// (I5: one writer, one history). Reads are scoped by `branchId` like every other HR collection
// (ADR-015); the field follows the applicant on reassignment (RW2 step 3).
import { Schema, model, type Types } from 'mongoose';
import {
  RECRUITMENT_STAGE_KINDS,
  RECRUITMENT_TIMELINE_TYPES,
  TIMELINE_CORRELATION_TYPES,
  type LocalizedString,
  type RecruitmentStageKind,
  type RecruitmentTimelineType,
  type TimelineCorrelationType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

/** The placement in force when the event happened — history shows its own snapshot (RW4a). */
export interface TimelinePlacement {
  jobPositionId: Types.ObjectId | null;
  jobTitleId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  sectionId: Types.ObjectId | null;
}

export interface TimelinePlacementLabel {
  position: string | null;
  branch: string | null;
  department: string | null;
}

export interface RecruitmentTimelineDoc extends BaseDocFields {
  eventId: string;
  applicantId: Types.ObjectId;
  applicantCode: string;
  at: Date;
  actorUserId: Types.ObjectId | null;
  /** Denormalized so history survives user renames and deactivation. */
  actorName: string;
  type: RecruitmentTimelineType;
  correlationType: TimelineCorrelationType;
  correlationId: string;
  stageKind: RecruitmentStageKind | null;
  stageRefId: Types.ObjectId | null;
  stageName: LocalizedString | null;
  fromStatus: string | null;
  toStatus: string | null;
  placement: TimelinePlacement | null;
  placementLabel: TimelinePlacementLabel | null;
  entityType: string | null;
  entityId: Types.ObjectId | null;
  reason: string | null;
  note: string | null;
  /**
   * Set when the attempt this entry belongs to was superseded by a return-to-stage (RW13/A8).
   * A timestamp, never an `isSuperseded` flag (I10). Superseded entries stay fully visible.
   */
  supersededAt: Date | null;
  /** Data scope (ADR-015); follows the applicant on reassignment. */
  branchId: Types.ObjectId | null;
  sourceKey: string;
  metadata: Record<string, unknown>;
}

const placementSchema = new Schema<TimelinePlacement>(
  {
    jobPositionId: { type: Schema.Types.ObjectId, default: null },
    jobTitleId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    sectionId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const placementLabelSchema = new Schema<TimelinePlacementLabel>(
  {
    position: { type: String, default: null },
    branch: { type: String, default: null },
    department: { type: String, default: null },
  },
  { _id: false },
);

const timelineSchema = new Schema<RecruitmentTimelineDoc>(
  {
    eventId: { type: String, required: true },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    at: { type: Date, required: true },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    actorName: { type: String, required: true, default: '' },
    type: { type: String, enum: RECRUITMENT_TIMELINE_TYPES, required: true },
    correlationType: { type: String, enum: TIMELINE_CORRELATION_TYPES, required: true },
    correlationId: { type: String, required: true },
    stageKind: { type: String, enum: RECRUITMENT_STAGE_KINDS, default: null },
    stageRefId: { type: Schema.Types.ObjectId, default: null },
    stageName: {
      type: new Schema<LocalizedString>(
        { ar: { type: String, required: true }, en: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    placement: { type: placementSchema, default: null },
    placementLabel: { type: placementLabelSchema, default: null },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
    note: { type: String, default: null },
    supersededAt: { type: Date, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    sourceKey: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The public identity is unique and immutable (I9).
timelineSchema.index({ eventId: 1 }, { unique: true, name: 'ux_eventId' });
// Idempotency: the reconciliation task rebuilds missing entries without ever duplicating one (I5).
timelineSchema.index({ sourceKey: 1 }, { unique: true, name: 'ux_sourceKey' });
// The candidate's history, newest first — the timeline tab's only query.
timelineSchema.index({ applicantId: 1, at: -1 }, { name: 'ix_applicant_at' });
// Grouped rendering: one card per episode (I9).
timelineSchema.index({ applicantId: 1, correlationId: 1, at: 1 }, { name: 'ix_applicant_correlation' });
// Scoped cross-candidate reads (reports, branch dashboards).
timelineSchema.index({ branchId: 1, at: -1 }, { name: 'ix_branch_at' });
timelineSchema.index({ type: 1, at: -1 }, { name: 'ix_type_at' });

export const RecruitmentTimelineModel = model<RecruitmentTimelineDoc>(
  'RecruitmentTimeline',
  timelineSchema,
  'hr_recruitment_timeline',
);
