// The requirement flags as data, plus the one decision the roster screen makes.
//
// The order below is the order the legacy screen showed its checkboxes (requirement.ejs:393-417),
// kept because operators read the row left-to-right and know it by shape.
import {
  type OperationsCrewRequirementsDto,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';

export const REQUIREMENT_FLAGS = [
  'isCaptain',
  'isSpecialist',
  'hasWeapon',
  'hasSignature',
  'hasLicense',
  'hasTemporaryLicense',
  'isOpsAdmin',
  'isNewJoiner',
  'isAssignedSpecialTask',
  'isPriority',
] as const;
export type RequirementFlag = (typeof REQUIREMENT_FLAGS)[number];

/**
 * The endpoint upserts the WHOLE row — the legacy screen saved a checkbox line, not a single box —
 * so toggling one flag means sending all of them with that one changed.
 *
 * A member who has no row yet starts from all-false, which is what an unticked line means. Notes
 * are carried through untouched: this screen does not edit them, and dropping them on a toggle
 * would silently discard someone else's text.
 */
export const toFlagPayload = (
  current: OperationsCrewRequirementsDto | null,
  flag: RequirementFlag,
  value: boolean,
): SetOperationsCrewRequirements => ({
  isCaptain: flag === 'isCaptain' ? value : (current?.isCaptain ?? false),
  isSpecialist: flag === 'isSpecialist' ? value : (current?.isSpecialist ?? false),
  hasWeapon: flag === 'hasWeapon' ? value : (current?.hasWeapon ?? false),
  hasSignature: flag === 'hasSignature' ? value : (current?.hasSignature ?? false),
  hasLicense: flag === 'hasLicense' ? value : (current?.hasLicense ?? false),
  hasTemporaryLicense:
    flag === 'hasTemporaryLicense' ? value : (current?.hasTemporaryLicense ?? false),
  isOpsAdmin: flag === 'isOpsAdmin' ? value : (current?.isOpsAdmin ?? false),
  isNewJoiner: flag === 'isNewJoiner' ? value : (current?.isNewJoiner ?? false),
  isAssignedSpecialTask:
    flag === 'isAssignedSpecialTask' ? value : (current?.isAssignedSpecialTask ?? false),
  isPriority: flag === 'isPriority' ? value : (current?.isPriority ?? false),
  // Carried through untouched — this screen does not edit notes, and dropping them on a toggle
  // would silently discard someone else's text.
  notes: current?.notes ?? null,
});
