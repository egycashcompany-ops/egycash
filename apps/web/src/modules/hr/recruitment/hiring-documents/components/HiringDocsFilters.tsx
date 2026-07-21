// Hiring-documents list filters: free-text search (employee # / applicant code) + status. Emits a
// flat state; the list page maps it to/from the URL query string.
import { HIRING_DOCUMENTS_STATUSES, type HiringDocumentsStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select } from '../../../../../shared/ui/form';

export interface HiringDocsFiltersState {
  search: string;
  status: '' | HiringDocumentsStatus;
}

export const EMPTY_HIRING_DOCS_FILTERS: HiringDocsFiltersState = { search: '', status: '' };

const isActive = (f: HiringDocsFiltersState): boolean => f.search !== '' || f.status !== '';

export const HiringDocsFilters = ({
  value,
  onChange,
}: {
  value: HiringDocsFiltersState;
  onChange: (next: HiringDocsFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<HiringDocsFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_HIRING_DOCS_FILTERS)} hasActiveFilters={isActive(value)}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('hiringDocs.filters.search')}
        />
      </div>
      <Select
        aria-label={t('hiringDocs.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as HiringDocsFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('hiringDocs.filters.allStatuses')}</option>
        {HIRING_DOCUMENTS_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`hiringDocs.status.${s}`)}</option>
        ))}
      </Select>
    </FilterBar>
  );
};
