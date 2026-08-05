// Hiring-documents list filters: free-text search (employee # / applicant code) + status. Emits a
// flat state; the list page maps it to/from the URL query string.
import { HIRING_DOCUMENTS_STATUSES, type HiringDocumentsStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';

export interface HiringDocsFiltersState {
  search: string;
  status: HiringDocumentsStatus[];
}

export const EMPTY_HIRING_DOCS_FILTERS: HiringDocsFiltersState = { search: '', status: [] };

const isActive = (f: HiringDocsFiltersState): boolean => f.search !== '' || f.status.length > 0;

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
      <MultiSelect
        label={t('hiringDocs.filters.status')}
        value={value.status}
        onChange={(status) => set({ status: status as HiringDocumentsStatus[] })}
        options={HIRING_DOCUMENTS_STATUSES.map((s) => ({ value: s, label: t(`hiringDocs.status.${s}`) }))}
      />
    </FilterBar>
  );
};
