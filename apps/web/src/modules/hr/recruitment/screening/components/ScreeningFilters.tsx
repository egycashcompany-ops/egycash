// Screening queue filters: status, an applicant (via search-picker → applicantId), and a
// created-date range. Emits a flat state; the queue page maps it to/from the URL query string.
import { SCREENING_STATUSES, type ScreeningStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { Select, Input } from '../../../../../shared/ui/form';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { ApplicantPicker } from './ApplicantPicker';

export interface ScreeningFiltersState {
  status: '' | ScreeningStatus;
  applicantId: string;
  applicantLabel: string;
  createdFrom: string;
  createdTo: string;
}

export const EMPTY_SCREENING_FILTERS: ScreeningFiltersState = {
  status: '',
  applicantId: '',
  applicantLabel: '',
  createdFrom: '',
  createdTo: '',
};

const isActive = (f: ScreeningFiltersState): boolean =>
  f.status !== '' || f.applicantId !== '' || f.createdFrom !== '' || f.createdTo !== '';

export const ScreeningFilters = ({
  value,
  onChange,
}: {
  value: ScreeningFiltersState;
  onChange: (next: ScreeningFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<ScreeningFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_SCREENING_FILTERS)} hasActiveFilters={isActive(value)}>
      <Select
        aria-label={t('screening.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as ScreeningFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('screening.filters.allStatuses')}</option>
        {SCREENING_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`screening.status.${s}`)}</option>
        ))}
      </Select>

      {value.applicantId === '' ? (
        <ApplicantPicker onSelect={(a) => set({ applicantId: a.id, applicantLabel: `${a.code} — ${a.fullNameAr}` })} />
      ) : (
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <span className="truncate">{value.applicantLabel === '' ? value.applicantId : value.applicantLabel}</span>
          <button
            type="button"
            onClick={() => set({ applicantId: '', applicantLabel: '' })}
            className="text-slate-400 hover:text-slate-600"
            aria-label={t('common.clear')}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </span>
      )}

      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden sm:inline">{t('screening.filters.from')}</span>
        <Input type="date" value={value.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} dir="ltr" className="w-auto" />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden sm:inline">{t('screening.filters.to')}</span>
        <Input type="date" value={value.createdTo} onChange={(e) => set({ createdTo: e.target.value })} dir="ltr" className="w-auto" />
      </label>
    </FilterBar>
  );
};
