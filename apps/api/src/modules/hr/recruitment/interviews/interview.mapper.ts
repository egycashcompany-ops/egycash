// Interview + interview-stage DTO mapping (Stage 3). The `decision` block is derived: it is
// null until the round is closed (`completed`), and reflects the terminal outcome.
import {
  type InterviewDecision,
  type InterviewDto,
  type InterviewStageDto,
} from '@ecms/contracts';
import { type InterviewDoc } from './interview.model';
import { type InterviewStageDoc } from './interview-stage.model';

export const toInterviewStageDto = (doc: InterviewStageDoc): InterviewStageDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  order: doc.order,
  active: doc.active,
  version: doc.__v,
});

export const toInterviewDto = (doc: InterviewDoc): InterviewDto => ({
  id: String(doc._id),
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  stageId: String(doc.stageId),
  stageOrder: doc.stageOrder,
  stageName: doc.stageName,
  status: doc.status,
  outcome: doc.outcome,
  scheduledAt: doc.scheduledAt.toISOString(),
  panel: doc.panel.map((p) => ({
    interviewerId: String(p.interviewerId),
    state: p.state,
    recommendation: p.recommendation,
    rating: p.rating,
    notes: p.notes,
    submittedAt: p.submittedAt === null ? null : p.submittedAt.toISOString(),
  })),
  location: doc.location,
  notes: doc.notes,
  decision:
    doc.status !== 'completed' || doc.decidedAt === null
      ? null
      : {
          outcome: doc.outcome as InterviewDecision,
          notes: doc.decisionNotes,
          decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
          decidedAt: doc.decidedAt.toISOString(),
        },
  rescheduleCount: doc.rescheduleCount,
  cancelledReason: doc.cancelledReason,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
