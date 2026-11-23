// Job Offer list filters: free-text search (offer number / applicant code), status, the branch,
// department and job the offer is for («فلتر … واحده للاداره و واحده للوظيفه و واحده للفرع»), and an
// "active only" toggle. Emits a flat state; the list page maps it to/from the URL query string.
//
// A department is chosen as the COMPANY's department — «الأمن» once, not once per branch — and
// stands for every branch copy of it (narrowed to the branches picked, if any): `departmentIdsOf`.
import { OFFER_STATUSES, type Locale, type OfferStatus, type OrgUnitOptionDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../../../shared/ui/MultiSelect';
import { Checkbox } from '../../../../../shared/ui/form';
import { localized } from '../../../../../shared/lib/format';
import { useDepartmentReferenceOptions, useJobTitleReferenceOptions } from '../../../../organization/shared/references';
import { groupKeyOf } from '../../../employee-management/employees/lib/placement-filters';
import { BranchFilterSelect } from '../../shared/BranchFilterSelect';

export interface OfferFiltersState {
  search: string;
  status: OfferStatus[];
  active: boolean;
  /** Branch ids. */
  branch: string[];
  /** Company departments, by group key (`groupKeyOf`). */
  department: string[];
  /** Job title ids. */
  job: string[];
}

export const EMPTY_OFFER_FILTERS: OfferFiltersState = {
  search: '',
  status: [],
  active: false,
  branch: [],
  department: [],
  job: [],
};

const isActive = (f: OfferFiltersState): boolean =>
  f.search !== '' ||
  f.status.length > 0 ||
  f.active ||
  f.branch.length > 0 ||
  f.department.length > 0 ||
  f.job.length > 0;

/** The company's departments, one choice per department however many branches hold it. */
export const departmentChoices = (
  departments: readonly OrgUnitOptionDto[],
): { key: string; name: OrgUnitOptionDto['name'] }[] => {
  const seen = new Map<string, OrgUnitOptionDto['name']>();
  for (const unit of departments) if (!seen.has(groupKeyOf(unit))) seen.set(groupKeyOf(unit), unit.name);
  return [...seen.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'));
};

/** An id no department has: a department filter whose branch copies are not known yet. */
export const NO_MATCH = '000000000000000000000000';

/** The branch copies the chosen departments stand for — in the chosen branches, when any are. */
export const departmentIdsOf = (
  keys: readonly string[],
  departments: readonly OrgUnitOptionDto[],
  branches: readonly string[],
): string[] => {
  const wanted = new Set(keys);
  return departments
    .filter((unit) => wanted.has(groupKeyOf(unit)))
    .filter((unit) => branches.length === 0 || (unit.parentId !== null && branches.includes(unit.parentId)))
    .map((unit) => unit.id);
};

/**
 * A search box as wide as its words — its hint, then what is typed — on one line. Full width on a
 * phone, where the bar stacks. Where the browser has no `field-sizing`, the box keeps the input's
 * own default width.
 */
export const SEARCH_FITS_TEXT = 'w-full sm:w-auto [&_input]:[field-sizing:content]';

export const OfferFilters = ({
  value,
  onChange,
}: {
  value: OfferFiltersState;
  onChange: (next: OfferFiltersState) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: departments = [] } = useDepartmentReferenceOptions();
  const { data: jobs = [] } = useJobTitleReferenceOptions();
  const set = (patch: Partial<OfferFiltersState>): void => onChange({ ...value, ...patch });

  return (
    <FilterBar onClear={() => onChange(EMPTY_OFFER_FILTERS)} hasActiveFilters={isActive(value)}>
      {/* «العرض بتاع الفلتر … يكون مظبوط ع كلام بظبط»: the box is as wide as its hint, then as what
          is typed (`field-sizing: content`); every filter beside it is as wide as its own words. */}
      <SearchInput
        value={value.search}
        onChange={(v) => set({ search: v })}
        placeholder={t('offers.filters.search')}
        className={SEARCH_FITS_TEXT}
      />
      <MultiSelect
        label={t('offers.filters.status')}
        value={value.status}
        onChange={(status) => set({ status: status as OfferStatus[] })}
        options={OFFER_STATUSES.map((s) => ({ value: s, label: t(`offers.status.${s}`) }))}
      />
      <MultiSelect
        label={t('offers.filters.department')}
        value={value.department}
        onChange={(department) => set({ department })}
        options={departmentChoices(departments).map((d) => ({ value: d.key, label: localized(d.name, locale) }))}
      />
      <MultiSelect
        label={t('offers.filters.job')}
        value={value.job}
        onChange={(job) => set({ job })}
        options={[...jobs]
          .sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'))
          .map((j) => ({ value: j.id, label: localized(j.name, locale) }))}
      />
      <BranchFilterSelect value={value.branch} onChange={(branch) => set({ branch })} />
      <Checkbox
        label={t('offers.filters.activeOnly')}
        checked={value.active}
        onChange={(e) => set({ active: e.target.checked })}
      />
    </FilterBar>
  );
};
