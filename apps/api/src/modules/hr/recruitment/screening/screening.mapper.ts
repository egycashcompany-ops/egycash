// Screening DTO mapping (Sprint 4.2, Stage 2). The `decision` block is derived: it is null
// while the screening is `waiting`, and reflects the terminal status once decided.
import { type ScreeningDto, type ScreeningOutcome } from '@ecms/contracts';
import {
  attemptMarkerDto,
  placementDto,
  placementLabelDto,
} from '../workflow/stage-mapper';
import { type ScreeningDoc } from './screening.model';

export const toScreeningDto = (doc: ScreeningDoc): ScreeningDto => ({
  id: String(doc._id),
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  applicantName: doc.applicantName ?? '',
  branchId: doc.branchId == null ? null : String(doc.branchId),
  status: doc.status,
  placement: placementDto(doc.placementSnapshot),
  placementLabel: placementLabelDto(doc.placementSnapshotLabel),
  ...attemptMarkerDto(doc),
  notes: doc.notes.map((n) => ({
    text: n.text,
    by: n.by === null ? null : String(n.by),
    at: n.at.toISOString(),
  })),
  decision:
    doc.status === 'waiting' || doc.decidedAt === null
      ? null
      : {
          outcome: doc.status as ScreeningOutcome,
          reason: doc.decisionReason,
          decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
          decidedAt: doc.decidedAt.toISOString(),
        },
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
