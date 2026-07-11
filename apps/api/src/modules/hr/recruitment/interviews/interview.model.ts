// The Interview aggregate (Stage 3) — a scheduled interview round with a panel of one or
// more interviewers and per-interviewer evaluations (domain model: INTERVIEW }o--o{ USER;
// an interviewer evaluates at most once per round). `applicantCode`, `branchId`, and the
// stage snapshot (`stageOrder`/`stageName`) are denormalized for list/scoping and stable
// display even if the stage catalog changes later.
import { Schema, model, type Types } from 'mongoose';
import {
  INTERVIEW_OUTCOMES,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  type InterviewOutcome,
  type InterviewRecommendation,
  type InterviewStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface InterviewEvaluation {
  interviewerId: Types.ObjectId;
  recommendation: InterviewRecommendation;
  rating: number | null;
  notes: string | null;
  submittedAt: Date;
}

export interface InterviewDoc extends BaseDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  branchId: Types.ObjectId | null;
  stageId: Types.ObjectId;
  stageOrder: number;
  stageName: LocalizedString;
  status: InterviewStatus;
  outcome: InterviewOutcome;
  scheduledAt: Date;
  interviewerIds: Types.ObjectId[];
  location: string | null;
  notes: string | null;
  evaluations: InterviewEvaluation[];
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
    branchId: { type: Schema.Types.ObjectId, default: null },
    stageId: { type: Schema.Types.ObjectId, required: true },
    stageOrder: { type: Number, required: true },
    stageName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    status: { type: String, enum: INTERVIEW_STATUSES, required: true, default: 'scheduled' },
    outcome: { type: String, enum: INTERVIEW_OUTCOMES, required: true, default: 'pending' },
    scheduledAt: { type: Date, required: true },
    interviewerIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    location: { type: String, default: null },
    notes: { type: String, default: null },
    evaluations: {
      type: [
        new Schema<InterviewEvaluation>(
          {
            interviewerId: { type: Schema.Types.ObjectId, required: true },
            recommendation: { type: String, enum: INTERVIEW_RECOMMENDATIONS, required: true },
            rating: { type: Number, default: null },
            notes: { type: String, default: null },
            submittedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    rescheduleCount: { type: Number, required: true, default: 0 },
    decisionNotes: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    cancelledReason: { type: String, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

interviewSchema.index({ applicantId: 1, stageOrder: 1 }, { name: 'ix_applicant_stage' });
interviewSchema.index({ status: 1, scheduledAt: 1 }, { name: 'ix_status_scheduledAt' });
interviewSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
interviewSchema.index({ interviewerIds: 1, status: 1 }, { name: 'ix_interviewer_status' });
interviewSchema.index({ stageId: 1 }, { name: 'ix_stageId' });

export const InterviewModel = model<InterviewDoc>('Interview', interviewSchema, 'hr_interviews');
