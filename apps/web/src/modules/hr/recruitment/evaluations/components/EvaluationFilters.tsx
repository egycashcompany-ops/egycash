// Evaluation phase-queue filters: an applicant (search-picker → applicantId) and a created-date
// range. Emits a flat state; the phase page maps it to/from the URL query string.
//
// Status and phase are deliberately absent: the phase comes from the route and the status is the
// tab strip above the table. Offering either here would be a second control for state the page
// already owns, and the two would disagree the moment a user touched one (I7).
//
// Both filters are applied by the SERVER. Filtering the current page in the browser would answer a
// different question — "which of these 25 rows match" rather than "which rows match" — and the
// pager and the tab counts would stop agreeing with the table.
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { Input } from '../../../../../shared/ui/form';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { ApplicantPicker } from '../../screening/components/ApplicantPicker';

export interface EvaluationFiltersState {
  applicantId: string;
  applicantLabel: string;
  createdFrom: string;
  createdTo: string;
}

export const EMPTY_EVALUATION_FILTERS: EvaluationFiltersState = {
  applicantId: '',
  applicantLabel: '',
  createdFrom: '',
  createdTo: '',
};

const isActive = (f: EvaluationFiltersState): boolean =>
  f.applicantId !== '' || f.createdFrom !== '' || f.createdTo !== '';

export const EvaluationFilters = ({
  value,
  onChange,
}: {
  value: EvaluationFiltersState;
  onChange: (next: EvaluationFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const set = (patch: Partial<EvaluationFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_EVALUATION_FILTERS)} hasActiveFilters={isActive(value)}>
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
        <span className="hidden sm:inline">{t('evaluations.filters.from')}</span>
        <Input type="date" value={value.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} dir="ltr" className="w-auto" />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden sm:inline">{t('evaluations.filters.to')}</span>
        <Input type="date" value={value.createdTo} onChange={(e) => set({ createdTo: e.target.value })} dir="ltr" className="w-auto" />
      </label>
    </FilterBar>
  );
};
