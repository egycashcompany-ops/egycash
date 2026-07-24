// Employee list filters: free-text search (employee # / applicant code) + status. Emits a flat
// state; the list page maps it to/from the URL query string.
import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select } from '../../../../../shared/ui/form';

export interface EmployeeFiltersState {
  search: string;
  status: '' | EmployeeStatus;
}

export const EMPTY_EMPLOYEE_FILTERS: EmployeeFiltersState = { search: '', status: '' };

const isActive = (f: EmployeeFiltersState): boolean => f.search !== '' || f.status !== '';

export const EmployeeFilters = ({
  value,
  onChange,
}: {
  value: EmployeeFiltersState;
  onChange: (next: EmployeeFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<EmployeeFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_EMPLOYEE_FILTERS)} hasActiveFilters={isActive(value)}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('employees.filters.search')}
        />
      </div>
      <Select
        aria-label={t('employees.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as EmployeeFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('employees.filters.allStatuses')}</option>
        {EMPLOYEE_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`employees.status.${s}`)}</option>
        ))}
      </Select>
    </FilterBar>
  );
};
