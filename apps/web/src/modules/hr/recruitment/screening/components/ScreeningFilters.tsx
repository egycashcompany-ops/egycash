// Screening queue filters: status, an applicant (via search-picker → applicantId), a created-date
// range, and the candidate-attribute filters — age band and education level. Emits a flat state;
// the queue page maps it to/from the URL query string.
//
// Age and education are filtered on the SERVER even though they live on the applicant rather than
// the screening. Doing it here would only ever filter the current page, which is a different (and
// wrong) answer as soon as there is more than one.
import { EDUCATION_LEVELS, SCREENING_STATUSES, type EducationLevel, type ScreeningStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { Input } from '../../../../../shared/ui/form';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { ApplicantPicker } from './ApplicantPicker';

export interface ScreeningFiltersState {
  status: ScreeningStatus[];
  applicantId: string;
  applicantLabel: string;
  createdFrom: string;
  createdTo: string;
  /** Whole years, as typed. Kept as strings so a half-entered bound stays in the box. */
  ageFrom: string;
  ageTo: string;
  educationLevel: EducationLevel[];
}

export const EMPTY_SCREENING_FILTERS: ScreeningFiltersState = {
  status: [],
  applicantId: '',
  applicantLabel: '',
  createdFrom: '',
  createdTo: '',
  ageFrom: '',
  ageTo: '',
  educationLevel: [],
};

const isActive = (f: ScreeningFiltersState): boolean =>
  f.status.length > 0 ||
  f.applicantId !== '' ||
  f.createdFrom !== '' ||
  f.createdTo !== '' ||
  f.ageFrom !== '' ||
  f.ageTo !== '' ||
  f.educationLevel.length > 0;

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
      <MultiSelect
        label={t('screening.filters.status')}
        value={value.status}
        onChange={(status) => set({ status: status as ScreeningStatus[] })}
        options={SCREENING_STATUSES.map((s) => ({ value: s, label: t(`screening.status.${s}`) }))}
      />

      {value.applicantId === '' ? (
        <ApplicantPicker onSelect={(a) => set({ applicantId: a.id, applicantLabel: a.fullNameAr })} />
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

      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden whitespace-nowrap sm:inline">{t('screening.filters.ageFrom')}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          value={value.ageFrom}
          onChange={(e) => set({ ageFrom: e.target.value })}
          aria-label={t('screening.filters.ageFrom')}
          dir="ltr"
          className="w-20"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden whitespace-nowrap sm:inline">{t('screening.filters.ageTo')}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          value={value.ageTo}
          onChange={(e) => set({ ageTo: e.target.value })}
          aria-label={t('screening.filters.ageTo')}
          dir="ltr"
          className="w-20"
        />
      </label>

      <MultiSelect
        label={t('screening.filters.education')}
        value={value.educationLevel}
        onChange={(educationLevel) => set({ educationLevel: educationLevel as EducationLevel[] })}
        options={EDUCATION_LEVELS.map((level) => ({
          value: level,
          label: t(`applicants.education.${level}`),
        }))}
      />
    </FilterBar>
  );
};
