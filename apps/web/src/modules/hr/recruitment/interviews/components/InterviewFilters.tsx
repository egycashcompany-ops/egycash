// Interview queue filters: free-text search, status, outcome, stage (from the admin catalog), an
// applicant (search-picker → applicantId), the interviewer, the branch, and a scheduled-date range.
// Emits a flat state; the queue page maps it to/from the URL query string.
//
// `omit` exists so a PER-STAGE page can reuse this bar rather than growing its own: on
// `/interviews/stage/:stageId` the stage is fixed by the route and the status is the tab strip, so
// offering either again would be two controls for one piece of state — the second one silently
// losing. Everything else is identical, which is the point (I7).
//
// Branch and interviewer come from the shared controls, so this bar and the ones on the evaluation
// and ready-to-hire queues cannot drift apart; both hide themselves when the caller cannot read the
// directory they need, which keeps the filters from implying access nobody granted.
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
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Input } from '../../../../../shared/ui/form';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { localized } from '../../../../../shared/lib/format';
import { BranchFilterSelect } from '../../shared/BranchFilterSelect';
import { UserPicker } from '../../shared/UserPicker';
import { ApplicantPicker } from './ApplicantPicker';
import { useInterviewStages } from '../api/interview-queries';

export interface InterviewFiltersState {
  search: string;
  status: InterviewStatus[];
  outcome: InterviewOutcome[];
  stageId: string[];
  applicantId: string;
  applicantLabel: string;
  /** The panel member the round is assigned to. */
  interviewerId: string;
  interviewerLabel: string;
  branchId: string[];
  scheduledFrom: string;
  scheduledTo: string;
}

export const EMPTY_INTERVIEW_FILTERS: InterviewFiltersState = {
  search: '',
  status: [],
  outcome: [],
  stageId: [],
  applicantId: '',
  applicantLabel: '',
  interviewerId: '',
  interviewerLabel: '',
  branchId: [],
  scheduledFrom: '',
  scheduledTo: '',
};

const isActive = (f: InterviewFiltersState): boolean =>
  f.search !== '' ||
  f.status.length > 0 ||
  f.outcome.length > 0 ||
  f.stageId.length > 0 ||
  f.applicantId !== '' ||
  f.interviewerId !== '' ||
  f.branchId.length > 0 ||
  f.scheduledFrom !== '' ||
  f.scheduledTo !== '';

/** Controls a page already owns elsewhere. */
export type InterviewFilterControl = 'status' | 'stage';

export const InterviewFilters = ({
  value,
  onChange,
  omit = [],
}: {
  value: InterviewFiltersState;
  onChange: (next: InterviewFiltersState) => void;
  omit?: readonly InterviewFilterControl[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: stages = [] } = useInterviewStages();
  const set = (patch: Partial<InterviewFiltersState>): void => onChange({ ...value, ...patch });
  const shows = (control: InterviewFilterControl): boolean => !omit.includes(control);

  // Clearing must not wipe what the page owns: on a stage page the stage id comes from the route,
  // so "clear filters" keeps it and resets only the controls actually on screen.
  const cleared: InterviewFiltersState = {
    ...EMPTY_INTERVIEW_FILTERS,
    ...(shows('stage') ? {} : { stageId: value.stageId }),
    ...(shows('status') ? {} : { status: value.status }),
  };
  // …and the "any filters active?" hint must ignore them too, or the Clear button never goes away.
  const active =
    isActive({ ...value, ...(shows('stage') ? {} : { stageId: [] }), ...(shows('status') ? {} : { status: [] }) });

  return (
    <FilterBar onClear={() => onChange(cleared)} hasActiveFilters={active}>
      <div className="w-full sm:w-72">
        <SearchInput
          value={value.search}
          onChange={(v) => set({ search: v })}
          placeholder={t('interviews.filters.search')}
        />
      </div>

      {shows('status') && (
        <MultiSelect
          label={t('interviews.filters.status')}
          value={value.status}
          onChange={(status) => set({ status: status as InterviewStatus[] })}
          options={INTERVIEW_STATUSES.map((s) => ({ value: s, label: t(`interviews.status.${s}`) }))}
        />
      )}

      <MultiSelect
        label={t('interviews.filters.outcome')}
        value={value.outcome}
        onChange={(outcome) => set({ outcome: outcome as InterviewOutcome[] })}
        options={INTERVIEW_OUTCOMES.map((o) => ({ value: o, label: t(`interviews.outcome.${o}`) }))}
      />

      {shows('stage') && (
        <MultiSelect
          label={t('interviews.filters.stage')}
          value={value.stageId}
          onChange={(stageId) => set({ stageId })}
          options={stages.map((s) => ({ value: s.id, label: localized(s.name, locale) }))}
        />
      )}

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

      {/* "Assigned user" for a round is the panel member it is booked with. */}
      <UserPicker
        value={value.interviewerId === '' ? null : { id: value.interviewerId, label: value.interviewerLabel }}
        onChange={(u) =>
          set({ interviewerId: u === null ? '' : u.id, interviewerLabel: u === null ? '' : u.label })
        }
        searchPlaceholder={t('interviews.filters.interviewerSearch')}
        clearLabel={t('common.clear')}
        noAccessLabel={t('offers.form.needDirectory')}
        emptyLabel={t('offers.form.noUsers')}
      />

      <BranchFilterSelect value={value.branchId} onChange={(branchId) => set({ branchId })} />

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
