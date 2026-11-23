// Employee-file list filters: free-text search (employee # / applicant code) + status. Emits a flat
// state; the list page maps it to/from the URL query string.
//
// «هنخلي كل الفلترز multi»: the status takes several, and every control is as wide as its own words
// («العرض بتاع الفلتر … يكون مظبوط ع كلام بظبط»).
import { EMPLOYEE_FILE_STATUSES, type EmployeeFileStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { SEARCH_FITS_TEXT } from '../../../recruitment/job-offers/components/OfferFilters';

export interface EmployeeFileFiltersState {
  search: string;
  status: EmployeeFileStatus[];
}

export const EMPTY_EMPLOYEE_FILE_FILTERS: EmployeeFileFiltersState = { search: '', status: [] };

const isActive = (f: EmployeeFileFiltersState): boolean => f.search !== '' || f.status.length > 0;

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
      <SearchInput
        value={value.search}
        onChange={(v) => set({ search: v })}
        placeholder={t('employeeFiles.filters.search')}
        className={SEARCH_FITS_TEXT}
      />
      <MultiSelect
        label={t('employeeFiles.filters.status')}
        value={value.status}
        onChange={(status) => set({ status: status as EmployeeFileStatus[] })}
        options={EMPLOYEE_FILE_STATUSES.map((s) => ({ value: s, label: t(`employeeFiles.status.${s}`) }))}
      />
    </FilterBar>
  );
};
