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
import { Select, Checkbox } from '../../../../../shared/ui/form';

export interface ApplicantFiltersState {
  search: string;
  status: '' | ApplicantStatus;
  sourceId: string;
  intakeChannel: '' | ApplicantIntakeChannel;
  identityVerification: '' | IdentityVerification;
  duplicateOnly: boolean;
  hasAttachments: boolean;
}

export const EMPTY_APPLICANT_FILTERS: ApplicantFiltersState = {
  search: '',
  status: '',
  sourceId: '',
  intakeChannel: '',
  identityVerification: '',
  duplicateOnly: false,
  hasAttachments: false,
};

const isActive = (f: ApplicantFiltersState): boolean =>
  f.search !== '' ||
  f.status !== '' ||
  f.sourceId !== '' ||
  f.intakeChannel !== '' ||
  f.identityVerification !== '' ||
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
      <Select
        aria-label={t('applicants.filters.status')}
        value={value.status}
        onChange={(e) => set({ status: e.target.value as ApplicantFiltersState['status'] })}
        className="w-auto"
      >
        <option value="">{t('applicants.filters.allStatuses')}</option>
        {APPLICANT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`applicants.status.${s}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('applicants.filters.source')}
        value={value.sourceId}
        onChange={(e) => set({ sourceId: e.target.value })}
        className="w-auto"
      >
        <option value="">{t('applicants.filters.allSources')}</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {localized(s.name, locale)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('applicants.filters.channel')}
        value={value.intakeChannel}
        onChange={(e) => set({ intakeChannel: e.target.value as ApplicantFiltersState['intakeChannel'] })}
        className="w-auto"
      >
        <option value="">{t('applicants.filters.allChannels')}</option>
        {APPLICANT_INTAKE_CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`applicants.channel.${c}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('applicants.filters.identity')}
        value={value.identityVerification}
        onChange={(e) =>
          set({ identityVerification: e.target.value as ApplicantFiltersState['identityVerification'] })
        }
        className="w-auto"
      >
        <option value="">{t('applicants.filters.allIdentity')}</option>
        {IDENTITY_VERIFICATION_STATES.map((v) => (
          <option key={v} value={v}>
            {t(`applicants.identity.${v}`)}
          </option>
        ))}
      </Select>
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
