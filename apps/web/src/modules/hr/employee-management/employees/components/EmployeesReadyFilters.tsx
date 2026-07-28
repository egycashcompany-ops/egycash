// Employees Ready queue filters: free-text search (offer number / applicant code), the branch, and
// the accepted-date range. Emits a flat state; the page maps it to/from the URL query string.
//
// Status and `hired` are deliberately absent — they ARE the queue (accepted, not yet hired,
// A6/RW15). Offering them here would let a user filter their way out of the very queue they
// opened, and the table would stop agreeing with the stage counter that runs the same predicate.
//
// There is no "assigned user": nobody is assigned an accepted offer. The person who will hire is
// whoever opens the queue, which is a permission, not a field.
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Input } from '../../../../../shared/ui/form';
import { BranchFilterSelect } from '../../../recruitment/shared/BranchFilterSelect';

export interface EmployeesReadyFiltersState {
  search: string;
  branchId: string;
  /** `respondedAt` — the date the candidate ACCEPTED, which is what this queue sorts by. */
  acceptedFrom: string;
  acceptedTo: string;
}

export const EMPTY_EMPLOYEES_READY_FILTERS: EmployeesReadyFiltersState = {
  search: '',
  branchId: '',
  acceptedFrom: '',
  acceptedTo: '',
};

const isActive = (f: EmployeesReadyFiltersState): boolean =>
  f.search !== '' || f.branchId !== '' || f.acceptedFrom !== '' || f.acceptedTo !== '';

export const EmployeesReadyFilters = ({
  value,
  onChange,
}: {
  value: EmployeesReadyFiltersState;
  onChange: (next: EmployeesReadyFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<EmployeesReadyFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar
      onClear={() => onChange(EMPTY_EMPLOYEES_READY_FILTERS)}
      hasActiveFilters={isActive(value)}
    >
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('employeesReady.filters.search')}
        />
      </div>

      <BranchFilterSelect value={value.branchId} onChange={(branchId) => set({ branchId })} />

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
