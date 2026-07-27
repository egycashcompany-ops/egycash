// Interview + interview-stage DTO mapping (Stage 3). The `decision` block is derived: it is
// null until the round is closed (`completed`), and reflects the terminal outcome.
import {
  type InterviewDecision,
  type InterviewDto,
  type InterviewStageDto,
} from '@ecms/contracts';
import {
  attemptMarkerDto,
  placementDto,
  placementDtoOrNull,
  placementLabelDto,
} from '../workflow/stage-mapper';
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
  applicantName: doc.applicantName ?? '',
  branchId: doc.branchId === null ? null : String(doc.branchId),
  stageId: String(doc.stageId),
  stageKey: doc.stageKey ?? '',
  stageOrder: doc.stageOrder,
  stageName: doc.stageName,
  status: doc.status,
  outcome: doc.outcome,
  // Legacy tolerance: `.lean()` reads skip schema defaults, so fields added by the workflow
  // refactor may be absent on documents written before it — normalize `undefined` too.
  scheduledAt: doc.scheduledAt == null ? null : doc.scheduledAt.toISOString(),
  startedAt: doc.startedAt == null ? null : doc.startedAt.toISOString(),
  startedBy: doc.startedBy == null ? null : String(doc.startedBy),
  placement: placementDto(doc.placementSnapshot),
  placementLabel: placementLabelDto(doc.placementSnapshotLabel),
  recommendedPlacement: placementDtoOrNull(doc.recommendedPlacement),
  recommendationNote: doc.recommendationNote ?? null,
  ...attemptMarkerDto(doc),
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
