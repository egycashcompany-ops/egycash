// Interview queue filters: status, outcome, stage (from the admin catalog), an applicant
// (search-picker → applicantId), and a scheduled-date range. Emits a flat state; the queue page
// maps it to/from the URL query string.
import {
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  type InterviewOutcome,
  type InterviewStatus,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { Select, Input } from '../../../../../shared/ui/form';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { localized } from '../../../../../shared/lib/format';
import { ApplicantPicker } from './ApplicantPicker';
import { useInterviewStages } from '../api/interview-queries';

export interface InterviewFiltersState {
  status: '' | InterviewStatus;
  outcome: '' | InterviewOutcome;
  stageId: string;
  applicantId: string;
  applicantLabel: string;
  scheduledFrom: string;
  scheduledTo: string;
}

export const EMPTY_INTERVIEW_FILTERS: InterviewFiltersState = {
  status: '',
  outcome: '',
  stageId: '',
  applicantId: '',
  applicantLabel: '',
  scheduledFrom: '',
  scheduledTo: '',
};

const isActive = (f: InterviewFiltersState): boolean =>
  f.status !== '' ||
  f.outcome !== '' ||
  f.stageId !== '' ||
  f.applicantId !== '' ||
  f.scheduledFrom !== '' ||
  f.scheduledTo !== '';

export const InterviewFilters = ({
  value,
  onChange,
}: {
  value: InterviewFiltersState;
  onChange: (next: InterviewFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: stages = [] } = useInterviewStages();
  const set = (patch: Partial<InterviewFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_INTERVIEW_FILTERS)} hasActiveFilters={isActive(value)}>
      <Select
        aria-label={t('interviews.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as InterviewFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('interviews.filters.allStatuses')}</option>
        {INTERVIEW_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`interviews.status.${s}`)}</option>
        ))}
      </Select>

      <Select
        aria-label={t('interviews.filters.outcome')}
        value={value.outcome}
        onChange={(e) => set({ outcome: e.target.value as InterviewFiltersState['outcome'] })}
        className="w-auto"
      >
        <option value="">{t('interviews.filters.allOutcomes')}</option>
        {INTERVIEW_OUTCOMES.map((o) => (
          <option key={o} value={o}>{t(`interviews.outcome.${o}`)}</option>
        ))}
      </Select>

      <Select
        aria-label={t('interviews.filters.stage')}
        value={value.stageId}
        onChange={(e) => set({ stageId: e.target.value })}
        className="w-auto"
      >
        <option value="">{t('interviews.filters.allStages')}</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{localized(s.name, locale)}</option>
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
        <span className="hidden sm:inline">{t('interviews.filters.from')}</span>
        <Input type="date" value={value.scheduledFrom} onChange={(e) => set({ scheduledFrom: e.target.value })} dir="ltr" className="w-auto" />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className="hidden sm:inline">{t('interviews.filters.to')}</span>
        <Input type="date" value={value.scheduledTo} onChange={(e) => set({ scheduledTo: e.target.value })} dir="ltr" className="w-auto" />
      </label>
    </FilterBar>
  );
};
