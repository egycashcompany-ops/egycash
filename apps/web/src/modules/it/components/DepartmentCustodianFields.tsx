// «في عهدة إدارة … — الموقع …» (2026-11-19): the three fields a hand-over to a DEPARTMENT asks for —
// shared by the asset hand-over, the asset transfer and the consumables issue.
//
//   · «الإدارة» — any active department of any branch (head-office IT may hold a branch's server),
//     each named with its branch, the place's branch first, and the IT department chosen already:
//     the IT row of the place's branch, else the first configured one (`lib/custodian-defaults.ts`).
//     The choice follows the branch until somebody picks a department by hand.
//   · «الموقع» — one of the place's branch's places («المواقع», on the catalogs page). It waits,
//     with a hint, until the branch is known — the devices' branch, or the store's — and a place
//     already filled (from a device a department holds) waits with it: only a known branch that
//     does not offer it lets it go.
//   · «المسؤول المستلم» — who signs for the department: any current employee, from the recipients
//     box (FR-15), not necessarily of the department.
//
// The server judges the rest — an inactive department, a retired place, a place in another branch,
// a responsible person who has left — and the dialog says what it answered.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useMySettings } from '../../../platform/settings/settings-api';
import { Field, Select } from '../../../shared/ui/form';
import { SearchableSelect } from '../../../shared/ui/SearchableSelect';
import { localized } from '../../../shared/lib/format';
import {
  useItBranchOptions,
  useItDepartmentOptions,
  useItLocationOptions,
} from '../api/it-queries';
import {
  configuredDepartmentIds,
  custodianFollowUp,
  defaultCustodianDepartment,
  departmentChoices,
} from '../lib/custodian-defaults';
import { EmployeePicker } from './EmployeePicker';

export interface DepartmentCustodianValue {
  departmentId: string;
  locationId: string;
  responsibleEmployeeId: string;
  /** The responsible person's chip label, kept so it survives a refetch. */
  responsibleLabel: string;
}

export const EMPTY_DEPARTMENT_CUSTODIAN: DepartmentCustodianValue = {
  departmentId: '',
  locationId: '',
  responsibleEmployeeId: '',
  responsibleLabel: '',
};

/** All three chosen — what the request's `department` needs. */
export const departmentCustodianReady = (value: DepartmentCustodianValue): boolean =>
  value.departmentId !== '' && value.locationId !== '' && value.responsibleEmployeeId !== '';

/**
 * The department chosen already — the IT department of `branchId`, else the first configured one —
 * '' while the settings or the departments are on their way.
 */
export const useDefaultCustodianDepartment = (branchId: string): string => {
  const settings = useMySettings();
  const departments = useItDepartmentOptions();
  return defaultCustodianDepartment(
    configuredDepartmentIds(settings.data),
    departments.data ?? [],
    branchId,
  );
};

export const DepartmentCustodianFields = ({
  value,
  onChange,
  branchId,
  branchMissingHint,
  filledFromDevice = false,
}: {
  value: DepartmentCustodianValue;
  onChange: (next: DepartmentCustodianValue) => void;
  /**
   * The department now chosen was filled from a device its custodian holds (a memo's line): the
   * IT preselection leaves it, as it leaves one picked by hand — even when the two are the same row.
   */
  filledFromDevice?: boolean;
  /** The place's branch — the devices' (or the store's) — '' while it is not known yet. */
  branchId: string;
  /** What «الموقع» says while the branch is not known — the dialog says what decides it. */
  branchMissingHint: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const departments = useItDepartmentOptions();
  const places = useItLocationOptions();
  const preselect = useDefaultCustodianDepartment(branchId);
  // Picked by hand: the IT preselection no longer follows the branch.
  const [picked, setPicked] = useState(false);

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  const choices = departmentChoices(departments.data ?? [], branchName, branchId, locale);
  // The branch's active places. While the branch is not known the box waits — still showing a
  // place filled from a device a department holds, which stays until the branch is known.
  const offered = (places.data ?? []).filter((place) =>
    branchId === '' ? place.id === value.locationId : place.isActive && place.branchId === branchId,
  );

  // The fields' own rules, as ONE next value sent in one call (`custodianFollowUp`): the IT
  // department chosen already and following the branch — never over a department picked by hand,
  // nor over one filled from a device the department holds — and a place the KNOWN branch does not
  // offer (the branch changed) let go. Two calls from one render would undo each other.
  const lastAuto = useRef('');
  useEffect(() => {
    const follow = custodianFollowUp({
      value,
      picked: picked || filledFromDevice,
      preselect,
      lastAuto: lastAuto.current,
      branchId,
      offeredPlaceIds: places.data === undefined ? undefined : offered.map((place) => place.id),
    });
    if (follow === null) return;
    if (follow.auto !== null) lastAuto.current = follow.auto;
    onChange(follow.next);
  }, [value, picked, filledFromDevice, preselect, branchId, places.data, offered, onChange]);

  return (
    <div data-department-custodian className="grid gap-4 sm:grid-cols-2">
      <Field label={t('it.custody.department.department')} required>
        <SearchableSelect
          value={value.departmentId}
          options={choices.map((choice) => ({ value: choice.id, label: choice.label }))}
          loading={departments.isLoading}
          ariaLabel={t('it.custody.department.department')}
          testId="custodian-department"
          onChange={(departmentId) => {
            setPicked(true);
            onChange({ ...value, departmentId });
          }}
        />
      </Field>
      <Field
        label={t('it.custody.department.location')}
        required
        hint={
          branchId === ''
            ? branchMissingHint
            : places.data !== undefined && offered.length === 0
              ? t('it.custody.department.noLocations')
              : undefined
        }
      >
        <Select
          value={value.locationId}
          data-custodian-location
          aria-label={t('it.custody.department.location')}
          disabled={branchId === '' || offered.length === 0}
          onChange={(e) => onChange({ ...value, locationId: e.target.value })}
        >
          <option value="">
            {places.isLoading && branchId !== '' ? t('common.loading') : t('common.select')}
          </option>
          {offered.map((place) => (
            <option key={place.id} value={place.id}>
              {localized(place.name, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('it.custody.department.responsibleReceiver')}
        required
        hint={t('it.custody.department.responsibleHint')}
        className="sm:col-span-2"
      >
        <EmployeePicker
          value={value.responsibleEmployeeId}
          valueLabel={value.responsibleLabel}
          onChange={(id, label) =>
            onChange({ ...value, responsibleEmployeeId: id, responsibleLabel: label })
          }
          ariaLabel={t('it.custody.department.responsibleReceiver')}
          handOver
        />
      </Field>
    </div>
  );
};

/** «جهة الاستلام: موظف / إدارة» — the segmented switch above the holder. */
export const CustodianKindSwitch = ({
  value,
  onChange,
}: {
  value: 'employee' | 'department';
  onChange: (next: 'employee' | 'department') => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {t('it.custody.department.receiverKind')}
      </span>
      <div
        role="radiogroup"
        aria-label={t('it.custody.department.receiverKind')}
        className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
      >
        {(['employee', 'department'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value === kind}
            data-custodian-kind={kind}
            onClick={() => onChange(kind)}
            className={`px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
              value === kind
                ? 'bg-brand-600 text-white dark:bg-brand-500'
                : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {t(`it.custody.department.kind.${kind}`)}
          </button>
        ))}
      </div>
    </div>
  );
};
