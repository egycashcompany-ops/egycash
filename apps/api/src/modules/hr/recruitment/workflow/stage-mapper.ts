// Stage-record → DTO fragments shared by every stage mapper: the immutable placement snapshot
// (RW4) and the attempt/supersede markers (RW13/I12).
import { type AttemptMarkerDto, type PlacementDto, type PlacementLabelDto } from '@ecms/contracts';
import { type StageDocFields, type StagePlacement, type StagePlacementLabel } from './stage-fields';

export const placementDto = (p: StagePlacement | null | undefined): PlacementDto => ({
  jobPositionId: p?.jobPositionId == null ? null : String(p.jobPositionId),
  jobTitleId: p?.jobTitleId == null ? null : String(p.jobTitleId),
  departmentId: p?.departmentId == null ? null : String(p.departmentId),
  branchId: p?.branchId == null ? null : String(p.branchId),
  sectionId: p?.sectionId == null ? null : String(p.sectionId),
});

export const placementDtoOrNull = (p: StagePlacement | null | undefined): PlacementDto | null =>
  p == null ? null : placementDto(p);

export const placementLabelDto = (
  l: StagePlacementLabel | null | undefined,
): PlacementLabelDto => ({
  position: l?.position ?? null,
  branch: l?.branch ?? null,
  department: l?.department ?? null,
});

export const attemptMarkerDto = (doc: Partial<StageDocFields>): AttemptMarkerDto => ({
  attempt: doc.attempt ?? 1,
  supersededAt: doc.supersededAt == null ? null : doc.supersededAt.toISOString(),
  supersededBy: doc.supersededBy == null ? null : String(doc.supersededBy),
  supersededByReturnId: doc.supersededByReturnId ?? null,
});
