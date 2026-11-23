// The registers' department-custody filters (2026-11-19) — «جهة الاستلام», «الإدارة», «الموقع» —
// and the names their chips, their files and their printed lines read.
//
// The departments are every active department, each named with its branch (two branches each have
// a «تقنية المعلومات»); the places are every branch's, the retired ones too (an old row's place
// still has a name), offered for the branch the register is narrowed to — or all of them, each
// named «place — branch», when it is not.
import { useMemo } from 'react';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { localized } from '../../../shared/lib/format';
import { type SearchableOption } from '../../../shared/ui/SearchableSelect';
import {
  useItBranchOptions,
  useItDepartmentOptions,
  useItLocationOptions,
} from '../api/it-queries';
import { departmentChoices } from '../lib/custodian-defaults';

export interface CustodianFilterOptions {
  departments: SearchableOption[];
  /** Department id → «تقنية المعلومات — أسيوط». */
  departmentName: ReadonlyMap<string, string>;
  places: SearchableOption[];
  /** Place id → its name, with its branch when the register is not narrowed to one. */
  locationName: ReadonlyMap<string, string>;
}

export const useCustodianFilterOptions = (
  branchId: string,
  enabled = true,
): CustodianFilterOptions => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const departments = useItDepartmentOptions(enabled);
  const places = useItLocationOptions(enabled);
  return useMemo(() => {
    const branchName = new Map<string, string>();
    for (const branch of branches.data ?? [])
      branchName.set(branch.id, localized(branch.name, locale));
    const choices = departmentChoices(departments.data ?? [], branchName, branchId, locale);
    const locationName = new Map<string, string>();
    const offered: SearchableOption[] = [];
    for (const place of places.data ?? []) {
      const name = localized(place.name, locale);
      const branch = branchName.get(place.branchId);
      const label = branchId === '' && branch !== undefined ? `${name} — ${branch}` : name;
      locationName.set(place.id, label);
      if (branchId === '' || place.branchId === branchId) {
        offered.push({ value: place.id, label });
      }
    }
    return {
      departments: choices.map((choice) => ({ value: choice.id, label: choice.label })),
      departmentName: new Map(choices.map((choice) => [choice.id, choice.label] as const)),
      places: offered,
      locationName,
    };
  }, [branches.data, departments.data, places.data, branchId, locale]);
};
