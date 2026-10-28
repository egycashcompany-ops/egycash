// «حركات المستهلكات» — the consumables ledger across every item (FR-20): every receipt, issue,
// scrap and return, newest first. «وإيه الهالك وأتبدل لمين» is asked of THIS screen — what was
// scrapped, and who received what — and «أقدر أذكر الجهاز اللى أتركب عليه من اللأصول» is answered
// in its «مركّب على» column, which links to the asset.
//
// A screen of its own, reached from the store's register («سجل الحركات») rather than the rail: it
// is the store's history, under the store's grant (`itAsset.view`). Each row is labelled by the
// server at response time — the item, the person, the asset under the reader's scope, the memo —
// and nothing here re-derives a figure: the quantity is always positive and its kind says which
// way it moved.
//
// Every issue row carries its memo: print it again (same number) and file or view the signed copy,
// the controls every paper of the department has. URL-synced and remembered like every IT
// register; Excel and PDF of every movement the filters match (`lib/consumable-movement-register-
// export.ts`).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IT_CONSUMABLE_MOVEMENT_KINDS,
  type ItConsumableMovementKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FilterField } from '../../../shared/ui/FilterField';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Input, Select } from '../../../shared/ui/form';
import { cn } from '../../../shared/lib/cn';
import { formatDate, fullName, localized } from '../../../shared/lib/format';
import * as api from '../api/it-api';
import {
  useItAsset,
  useItBranchOptions,
  useItCatalog,
  useItConsumableMovements,
  useItPerson,
} from '../api/it-queries';
import { AssetPicker } from '../components/AssetPicker';
import { EmployeePicker } from '../components/EmployeePicker';
import { ItCatalogSelect } from '../components/ItCatalogSelect';
import { RegisterExportButtons } from '../components/RegisterExportButtons';
import { useConsumableMovementColumns } from '../components/ConsumableMovements';
import { saveSheet } from '../../fleet/lib/fleet-sheet';
import {
  consumableMovementRegisterFilters,
  consumableMovementRegisterHeader,
  consumableMovementRegisterLine,
  consumableMovementRegisterReport,
  consumableMovementRegisterSubtitle,
} from '../lib/consumable-movement-register-export';
import { gatherRegister, printItRegister } from '../lib/register-export';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'asset',
  'branch',
  'employee',
  'from',
  'kind',
  'q',
  'size',
  'to',
  'type',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** A filter's box in the bar: the whole row on a phone, its own width from a tablet up. */
const FIELD = 'w-full self-start';

const isKind = (value: string): value is ItConsumableMovementKind =>
  (IT_CONSUMABLE_MOVEMENT_KINDS as readonly string[]).includes(value);

/**
 * One bound of the date filter — «من» or «إلى» — its word written INSIDE the empty box, where the
 * date goes: the owner asked it of Fleet's boards («عاوز الفلاتر التواريخ … تكون مكتوبه على
 * المكان اللى هسجل فيه التاريخ مش جمبها»), and the custody register repeats it. A date box has no
 * placeholder — Chromium paints its «yyyy-mm-dd» mask whatever it is given — so while the box is
 * empty and not being typed in, the mask is hidden and the word drawn over it. The word is
 * decoration only: the box keeps its own name.
 */
const DayBound = ({
  label,
  caption,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  caption: string;
  value: string;
  /** The other bound, so the picker cannot offer an inverted window. */
  min?: string;
  max?: string;
  onChange: (day: string) => void;
}): JSX.Element => (
  <div className="relative min-w-0">
    <Input
      type="date"
      dir="ltr"
      aria-label={label}
      title={label}
      value={value}
      {...(min === undefined || min === '' ? {} : { min })}
      {...(max === undefined || max === '' ? {} : { max })}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'dark:[color-scheme:dark]',
        value === '' && 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0',
      )}
    />
    {value === '' && (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 right-8 flex items-center justify-center truncate text-sm text-slate-400 peer-focus:hidden dark:text-slate-500"
      >
        {caption}
      </span>
    )}
  </div>
);

