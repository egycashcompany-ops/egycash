// Employee-file list filters: free-text search (employee # / applicant code) + status. Emits a flat
// state; the list page maps it to/from the URL query string.
import { EMPLOYEE_FILE_STATUSES, type EmployeeFileStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select } from '../../../../../shared/ui/form';

export interface EmployeeFileFiltersState {
  search: string;
  status: '' | EmployeeFileStatus;
}

export const EMPTY_EMPLOYEE_FILE_FILTERS: EmployeeFileFiltersState = { search: '', status: '' };

const isActive = (f: EmployeeFileFiltersState): boolean => f.search !== '' || f.status !== '';

export const EmployeeFileFilters = ({
  value,
  onChange,
}: {
  value: EmployeeFileFiltersState;
  onChange: (next: EmployeeFileFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<EmployeeFileFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_EMPLOYEE_FILE_FILTERS)} hasActiveFilters={isActive(value)}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('employeeFiles.filters.search')}
        />
      </div>
      <Select
        aria-label={t('employeeFiles.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as EmployeeFileFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('employeeFiles.filters.allStatuses')}</option>
        {EMPLOYEE_FILE_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`employeeFiles.status.${s}`)}</option>
        ))}
      </Select>
    </FilterBar>
  );
};
