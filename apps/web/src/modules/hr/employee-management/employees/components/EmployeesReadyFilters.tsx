// Employees Ready queue filters: free-text search (offer number / applicant code), the branch, the
// department and job of the accepted offer («هنزود الفلتر بتاع الاداره و الوظيفه»), and the
// accepted-date range. Emits a flat state; the page maps it to/from the URL query string.
//
// The department and job are the job offers screen's own two, chosen the same way: a department is
// the COMPANY's department and stands for every branch copy of it (`departmentIdsOf`).
//
// Status and `hired` are deliberately absent — they ARE the queue (accepted, not yet hired,
// A6/RW15). Offering them here would let a user filter their way out of the very queue they
// opened, and the table would stop agreeing with the stage counter that runs the same predicate.
//
// There is no "assigned user": nobody is assigned an accepted offer. The person who will hire is
// whoever opens the queue, which is a permission, not a field.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { Input } from '../../../../../shared/ui/form';
import { localized } from '../../../../../shared/lib/format';
import {
  useDepartmentReferenceOptions,
  useJobTitleReferenceOptions,
} from '../../../../organization/shared/references';
import { BranchFilterSelect } from '../../../recruitment/shared/BranchFilterSelect';
import {
  SEARCH_FITS_TEXT,
  departmentChoices,
} from '../../../recruitment/job-offers/components/OfferFilters';

export interface EmployeesReadyFiltersState {
  search: string;
  branchId: string[];
  /** Company departments, by group key (`groupKeyOf`). */
  department: string[];
  /** Job title ids. */
  job: string[];
  /** `respondedAt` — the date the candidate ACCEPTED, which is what this queue sorts by. */
  acceptedFrom: string;
  acceptedTo: string;
}

export const EMPTY_EMPLOYEES_READY_FILTERS: EmployeesReadyFiltersState = {
  search: '',
  branchId: [],
  department: [],
  job: [],
  acceptedFrom: '',
  acceptedTo: '',
};

const isActive = (f: EmployeesReadyFiltersState): boolean =>
  f.search !== '' ||
  f.branchId.length > 0 ||
  f.department.length > 0 ||
  f.job.length > 0 ||
  f.acceptedFrom !== '' ||
  f.acceptedTo !== '';

export const EmployeesReadyFilters = ({
  value,
  onChange,
}: {
  value: EmployeesReadyFiltersState;
  onChange: (next: EmployeesReadyFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: departments = [] } = useDepartmentReferenceOptions();
  const { data: jobs = [] } = useJobTitleReferenceOptions();
  const set = (patch: Partial<EmployeesReadyFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar
      onClear={() => onChange(EMPTY_EMPLOYEES_READY_FILTERS)}
      hasActiveFilters={isActive(value)}
    >
      <SearchInput
        value={value.search}
        onChange={(v) => set({ search: v })}
        placeholder={t('employeesReady.filters.search')}
        className={SEARCH_FITS_TEXT}
      />

      <BranchFilterSelect value={value.branchId} onChange={(branchId) => set({ branchId })} />
      <MultiSelect
        label={t('offers.filters.department')}
        value={value.department}
        onChange={(department) => set({ department })}
        options={departmentChoices(departments).map((d) => ({ value: d.key, label: localized(d.name, locale) }))}
      />
      <MultiSelect
        label={t('offers.filters.job')}
        value={value.job}
        onChange={(job) => set({ job })}
        options={[...jobs]
          .sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'))
          .map((j) => ({ value: j.id, label: localized(j.name, locale) }))}
      />

      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden whitespace-nowrap sm:inline">{t('employeesReady.filters.from')}</span>
        <Input
          type="date"
          value={value.acceptedFrom}
          onChange={(e) => set({ acceptedFrom: e.target.value })}
          aria-label={t('employeesReady.filters.from')}
          dir="ltr"
          className="w-auto"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden whitespace-nowrap sm:inline">{t('employeesReady.filters.to')}</span>
        <Input
          type="date"
          value={value.acceptedTo}
          onChange={(e) => set({ acceptedTo: e.target.value })}
          aria-label={t('employeesReady.filters.to')}
          dir="ltr"
          className="w-auto"
        />
      </label>
    </FilterBar>
  );
};
