// Job Offer list filters: free-text search (offer number / applicant code), status, and an
// "active only" toggle. Emits a flat state; the list page maps it to/from the URL query string.
import { OFFER_STATUSES, type OfferStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select, Checkbox } from '../../../../../shared/ui/form';

export interface OfferFiltersState {
  search: string;
  status: '' | OfferStatus;
  active: boolean;
}

export const EMPTY_OFFER_FILTERS: OfferFiltersState = { search: '', status: '', active: false };

const isActive = (f: OfferFiltersState): boolean => f.search !== '' || f.status !== '' || f.active;

export const OfferFilters = ({
  value,
  onChange,
}: {
  value: OfferFiltersState;
  onChange: (next: OfferFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<OfferFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_OFFER_FILTERS)} hasActiveFilters={isActive(value)}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('offers.filters.search')}
        />
      </div>
      <Select
        aria-label={t('offers.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as OfferFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('offers.filters.allStatuses')}</option>
        {OFFER_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`offers.status.${s}`)}</option>
        ))}
      </Select>
      <Checkbox
        label={t('offers.filters.activeOnly')}
        checked={value.active}
        onChange={(e) => set({ active: e.target.checked })}
      />
    </FilterBar>
  );
};
