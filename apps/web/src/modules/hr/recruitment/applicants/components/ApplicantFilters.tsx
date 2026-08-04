// Multi-filter bar for the applicants list: free-text search + status, source, intake channel,
// identity-verification, duplicate-only and has-attachments filters. Emits a flat filter state;
// the list page turns it into query params (empty values are dropped).
import {
  APPLICANT_INTAKE_CHANNELS,
  APPLICANT_STATUSES,
  IDENTITY_VERIFICATION_STATES,
  type ApplicantIntakeChannel,
  type ApplicantSourceDto,
  type ApplicantStatus,
  type IdentityVerification,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { localized } from '../../../../../shared/lib/format';
import { useAppSelector } from '../../../../../store';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Checkbox } from '../../../../../shared/ui/form';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';

export interface ApplicantFiltersState {
  search: string;
  status: ApplicantStatus[];
  sourceId: string[];
  intakeChannel: ApplicantIntakeChannel[];
  identityVerification: IdentityVerification[];
  duplicateOnly: boolean;
  hasAttachments: boolean;
}

export const EMPTY_APPLICANT_FILTERS: ApplicantFiltersState = {
  search: '',
  status: [],
  sourceId: [],
  intakeChannel: [],
  identityVerification: [],
  duplicateOnly: false,
  hasAttachments: false,
};

const isActive = (f: ApplicantFiltersState): boolean =>
  f.search !== '' ||
  f.status.length > 0 ||
  f.sourceId.length > 0 ||
  f.intakeChannel.length > 0 ||
  f.identityVerification.length > 0 ||
  f.duplicateOnly ||
  f.hasAttachments;

export const ApplicantFilters = ({
  value,
  onChange,
  sources,
}: {
  value: ApplicantFiltersState;
  onChange: (next: ApplicantFiltersState) => void;
  sources: ApplicantSourceDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const set = (patch: Partial<ApplicantFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_APPLICANT_FILTERS)} hasActiveFilters={isActive(value)}>
      <SearchInput
        value={value.search}
        onChange={(search) => set({ search })}
        placeholder={t('applicants.filters.searchPlaceholder')}
        className="w-full sm:w-72"
      />
      <MultiSelect
        label={t('applicants.filters.status')}
        value={value.status}
        onChange={(status) => set({ status: status as ApplicantStatus[] })}
        options={APPLICANT_STATUSES.map((s) => ({ value: s, label: t(`applicants.status.${s}`) }))}
      />
      <MultiSelect
        label={t('applicants.filters.source')}
        value={value.sourceId}
        onChange={(sourceId) => set({ sourceId })}
        options={sources.map((s) => ({ value: s.id, label: localized(s.name, locale) }))}
      />
      <MultiSelect
        label={t('applicants.filters.channel')}
        value={value.intakeChannel}
        onChange={(intakeChannel) => set({ intakeChannel: intakeChannel as ApplicantIntakeChannel[] })}
        options={APPLICANT_INTAKE_CHANNELS.map((c) => ({ value: c, label: t(`applicants.channel.${c}`) }))}
      />
      <MultiSelect
        label={t('applicants.filters.identity')}
        value={value.identityVerification}
        onChange={(identityVerification) =>
          set({ identityVerification: identityVerification as IdentityVerification[] })
        }
        options={IDENTITY_VERIFICATION_STATES.map((v) => ({
          value: v,
          label: t(`applicants.identity.${v}`),
        }))}
      />
      <Checkbox
        label={t('applicants.filters.duplicatesOnly')}
        checked={value.duplicateOnly}
        onChange={(e) => set({ duplicateOnly: e.target.checked })}
      />
      <Checkbox
        label={t('applicants.filters.hasAttachments')}
        checked={value.hasAttachments}
        onChange={(e) => set({ hasAttachments: e.target.checked })}
      />
    </FilterBar>
  );
};
