// The Interview aggregate (Stage 3) — a scheduled interview round with a panel of one or
// more interviewers and per-interviewer evaluations (domain model: INTERVIEW }o--o{ USER;
// an interviewer evaluates at most once per round). `applicantCode`, `branchId`, and the
// stage snapshot (`stageOrder`/`stageName`) are denormalized for list/scoping and stable
// display even if the stage catalog changes later.
import { Schema, model, type Types } from 'mongoose';
import {
  INTERVIEW_EVALUATION_STATES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  type InterviewEvaluationState,
  type InterviewOutcome,
  type InterviewRecommendation,
  type InterviewStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';
import {
  placementSchema,
  stageFields,
  type StageDocFields,
  type StagePlacement,
} from '../workflow/stage-fields';

/** One panel member and their evaluation. Evaluation fields are set only when `submitted`. */
export interface InterviewPanelist {
  interviewerId: Types.ObjectId;
  state: InterviewEvaluationState;
  recommendation: InterviewRecommendation | null;
  rating: number | null;
  notes: string | null;
  submittedAt: Date | null;
}

export interface InterviewDoc extends BaseDocFields, StageDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  branchId: Types.ObjectId | null;
  stageId: Types.ObjectId;
  stageOrder: number;
  stageName: LocalizedString;
  status: InterviewStatus;
  outcome: InterviewOutcome;
  /** null while `waiting` — a round that has not been scheduled yet has no date (I11). */
  scheduledAt: Date | null;
  startedAt: Date | null;
  startedBy: Types.ObjectId | null;
  /** Advisory placement this round recommends (RW5); never moves the candidate by itself. */
  recommendedPlacement: StagePlacement | null;
  recommendationNote: string | null;
  stageKey: string;
  panel: InterviewPanelist[];
  location: string | null;
  notes: string | null;
  rescheduleCount: number;
  // Decision (set once, when the round is closed).
  decisionNotes: string | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  // Cancellation.
  cancelledReason: string | null;
  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;
}

const interviewSchema = new Schema<InterviewDoc>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    applicantName: { type: String, required: true, default: '' },
    branchId: { type: Schema.Types.ObjectId, default: null },
    stageId: { type: Schema.Types.ObjectId, required: true },
    stageOrder: { type: Number, required: true },
    stageName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    status: { type: String, enum: INTERVIEW_STATUSES, required: true, default: 'waiting' },
    outcome: { type: String, enum: INTERVIEW_OUTCOMES, required: true, default: 'pending' },
    scheduledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    startedBy: { type: Schema.Types.ObjectId, default: null },
    recommendedPlacement: { type: placementSchema, default: null },
    recommendationNote: { type: String, default: null },
    stageKey: { type: String, required: true, default: '' },
    panel: {
      type: [
        new Schema<InterviewPanelist>(
          {
            interviewerId: { type: Schema.Types.ObjectId, required: true },
            state: { type: String, enum: INTERVIEW_EVALUATION_STATES, required: true, default: 'pending' },
            recommendation: { type: String, enum: INTERVIEW_RECOMMENDATIONS, default: null },
            rating: { type: Number, default: null },
            notes: { type: String, default: null },
            submittedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    location: { type: String, default: null },
    notes: { type: String, default: null },
    rescheduleCount: { type: Number, required: true, default: 0 },
    decisionNotes: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    cancelledReason: { type: String, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    ...stageFields,
    ...baseFields,
  },
  baseSchemaOptions,
);

// I12 — one ACTIVE record per (applicant, stage, attempt).
interviewSchema.index(
  { applicantId: 1, stageId: 1, attempt: 1 },
  {
    unique: true,
    name: 'ux_interview_applicant_stage_attempt',
    partialFilterExpression: { supersededAt: null, isDeleted: false },
  },
);
interviewSchema.index({ applicantId: 1, stageOrder: 1 }, { name: 'ix_applicant_stage' });
// Per-stage queues + the counters aggregation.
interviewSchema.index({ stageId: 1, status: 1 }, { name: 'ix_stage_status' });
interviewSchema.index({ status: 1, scheduledAt: 1 }, { name: 'ix_status_scheduledAt' });
interviewSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
interviewSchema.index({ 'panel.interviewerId': 1, status: 1 }, { name: 'ix_interviewer_status' });
interviewSchema.index({ stageId: 1 }, { name: 'ix_stageId' });

export const InterviewModel = model<InterviewDoc>('Interview', interviewSchema, 'hr_interviews');
