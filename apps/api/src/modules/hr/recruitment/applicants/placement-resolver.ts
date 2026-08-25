// Placement resolution (RW1/RW4). A placement is a set of ids into the platform's organization
// catalog; every surface that shows one needs the NAMES, and history has to keep rendering even
// after a job title is renamed or deactivated. So the ids are validated once here and the display
// labels are denormalized onto whatever the caller is about to write.
//
// Each id stands on its own: the placement carries its department, section and branch directly.
// A job position used to complete the rest from the seat it named; P-ORG-1 removed the seat, and
// what it filled in was what the placement already held.
import { Types } from 'mongoose';
import { type PlacementDto } from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
import {
  branchService,
  departmentService,
  jobTitleService,
} from '../../../../platform/organization';
import {
  emptyPlacement,
  emptyPlacementLabel,
  type StagePlacement,
  type StagePlacementLabel,
} from '../workflow/stage-fields';

/** The dimensions a reassignment can move — each produces its own timeline entry (A2). */
export const PLACEMENT_DIMENSIONS = ['position', 'title', 'department', 'branch', 'section'] as const;
export type PlacementDimension = (typeof PLACEMENT_DIMENSIONS)[number];

const id = (value: string | null | undefined): Types.ObjectId | null =>
  value === null || value === undefined || value === '' ? null : new Types.ObjectId(value);

const same = (a: Types.ObjectId | null, b: Types.ObjectId | null): boolean =>
  a === null && b === null ? true : a === null || b === null ? false : a.equals(b);

/** Which dimensions actually moved between two placements. */
export const changedDimensions = (
  from: StagePlacement,
  to: StagePlacement,
): PlacementDimension[] => {
  const out: PlacementDimension[] = [];
  if (!same(from.jobTitleId, to.jobTitleId)) out.push('title');
  if (!same(from.departmentId, to.departmentId)) out.push('department');
  if (!same(from.branchId, to.branchId)) out.push('branch');
  if (!same(from.sectionId, to.sectionId)) out.push('section');
  return out;
};

export interface ResolvedPlacement {
  placement: StagePlacement;
  label: StagePlacementLabel;
}

const invalid = (field: string, message: string): never => {
  throw new ValidationError([{ field, code: 'INVALID', message }]);
};

/**
 * Validate a placement and resolve its display labels. Every id supplied must exist, and each is
 * taken as sent — nothing overrides another. (A job position used to override the department and
 * branch, on the reasoning that the seat was the authority on where it sits; P-ORG-1 removed it.)
 *
 * An entirely empty placement is legal: intake without a requisition must keep working (ADR-016).
 */
export type PlacementInput = {
  [K in keyof PlacementDto]?: PlacementDto[K] | undefined;
};

export const resolvePlacement = async (
  input: PlacementInput | undefined | null,
): Promise<ResolvedPlacement> => {
  if (input === undefined || input === null) {
    return { placement: emptyPlacement(), label: emptyPlacementLabel() };
  }

  const placement: StagePlacement = {
    jobTitleId: id(input.jobTitleId),
    departmentId: id(input.departmentId),
    branchId: id(input.branchId),
    sectionId: id(input.sectionId),
  };
  const label = emptyPlacementLabel();

  if (placement.jobTitleId !== null) {
    const title = await jobTitleService.getById(String(placement.jobTitleId)).catch(() => null);
    if (title === null) invalid('placement.jobTitleId', 'unknown job title');
    // P-ORG-1 — one job concept, so the title IS the label. There is no seat to outrank it,
    // and the department and section the placement carries are now its own rather than copied.
    else label.position = title.name.ar;
  }

  if (placement.departmentId !== null) {
    const department = await departmentService.getById(String(placement.departmentId)).catch(() => null);
    if (department === null) invalid('placement.departmentId', 'unknown department');
    else {
      label.department = department.name.ar;
      // A department belongs to exactly one branch, so it settles the branch too.
      placement.branchId = department.branchId;
    }
  }

  if (placement.branchId !== null) {
    const branch = await branchService.getById(String(placement.branchId)).catch(() => null);
    if (branch === null) invalid('placement.branchId', 'unknown branch');
    else label.branch = branch.name.ar;
  }

  return { placement, label };
};
