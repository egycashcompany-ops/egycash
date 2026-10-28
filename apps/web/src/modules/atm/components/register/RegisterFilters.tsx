// The register's filter bar. Every control here narrows the SERVER's answer — the register runs to
// thousands of rows and is paged, so a filter applied to the rows in hand would only filter one
// page. The page owns the URL; this bar only reads the values it is given and reports changes, so
// the screen's census entry (what it reads, what it remembers) stays in `RegisterPage.tsx`.
//
// Area depends on branch: the same area name means different streets in two branches, and the
// list of areas is the branch's own (`/atm/register/branch-options`). Without a branch the area box
// is disabled, and changing the branch clears the area it no longer belongs to.
//
// The branches are the top bar's (the owner, 2026-10-28: «الفروع فوق خالص فى البار بتاع السيستم غير
// اللى فى الفلاتر»): one option per ECMS branch the register files under, named and ordered as the
// switcher names and orders them, and only those the reader's view scope covers — the server's
// answer, which follows the top bar, so no option lists a branch whose rows the list would hide.
//
// Banks are the catalog's (DEC-35): every bank, archived ones too — their entries are still in the
// register and must stay findable — with «(مؤرشف)» after an archived one, plus any code a link or a
// remembered view carries that the catalog does not hold, so it can be seen and cleared.
//
// «بيانات ناقصة فقط» (DEC-37) narrows to the receipts Operations recorded from /atm/data-edit, and
// anything Efficiency marked to come back to — the rows still to be completed.
import {
  ATM_REGISTER_STATUSES,
  type AtmBankCode,
  type AtmRegisterMetaBranchOptionDto,
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
import {
  areaOptionText,
  inCatalogOrder,
  makeBankLookup,
  type BankLookup,
} from '../../lib/bank-catalog';
import { statusLabelKey } from '../../lib/register-labels';

export interface RegisterFilterValues {
  /** ECMS branch id, '' = every branch the reader may see. */
  branch: string;
  banks: AtmBankCode[];
  statuses: AtmRegisterStatus[];
  area: string;
  q: string;
  issues: boolean;
  /** Only entries marked «بيانات ناقصة». */
  incomplete: boolean;
}

/** The URL params this bar writes — a subset of the page's remembered list. */
export type RegisterFilterUpdate = Partial<
  Record<'branch' | 'bank' | 'status' | 'area' | 'q' | 'issues' | 'incomplete', string | null>
>;

/**
 * The bank filter's options: every catalog bank in its order, archived ones marked, then any code
 * the filter already holds that the catalog does not (a stale link) — never a chosen value the
 * list cannot show.
 */
export const registerBankFilterOptions = (
  lookup: BankLookup,
  chosen: readonly string[],
  locale: Locale,
  t: (key: string, params?: Record<string, string | number>) => string,
): { value: string; label: string; shortLabel: string }[] => {
  const archived = new Set(lookup.ordered.filter((b) => !b.isActive).map((b) => b.code));
  return inCatalogOrder(lookup, [...lookup.codes, ...chosen]).map((code) => {
    const label = `${code} · ${lookup.name(code, locale)}`;
    return {
      value: code,
      label: archived.has(code) ? t('atm.bankCatalog.archivedOption', { name: label }) : label,
      shortLabel: code,
    };
  });
};

/**
 * The branches the register files under — one per ECMS branch some code resolves to, never two
 * for one, named and ordered as the top bar names and orders them (`meta.branchOptions`). An older
 * server's meta has no such list (a rolling deploy): its per-code rows stand in, one per mapped
 * branch, as they were offered before.
 */
export const registerBranchChoices = (
  meta: AtmRegisterMetaDto | undefined,
): AtmRegisterMetaBranchOptionDto[] =>
  meta?.branchOptions ??
  (meta?.branches ?? []).flatMap((row): AtmRegisterMetaBranchOptionDto[] =>
    row.branchId === null
      ? []
      : [
          {
            branchId: row.branchId,
            name: row.branchName ?? row.name,
            codes: [row.code],
            sourceBranchIds: [],
            active: row.branchActive,
            canView: row.canView,
            canCreate: row.canCreate,
          },
        ],
  );

/**
 * The branches a reader may filter by: those the register's view scope covers, judged by the
 * server on the top bar's choice — an organization-wide reader on «المهندسين» is offered المهندسين
 * alone, on «كل الشركة» every branch.
 */
export const viewableBranches = (
  meta: AtmRegisterMetaDto | undefined,
): AtmRegisterMetaBranchOptionDto[] => registerBranchChoices(meta).filter((b) => b.canView);

/**
 * The option a filter value stands for: its branch, or the branch a linked source works as
 * (`sourceBranchIds`) — a filter remembered from before the link reads as the branch whose rows,
 * the source's among them, the server lists for it.
 */
export const registerBranchFilterValue = (
  choices: readonly AtmRegisterMetaBranchOptionDto[],
  value: string,
): string =>
  choices.find((b) => b.branchId === value || b.sourceBranchIds.includes(value))?.branchId ?? value;

/**
 * A branch filter the server no longer offers — the top bar moved since it was chosen (`canView`
 * follows it), or a link came from another reader's view. The select would read «كل الفروع» while
 * the list stays narrowed to that branch and answers empty, and choosing «كل الفروع» would change
 * nothing (review finding). The page drops it once the meta has answered, as the top bar drops a
 * stored branch it no longer offers (BranchSwitcher). Never before the meta answers: until then
 * nothing is known about which branches the reader may see.
 */
export const strayRegisterBranch = (meta: AtmRegisterMetaDto | undefined, value: string): boolean =>
  meta !== undefined &&
  value !== '' &&
  !viewableBranches(meta).some((b) => b.branchId === value || b.sourceBranchIds.includes(value));

/**
 * The `q` the search box writes: what was typed, exactly, or nothing for an empty box. NOT trimmed
 * here — `SearchInput` re-emits whenever its text differs from the value it is handed back, so a
 * box holding only spaces, written as "no q", came back as '' and was re-emitted every 300 ms,
 * each one a new history entry (review finding WEB-2). The page trims before it asks the server.
 */
export const searchParamOf = (text: string): string | null => (text === '' ? null : text);

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
  const lookup = makeBankLookup(meta?.banks);
  const branches = viewableBranches(meta);
  // The area filter matches the STORED name — what the entries carry; a labelled area reads in
  // the reader's language, with the stored name after it when the two differ (DEC-38).
  const areaText = new Map(
    (areas.data?.areaOptions ?? []).map((area) => [area.name, areaOptionText(area, locale)]),
  );
  const hasFilters =
    values.branch !== '' ||
    values.banks.length > 0 ||
    values.statuses.length > 0 ||
    values.area !== '' ||
    values.q !== '' ||
    values.issues ||
    values.incomplete;

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
          value={registerBranchFilterValue(branches, values.branch)}
          // A branch's areas are its own: the area picked under another branch no longer applies.
          onChange={(e) => onChange({ branch: e.target.value || null, area: null })}
        >
          <option value="">{t('atm.register.filter.allBranches')}</option>
          {/* The switcher's label: the branch's ECMS name, nothing before it (BranchSwitcher). */}
          {branches.map((branch) => (
            <option key={branch.branchId} value={branch.branchId}>
              {branch.name[locale]}
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
          options={registerBankFilterOptions(lookup, values.banks, locale, t)}
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
          optionLabel={(name) => areaText.get(name) ?? name}
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
      <div className="flex h-9 items-center self-end">
        <Checkbox
          label={t('atm.register.filter.incomplete')}
          checked={values.incomplete}
          data-register-filter="incomplete"
          onChange={(e) => onChange({ incomplete: e.target.checked ? '1' : null })}
        />
      </div>
    </FilterBar>
  );
};
