// The register's filter bar. Every control here narrows the SERVER's answer — the register runs to
// thousands of rows and is paged, so a filter applied to the rows in hand would only filter one
// page. The page owns the URL; this bar only reads the values it is given and reports changes, so
// the screen's census entry (what it reads, what it remembers) stays in `RegisterPage.tsx`.
//
// Area depends on branch: the same area name means different streets in two branches, and the
// list of areas is the branch's own (`/atm/register/branch-options`). Without a branch the area box
// is disabled, and changing the branch clears the area it no longer belongs to.
import {
  ATM_BANK_CODES,
  ATM_REGISTER_STATUSES,
  type AtmBankCode,
  type AtmRegisterMetaDto,
  type AtmRegisterStatus,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatNumber } from '../../../../shared/lib/format';
import { Combobox } from '../../../../shared/ui/Combobox';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { FilterField } from '../../../../shared/ui/FilterField';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Checkbox, Select } from '../../../../shared/ui/form';
import { useRegisterBranchOptions } from '../../api/register-queries';
import { bankName, branchLabel, statusLabelKey } from '../../lib/register-labels';

export interface RegisterFilterValues {
  /** ECMS branch id, '' = every branch the reader may see. */
  branch: string;
  banks: AtmBankCode[];
  statuses: AtmRegisterStatus[];
  area: string;
  q: string;
  issues: boolean;
}

/** The URL params this bar writes — a subset of the page's remembered list. */
export type RegisterFilterUpdate = Partial<
  Record<'branch' | 'bank' | 'status' | 'area' | 'q' | 'issues', string | null>
>;

/** The branches a reader may filter by: mapped to an ECMS branch, and inside their view reach. */
export const viewableBranches = (
  meta: AtmRegisterMetaDto | undefined,
): AtmRegisterMetaDto['branches'] =>
  (meta?.branches ?? []).filter((b) => b.canView && b.branchId !== null);

/** «EGYCASH-1 · المهندسين» — the code the sheet writes, then the branch's ECMS name. */
/**
 * The `q` the search box writes: what was typed, exactly, or nothing for an empty box. NOT trimmed
 * here — `SearchInput` re-emits whenever its text differs from the value it is handed back, so a
 * box holding only spaces, written as "no q", came back as '' and was re-emitted every 300 ms,
 * each one a new history entry (review finding WEB-2). The page trims before it asks the server.
 */
export const searchParamOf = (text: string): string | null => (text === '' ? null : text);

export const registerBranchOptionLabel = (
  branch: AtmRegisterMetaDto['branches'][number],
  locale: Locale,
): string => `${branch.code} · ${branch.branchName?.[locale] ?? branchLabel(branch.code, locale)}`;

export const RegisterFilters = ({
  values,
  meta,
  total,
  onChange,
  onClear,
}: {
  values: RegisterFilterValues;
  meta: AtmRegisterMetaDto | undefined;
  /** Rows the server matched, across every page — `null` while it is still being asked. */
  total: number | null;
  onChange: (update: RegisterFilterUpdate) => void;
  onClear: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const areas = useRegisterBranchOptions(values.branch === '' ? null : values.branch);
  const hasFilters =
    values.branch !== '' ||
    values.banks.length > 0 ||
    values.statuses.length > 0 ||
    values.area !== '' ||
    values.q !== '' ||
    values.issues;

  return (
    <FilterBar
      hasActiveFilters={hasFilters}
      onClear={onClear}
      {...(total === null
        ? {}
        : {
            trailing: (
              <span
                data-register-total="true"
                className="whitespace-nowrap text-sm font-medium text-slate-500 dark:text-slate-400"
              >
                {t('common.list.count', { count: formatNumber(total, locale) })}
              </span>
            ),
          })}
    >
      <FilterField
        label={t('common.search')}
        active={values.q.trim() !== ''}
        className="w-full sm:w-64"
      >
        <SearchInput
          value={values.q}
          onChange={(q) => onChange({ q: searchParamOf(q) })}
          placeholder={t('atm.register.filter.search')}
        />
      </FilterField>
      <FilterField
        label={t('atm.register.filter.branch')}
        active={values.branch !== ''}
        className="w-full sm:w-52"
      >
        <Select
          aria-label={t('atm.register.filter.branch')}
          value={values.branch}
          // A branch's areas are its own: the area picked under another branch no longer applies.
          onChange={(e) => onChange({ branch: e.target.value || null, area: null })}
        >
          <option value="">{t('atm.register.filter.allBranches')}</option>
          {viewableBranches(meta).map((branch) => (
            <option key={branch.code} value={branch.branchId ?? ''}>
              {registerBranchOptionLabel(branch, locale)}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterField
        label={t('atm.register.filter.bank')}
        active={values.banks.length > 0}
        className="w-full sm:w-40"
      >
        <MultiSelect
          label={t('atm.register.filter.bank')}
          placeholder={t('atm.register.filter.allBanks')}
          fullWidth
          clearable
          options={ATM_BANK_CODES.map((code) => ({
            value: code,
            label: `${code} · ${bankName(code, locale)}`,
          }))}
          value={values.banks}
          onChange={(next) => onChange({ bank: next.length === 0 ? null : next.join(',') })}
        />
      </FilterField>
      <FilterField
        label={t('atm.register.filter.status')}
        active={values.statuses.length > 0}
        className="w-full sm:w-40"
      >
        <MultiSelect
          label={t('atm.register.filter.status')}
          placeholder={t('atm.register.filter.allStatuses')}
          fullWidth
          clearable
          options={ATM_REGISTER_STATUSES.map((status) => ({
            value: status,
            label: t(statusLabelKey(status)),
          }))}
          value={values.statuses}
          onChange={(next) => onChange({ status: next.length === 0 ? null : next.join(',') })}
        />
      </FilterField>
      <FilterField
        label={t('atm.register.filter.area')}
        active={values.area !== ''}
        className="w-full sm:w-44"
      >
        <Combobox
          ariaLabel={t('atm.register.filter.area')}
          value={values.area}
          options={areas.data?.areas ?? []}
          onChange={(area) => onChange({ area: area === '' ? null : area })}
          placeholder={t('atm.register.filter.allAreas')}
          emptyText={t('common.noResults')}
          clearLabel={t('common.clear')}
          disabled={values.branch === ''}
        />
      </FilterField>
      <div className="flex h-9 items-center self-end">
        <Checkbox
          label={t('atm.register.filter.withIssues')}
          checked={values.issues}
          onChange={(e) => onChange({ issues: e.target.checked ? '1' : null })}
        />
      </div>
    </FilterBar>
  );
};
