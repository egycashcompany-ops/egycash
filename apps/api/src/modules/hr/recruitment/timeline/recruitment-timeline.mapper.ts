// Timeline document → DTO. Dates become ISO strings and ids become strings; the entry's shape is
// otherwise carried through untouched, because a timeline entry IS the history record (I5).
import {
  type PlacementDto,
  type PlacementLabelDto,
  type RecruitmentTimelineEntryDto,
  type StageRefDto,
  type TimelineSummaryDto,
} from '@ecms/contracts';
import {
  type RecruitmentTimelineDoc,
  type TimelinePlacement,
  type TimelinePlacementLabel,
} from './recruitment-timeline.model';

const placementDto = (p: TimelinePlacement | null): PlacementDto | null =>
  p === null
    ? null
    : {
        jobPositionId: p.jobPositionId === null ? null : String(p.jobPositionId),
        jobTitleId: p.jobTitleId === null ? null : String(p.jobTitleId),
        departmentId: p.departmentId === null ? null : String(p.departmentId),
        branchId: p.branchId === null ? null : String(p.branchId),
        sectionId: p.sectionId === null ? null : String(p.sectionId),
      };

const labelDto = (l: TimelinePlacementLabel | null): PlacementLabelDto | null =>
  l === null ? null : { position: l.position, branch: l.branch, department: l.department };

/** `screening` · `interview:<id>` · `evaluation:<id>` — the stable key the client routes on. */
const stageDto = (doc: RecruitmentTimelineDoc): StageRefDto | null => {
  if (doc.stageKind === null) return null;
  const refId = doc.stageRefId === null ? null : String(doc.stageRefId);
  return {
    kind: doc.stageKind,
    refId,
    key: refId === null ? doc.stageKind : `${doc.stageKind}:${refId}`,
    name: doc.stageName,
  };
};

export const timelineEntryDto = (doc: RecruitmentTimelineDoc): RecruitmentTimelineEntryDto => ({
  eventId: doc.eventId,
  applicantId: String(doc.applicantId),
  applicantCode: doc.applicantCode,
  at: doc.at.toISOString(),
  actorUserId: doc.actorUserId === null ? null : String(doc.actorUserId),
  actorName: doc.actorName,
  type: doc.type,
  stage: stageDto(doc),
  fromStatus: doc.fromStatus,
  toStatus: doc.toStatus,
  placement: placementDto(doc.placement),
  placementLabel: labelDto(doc.placementLabel),
  entityRef:
    doc.entityType === null || doc.entityId === null
      ? null
      : { entityType: doc.entityType, entityId: String(doc.entityId) },
  reason: doc.reason,
  note: doc.note,
  correlationType: doc.correlationType,
  correlationId: doc.correlationId,
  supersededAt: doc.supersededAt === null ? null : doc.supersededAt.toISOString(),
  metadata: doc.metadata,
});

/**
 * The timeline slice every workflow response carries (I6): the entries this action just wrote,
 * plus the newest entries, so the client never issues a follow-up request to refresh history.
 */
export const timelineSummaryDto = (
  produced: RecruitmentTimelineDoc[],
  latest: RecruitmentTimelineDoc[],
  total: number,
): TimelineSummaryDto => ({
  produced: produced.map(timelineEntryDto),
  latest: latest.map(timelineEntryDto),
  total,
});
