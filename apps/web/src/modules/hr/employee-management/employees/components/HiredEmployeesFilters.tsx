// «المعينون»'s filters: free text (code or name), and the branch, department and job the person
// works in — each a list of ticks, as the offers' are. A department is chosen as the COMPANY's
// department («الأمن» once, not once per branch) and stands for every branch copy of it.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { localized } from '../../../../../shared/lib/format';
import { useDepartmentReferenceOptions, useJobTitleReferenceOptions } from '../../../../organization/shared/references';
import { BranchFilterSelect } from '../../../recruitment/shared/BranchFilterSelect';
import { departmentChoices } from '../../../recruitment/job-offers/components/OfferFilters';

export interface HiredFiltersState {
  search: string;
  /** Branch ids. */
  branch: string[];
  /** Company departments, by group key (`groupKeyOf`). */
  department: string[];
  /** Job title ids. */
  job: string[];
}

export const EMPTY_HIRED_FILTERS: HiredFiltersState = { search: '', branch: [], department: [], job: [] };

const isActive = (f: HiredFiltersState): boolean =>
  f.search !== '' || f.branch.length > 0 || f.department.length > 0 || f.job.length > 0;

export const HiredEmployeesFilters = ({
  value,
  onChange,
}: {
  value: HiredFiltersState;
  onChange: (next: HiredFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: departments = [] } = useDepartmentReferenceOptions();
  const { data: jobs = [] } = useJobTitleReferenceOptions();
  const set = (patch: Partial<HiredFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_HIRED_FILTERS)} hasActiveFilters={isActive(value)}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('employees.hired.search')}
        />
      </div>
      <BranchFilterSelect value={value.branch} onChange={(branch) => set({ branch })} />
      <MultiSelect
        label={t('employees.columns.department')}
        value={value.department}
        onChange={(department) => set({ department })}
        options={departmentChoices(departments).map((d) => ({ value: d.key, label: localized(d.name, locale) }))}
      />
      <MultiSelect
        label={t('employees.columns.jobTitle')}
        value={value.job}
        onChange={(job) => set({ job })}
        options={[...jobs]
          .sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'))
          .map((j) => ({ value: j.id, label: localized(j.name, locale) }))}
      />
    </FilterBar>
  );
};
