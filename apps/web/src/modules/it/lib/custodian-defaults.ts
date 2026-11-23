// The department a hand-over to a department starts from — «في عهدة إدارة …», with the IT department
// chosen already (the owner's answer 1, 2026-11-19: «IT department preselected»).
//
// IT is whatever the help desk was told it is: the departments ticked in «الفنيون»
// (`it.technicianDepartmentIds`). A department is one row PER BRANCH, so «IT» is several rows; the
// one chosen is the row of the branch the devices are in (the place's branch), and failing that the
// first one configured that is still an active department. Nothing configured, or nothing active:
// nothing is chosen, and the field asks.
//
// Any active department of any branch may still be picked (default §8.1): head-office IT may hold a
// branch's server. So the list offered is every department, the place's branch's first — each named
// with its branch, since two branches each have a «تقنية المعلومات».
import { ItSettingKeys, type Locale, type OrgUnitOptionDto } from '@ecms/contracts';
import { localized } from '../../../shared/lib/format';

/** The setting's value, defended against a shape the server should never send but might. */
export const configuredDepartmentIds = (
  settings: readonly { key: string; value: unknown }[] | undefined,
): string[] => {
  const value = settings?.find((row) => row.key === ItSettingKeys.TechnicianDepartmentIds)?.value;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * The department to preselect: the first configured IT department in `branchId`, else the first
 * configured one that is an active department at all, else '' (none).
 */
export const defaultCustodianDepartment = (
  configuredIds: readonly string[],
  options: readonly Pick<OrgUnitOptionDto, 'id' | 'parentId'>[],
  branchId: string,
): string => {
  const active = new Map(options.map((option) => [option.id, option]));
  const inBranch = configuredIds.find(
    (id) => branchId !== '' && active.get(id)?.parentId === branchId,
  );
  if (inBranch !== undefined) return inBranch;
  return configuredIds.find((id) => active.has(id)) ?? '';
};

/**
 * What the field should be set to now, or null to leave it: the IT department is chosen already
 * and follows the branch — but never over a choice. A department picked by hand is one; so is one
 * filled from elsewhere (a device a department holds, picked on a memo's line), which is any value
 * that is neither empty nor the one this rule set last (`lastAuto`).
 */
export const preselectDepartment = ({
  picked,
  preselect,
  current,
  lastAuto,
}: {
  /** The field was picked by hand. */
  picked: boolean;
  /** `defaultCustodianDepartment` for the branch now. */
  preselect: string;
  /** What the field holds. */
  current: string;
  /** What this rule set last, '' before it set anything. */
  lastAuto: string;
}): string | null => {
  if (picked || preselect === '' || preselect === current) return null;
  if (current !== '' && current !== lastAuto) return null;
  return preselect;
};

/**
 * What the fields' own two rules make of the value now, as ONE next value — or null to leave it:
 *
 *   · the IT department follows the branch (`preselectDepartment`);
 *   · a place the branch does not offer is no choice, and is let go — but only a KNOWN branch's:
 *     while the branch is '' (a memo with no item chosen yet) nothing is offered, and a place just
 *     filled from a device a department holds stays until the branch is known.
 *
 * One value, so one `onChange`: two calls made from one render each spread that render's value, and
 * the second put back what the first changed — the branch changed with a place chosen, the place
 * was let go with the OLD department, and the IT row of the new branch never came back (this rule
 * had already noted it as set). `auto` is the department this rule sets, null when it sets none.
 */
export const custodianFollowUp = <V extends { departmentId: string; locationId: string }>({
  value,
  picked,
  preselect,
  lastAuto,
  branchId,
  offeredPlaceIds,
}: {
  value: V;
  /** The department was picked by hand. */
  picked: boolean;
  /** `defaultCustodianDepartment` for the branch now. */
  preselect: string;
  /** What the preselection set last, '' before it set anything. */
  lastAuto: string;
  /** The place's branch, '' while it is not known. */
  branchId: string;
  /** The places `branchId` offers; undefined while they are on their way. */
  offeredPlaceIds: readonly string[] | undefined;
}): { next: V; auto: string | null } | null => {
  const auto = preselectDepartment({ picked, preselect, current: value.departmentId, lastAuto });
  const strayPlace =
    value.locationId !== '' &&
    branchId !== '' &&
    offeredPlaceIds !== undefined &&
    !offeredPlaceIds.includes(value.locationId);
  if (auto === null && !strayPlace) return null;
  return {
    next: {
      ...value,
      ...(auto === null ? {} : { departmentId: auto }),
      ...(strayPlace ? { locationId: '' } : {}),
    },
    auto,
  };
};

export interface DepartmentChoice {
  id: string;
  /** «تقنية المعلومات — أسيوط»: the name, and the branch it is a row of. */
  label: string;
  /** The row is of the place's branch — listed first. */
  inBranch: boolean;
}

/**
 * Every active department as a choice, the place's branch's first and each group by name. A
 * department whose branch cannot be named is shown by its name alone.
 */
export const departmentChoices = (
  options: readonly OrgUnitOptionDto[],
  branchName: ReadonlyMap<string, string>,
  branchId: string,
  locale: Locale,
): DepartmentChoice[] =>
  options
    .map((option) => {
      const name = localized(option.name, locale);
      const branch = option.parentId === null ? undefined : branchName.get(option.parentId);
      return {
        id: option.id,
        label: branch === undefined ? name : `${name} — ${branch}`,
        inBranch: branchId !== '' && option.parentId === branchId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.inBranch) - Number(a.inBranch) ||
        a.label.localeCompare(b.label, locale === 'ar' ? 'ar' : 'en'),
    );