export const ConsumableMovementsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // A kind the filter does not offer (an edited link) is no filter, rather than a refused request.
  const kindParam = sp.get('kind') ?? '';
  const kind = isKind(kindParam) ? kindParam : null;
  const typeId = sp.get('type') ?? '';
  const branchId = sp.get('branch') ?? '';
  // Ids, so the filter survives a rename and can be linked.
  const employeeId = sp.get('employee') ?? '';
  const assetId = sp.get('asset') ?? '';
  // Days as the date boxes write them, `YYYY-MM-DD` — what the request sends; the server reads
  // «إلى» as the whole of its day, as the custody register's does.
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  const hasActiveFilters =
    kind !== null ||
    typeId !== '' ||
    branchId !== '' ||
    employeeId !== '' ||
    assetId !== '' ||
    from !== '' ||
    to !== '' ||
    search !== '';

  // Newest first is the ledger's own order, which the server keeps when no sort is sent.
  const params = useMemo(
    () => ({
      page,
      pageSize,
      kind: kind ?? undefined,
      typeId: typeId || undefined,
      branchId: branchId || undefined,
      employeeId: employeeId || undefined,
      assetId: assetId || undefined,
      from: from || undefined,
      to: to || undefined,
      search: search.trim() || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItConsumableMovements(params);
  const rows = data?.items ?? [];
  const columns = useConsumableMovementColumns();

  // The employee chip's label: the pick supplies it, kept WITH the id it was picked for (back and
  // forward change the id underneath); arriving on a link with only an id, the rows name the
  // person, and failing that the person is resolved by id — the custody register's rule.
  const [pickedEmployee, setPickedEmployee] = useState({ id: '', label: '' });
  const pickedHere = pickedEmployee.id === employeeId && pickedEmployee.label !== '';
  const rowEmployee = rows.find((m) => m.employeeId === employeeId && m.employeeName !== null);
  const rowEmployeeName =
    rowEmployee === undefined || rowEmployee.employeeName === null
      ? null
      : `${rowEmployee.employeeName}${rowEmployee.employeeCode === null ? '' : ` (${rowEmployee.employeeCode})`}`;
  const person = useItPerson(employeeId, !pickedHere && rowEmployeeName === null);
  const employeeLabel = pickedHere
    ? pickedEmployee.label
    : (rowEmployeeName ??
      (person.data === undefined ? '' : `${person.data.fullNameAr} (${person.data.code})`));
  // The asset's, for the printed line: the picker resolves the same asset by id for its chip.
  const asset = useItAsset(assetId);
  const assetLabel = asset.data === undefined ? '' : `${asset.data.assetCode} — ${asset.data.name}`;

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  const types = useItCatalog('consumableType');
  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of types.data?.items ?? []) map.set(type.id, localized(type.name, locale));
    return map;
  }, [types.data, locale]);

  // ── The ledger as a file: Excel and PDF, of every movement the filters match ────────────────
  // Every movement the filters match, newest first — the table's own params, unpaged.
  const allRows = () => gatherRegister(params, api.listConsumableMovements);
  /**
   * «بواسطة» by name. The table names each user through the platform directory, which needs
   * `user.view`; the file asks the same of the few people who recorded the rows — once each — and
   * leaves the cell blank for anyone it may not name, never guessing.
   */
  const userNames = async (
    movements: readonly { byUserId: string | null }[],
  ): Promise<Map<string, string>> => {
    const names = new Map<string, string>();
    if (!can('user.view')) return names;
    const ids = [...new Set(movements.flatMap((m) => (m.byUserId === null ? [] : [m.byUserId])))];
    const found = await Promise.all(
      ids.map((id) =>
        api
          .getUser(id)
          .then((user) => [id, fullName(user, locale)] as const)
          .catch(() => null),
      ),
    );
    for (const entry of found) if (entry !== null) names.set(entry[0], entry[1]);
    return names;
  };
  const toExcel = async (): Promise<void> => {
    const all = await allRows();
    const context = { t, locale, typeName, userName: await userNames(all) };
    saveSheet({
      name: t('it.nav.consumableMovements'),
      serialHeader: t('it.export.serial'),
      header: consumableMovementRegisterHeader(t),
      rows: all.map((row) => consumableMovementRegisterLine(row, context, '')),
    });
  };
  const toPdf = (): Promise<boolean> =>
    printItRegister(async () => {
      const all = await allRows();
      const context = { t, locale, typeName, userName: await userNames(all) };
      const subtitle = consumableMovementRegisterSubtitle(t, {
        ...consumableMovementRegisterFilters({
          locale,
          kind,
          typeId,
          typeName,
          branchId,
          branchName,
          employeeId,
          employeeLabel,
          assetId,
          assetLabel,
          from,
          to,
          search,
          rows: all,
        }),
        asOf: formatDate(new Date().toISOString(), locale),
      });
      return consumableMovementRegisterReport(all, context, subtitle);
    }, t('it.export.preparing'));

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.consumableMovements')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.consumables'), to: '/it/consumables' },
          { label: t('it.nav.consumableMovements') },
        ]}
        actions={
          <>
            {!isError && (
              <RegisterExportButtons
                name="it-consumable-movements"
                onExcel={toExcel}
                onPdf={toPdf}
              />
            )}
            <Link
              to="/it/consumables"
              className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t('it.consumables.backToStore')}
            </Link>
          </>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => {
            setPickedEmployee({ id: '', label: '' });
            patch({
              kind: null,
              type: null,
              branch: null,
              employee: null,
              asset: null,
              from: null,
              to: null,
              q: null,
            });
          }}
        >
          <FilterField
            label={t('it.consumables.movements.columns.kind')}
            active={kind !== null}
            className={cn(FIELD, 'sm:w-40')}
          >
            <Select
              aria-label={t('it.consumables.movements.columns.kind')}
              value={kind ?? ''}
              onChange={(e) => patch({ kind: e.target.value || null })}
            >
              <option value="">{t('it.consumables.movements.allKinds')}</option>
              {IT_CONSUMABLE_MOVEMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`it.consumables.kind.${k}`)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField
            label={t('it.consumables.movements.columns.item')}
            active={search.trim() !== ''}
            className={cn(FIELD, 'sm:w-56')}
          >
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('it.consumables.searchPlaceholder')}
              className="w-full"
            />
          </FilterField>
          <FilterField
            label={t('it.consumables.columns.type')}
            active={typeId !== ''}
            className={cn(FIELD, 'sm:w-44')}
          >
            <ItCatalogSelect
              kind="consumableType"
              value={typeId}
              onChange={(id) => patch({ type: id || null })}
              allLabel={t('it.consumables.allTypes')}
              ariaLabel={t('it.consumables.columns.type')}
              className="w-full"
            />
          </FilterField>
          <FilterField
            label={t('it.assets.columns.branch')}
            active={branchId !== ''}
            className={cn(FIELD, 'sm:w-44')}
          >
            <Select
              aria-label={t('it.assets.columns.branch')}
              value={branchId}
              onChange={(e) => patch({ branch: e.target.value || null })}
            >
              <option value="">{t('it.assets.allBranches')}</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField
            label={t('it.consumables.movements.columns.at')}
            active={from !== '' || to !== ''}
            className={cn(FIELD, 'sm:w-80')}
          >
            <div className="grid grid-cols-2 gap-2">
              <DayBound
                label={`${t('it.consumables.movements.columns.at')} — ${t('it.custody.filters.from')}`}
                caption={t('it.custody.filters.from')}
                value={from}
                max={to}
                onChange={(day) => patch({ from: day || null })}
              />
              <DayBound
                label={`${t('it.consumables.movements.columns.at')} — ${t('it.custody.filters.to')}`}
                caption={t('it.custody.filters.to')}
                value={to}
                min={from}
                onChange={(day) => patch({ to: day || null })}
              />
            </div>
          </FilterField>
          {/* A SEARCH: everybody HR has, leavers included — a leaver may still have been handed a
              mouse, and who received what is the question this screen answers. */}
          <FilterField
            label={t('it.consumables.movements.columns.employee')}
            active={employeeId !== ''}
            className={cn(FIELD, 'sm:w-64')}
          >
            <EmployeePicker
              includeExited
              value={employeeId}
              valueLabel={employeeLabel}
              ariaLabel={t('it.consumables.movements.filterEmployee')}
              onChange={(id, label) => {
                setPickedEmployee({ id, label });
                patch({ employee: id || null });
              }}
            />
          </FilterField>
          <FilterField
            label={t('it.consumables.movements.columns.installedOn')}
            active={assetId !== ''}
            className={cn(FIELD, 'sm:w-64')}
          >
            <AssetPicker
              value={assetId}
              onChange={(id) => patch({ asset: id || null })}
              ariaLabel={t('it.consumables.movements.filterAsset')}
            />
          </FilterField>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('it.consumables.movements.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>
    </PageContainer>
  );
};
