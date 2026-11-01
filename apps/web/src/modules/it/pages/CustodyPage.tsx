// The custody register (design §12 `/it/assignments`): what is out, and who has it.
//
// This is the screen the question "who has the laptop" is actually asked of — the asset list
// answers "what do we own", and that is a different question. URL-synced so a filtered view is a
// shareable link, and defaulting to OPEN intervals because that is what the question means; the
// closed ones are one filter away for the times it means "who had it".
//
// «عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد الفلتر
// طبعاً)» — beside the hand-over, the register as Excel and as a printed PDF: every row the
// filters match, in the table's order, not the page on screen (`lib/custody-register-export.ts`).
//
// «وكمان فى شاشة عهد الأصول /it/custody عايزك تزود سيريال الأصول لما أعمل Extract وزود الفلتر
// بتاع الجدول ببيانات الجدول» — the serial in both files, and a filter for each of the table's
// columns, standing in the columns' own order under the columns' own names: the reader looks up
// from a column to the filter above it, not along a row of boxes guessing which is which.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ItAssetAssignmentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FilterField } from '../../../shared/ui/FilterField';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { EmployeePicker } from '../components/EmployeePicker';
import { ItCatalogSelect } from '../components/ItCatalogSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { Input, Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EyeIcon, UsersIcon } from '../../../shared/ui/icons';
import { CustodyReceiptActions } from '../components/CustodyReceipt';
import { RegisterExportButtons } from '../components/RegisterExportButtons';
import { AssignAssetDialog } from '../components/CustodyDialogs';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import * as api from '../api/it-api';
import { useItAssignments, useItBranchOptions, useItCatalog, useItPerson } from '../api/it-queries';
import { saveSheet } from '../../fleet/lib/fleet-sheet';
import {
  custodyRegisterHeader,
  custodyRegisterLine,
  custodyRegisterReport,
  custodyRegisterFilters,
  custodyRegisterSubtitle,
  receiptStateOf,
} from '../lib/custody-register-export';
import {
  custodyStatusOf,
  overdueUpdates,
  readBackFilters,
  returnDayUpdates,
  statusUpdates,
} from '../lib/custody-filters';
import { gatherRegister, printItRegister } from '../lib/register-export';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'assignedFrom',
  'assignedTo',
  'branch',
  'category',
  'employee',
  'open',
  'overdue',
  'q',
  'receipt',
  'returnedFrom',
  'returnedTo',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/**
 * A filter's box in the bar: the whole row on a phone, so nothing is clipped and no page scrolls
 * sideways, and its own width from a tablet up. Top-aligned, so the names stay on one line when
 * the holder's box grows to show the chosen person above its search.
 */
const FIELD = 'w-full self-start';

/**
 * One bound of a date filter — «من» or «إلى» — its word written INSIDE the empty box, where the
 * date goes. The owner asked it of Fleet's boards («عاوز الفلاتر التواريخ … تكون مكتوبه على المكان
 * اللى هسجل فيه التاريخ مش جمبها»), and this repeats Fleet's `dateBound`: a date box has no
 * placeholder — Chromium paints its «yyyy-mm-dd» mask whatever it is given — so while the box is
 * empty and not being typed in, the mask is made invisible and the word drawn over it. A click, or
 * a date, brings the mask back. The word is decoration only: the box keeps its own name.
 */
const DayBound = ({
  label,
  caption,
  value,
  min,
  max,
  onChange,
}: {
  /** The box's accessible name — the column and the bound, «تاريخ التسليم — من». */
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

export const CustodyPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  // «تسليم عهدة» from the register itself — the receipt starts empty and takes several assets.
  const [handingOver, setHandingOver] = useState(false);
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // Default `open` — the register's whole purpose is "currently out".
  const openParam = custodyStatusOf(sp);
  const branchId = sp.get('branch') ?? '';
  const employeeId = sp.get('employee') ?? '';
  // «الصنف»: the asset's code, name or serial.
  const search = sp.get('q') ?? '';
  const categoryId = sp.get('category') ?? '';
  // Days as the date boxes write them, `YYYY-MM-DD` — what the request sends, and the server
  // reads «إلى» as the whole of its day.
  const assignedFrom = sp.get('assignedFrom') ?? '';
  const assignedTo = sp.get('assignedTo') ?? '';
  // The status, the return days and «متأخر» read one fact — whether the asset is back — and are
  // read and picked so they never contradict each other (`lib/custody-filters.ts`).
  const { returnedFrom, returnedTo, overdue } = readBackFilters(sp);
  // A value the filter does not offer (an edited link) is no filter, rather than a refused request.
  const receipt = receiptStateOf(sp.get('receipt') ?? '');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'assignedAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'assignedAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
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
  const pickReturnDay = (key: 'returnedFrom' | 'returnedTo', day: string): void =>
    patch(returnDayUpdates(openParam, key, day));
  const pickOverdue = (on: boolean): void => patch(overdueUpdates(openParam, on));
  const pickStatus = (value: string): void => patch(statusUpdates(value));
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      ...(openParam === 'all' ? {} : { open: openParam === 'true' }),
      branchId: branchId || undefined,
      employeeId: employeeId || undefined,
      search: search.trim() || undefined,
      categoryId: categoryId || undefined,
      assignedFrom: assignedFrom || undefined,
      assignedTo: assignedTo || undefined,
      overdue: overdue || undefined,
      returnedFrom: returnedFrom || undefined,
      returnedTo: returnedTo || undefined,
      receipt: receipt ?? undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItAssignments(params);

  // The chip's label. A pick supplies it — kept WITH the id it was picked for, so back/forward,
  // which changes the id underneath, makes the chip follow the URL rather than the last pick (the
  // asset list's rule). Arriving on a link or a remembered filter with only an id, the loaded rows
  // supply it; when no row names them — nothing matches, or HR has no name — the person is
  // resolved by id. The printed register's filter line reads the same label.
  const [pickedHolder, setPickedHolder] = useState({ id: '', label: '' });
  const pickedHere = pickedHolder.id === employeeId && pickedHolder.label !== '';
  const rowHolderName =
    (data?.items ?? []).find((a) => a.assignedToEmployeeId === employeeId)
      ?.assignedToEmployeeName ?? null;
  const holderPerson = useItPerson(employeeId, !pickedHere && rowHolderName === null);
  const holderLabel = pickedHere
    ? pickedHolder.label
    : (rowHolderName ??
      (holderPerson.data === undefined
        ? ''
        : `${holderPerson.data.fullNameAr} (${holderPerson.data.code})`));

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  // The category filter's names — for the printed line; the select reads the same cached list.
  const categories = useItCatalog('assetCategory');
  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of categories.data?.items ?? []) map.set(item.id, localized(item.name, locale));
    return map;
  }, [categories.data, locale]);

  const hasActiveFilters =
    openParam !== 'true' ||
    branchId !== '' ||
    employeeId !== '' ||
    search !== '' ||
    categoryId !== '' ||
    assignedFrom !== '' ||
    assignedTo !== '' ||
    overdue ||
    returnedFrom !== '' ||
    returnedTo !== '' ||
    receipt !== null;

  // ── The register as a file: Excel and PDF, of everything the filters match ──────────────────
  const exportContext = { t, locale, branchName };
  // Every interval the filters match, in the table's order — the table's own params, unpaged.
  const allRows = () => gatherRegister(params, api.listAssignments);
  const exportSheet = async (): Promise<void> => {
    const rows = await allRows();
    saveSheet({
      name: t('it.nav.custody'),
      serialHeader: t('it.export.serial'),
      header: custodyRegisterHeader(t),
      rows: rows.map((row) => custodyRegisterLine(row, exportContext, '')),
    });
  };
  const exportPdf = (): Promise<boolean> =>
    printItRegister(async () => {
      const rows = await allRows();
      const subtitle = custodyRegisterSubtitle(t, {
        ...custodyRegisterFilters({
          locale,
          openParam,
          branchId,
          branchName,
          employeeId,
          holderLabel,
          search,
          categoryId,
          categoryName,
          assignedFrom,
          assignedTo,
          overdue,
          returnedFrom,
          returnedTo,
          receipt: receipt ?? '',
          rows,
        }),
        asOf: formatDate(new Date().toISOString(), locale),
      });
      return custodyRegisterReport(rows, exportContext, subtitle);
    }, t('it.export.preparing'));

  /**
   * A date column's filter: «من» and «إلى» side by side under the column's name — on a phone too,
   * where the pair still fits one row and reads as the one window it is.
   */
  const dayWindowField = (
    label: string,
    from: string,
    to: string,
    onFrom: (day: string) => void,
    onTo: (day: string) => void,
  ): JSX.Element => (
    <FilterField label={label} active={from !== '' || to !== ''} className={cn(FIELD, 'sm:w-80')}>
      <div className="grid grid-cols-2 gap-2">
        <DayBound
          label={`${label} — ${t('it.custody.filters.from')}`}
          caption={t('it.custody.filters.from')}
          value={from}
          max={to}
          onChange={onFrom}
        />
        <DayBound
          label={`${label} — ${t('it.custody.filters.to')}`}
          caption={t('it.custody.filters.to')}
          value={to}
          min={from}
          onChange={onTo}
        />
      </div>
    </FilterField>
  );

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItAssetAssignmentDto>[] = [
    {
      // WHAT is out. The register is titled "what is out, and who has it" and never named the
      // first half: the asset could only be reached by navigating away from the row. Placed
      // first because it is the row's subject, not an attribute of it.
      key: 'asset',
      header: t('it.custody.asset'),
      render: (a) => (
        <button
          type="button"
          className="text-start hover:underline"
          onClick={() => navigate(`/it/assets/${a.assetId}`)}
        >
          <span className="flex flex-col leading-tight">
            <span>{a.assetName ?? t('it.custody.assetUnknown')}</span>
            {a.assetCode === null ? null : (
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {a.assetCode}
              </span>
            )}
          </span>
        </button>
      ),
    },
    {
      key: 'assignedAt',
      header: t('it.custody.assignedAt'),
      sortable: true,
      render: (a) => <span className="tabular-nums">{formatDate(a.assignedAt, locale)}</span>,
    },
    {
      key: 'holder',
      header: t('it.custody.holder'),
      // IT-6 joined the directory, so this reads as a person. When the lookup returns nothing —
      // no HR source, or a record since gone — it falls back to the id rather than inventing a
      // name: a reference the user can copy beats a guess.
      render: (a) =>
        a.assignedToEmployeeName === null ? (
          <span className="font-mono text-xs" dir="ltr">
            {a.assignedToEmployeeId}
          </span>
        ) : (
          <span className="flex flex-col leading-tight">
            <span>{a.assignedToEmployeeName}</span>
            {a.assignedToEmployeeCode === null ? null : (
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {a.assignedToEmployeeCode}
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (a) => branchName.get(a.branchId) ?? '—',
    },
    {
      key: 'expectedReturnAt',
      header: t('it.custody.expectedReturnAt'),
      sortable: true,
      render: (a) => {
        if (a.expectedReturnAt === null) return '—';
        const late = a.returnedAt === null && new Date(a.expectedReturnAt) < new Date();
        return (
          <span
            className={cn('tabular-nums', late && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(a.expectedReturnAt, locale)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      render: (a) => (
        <StatusBadge
          tone={a.returnedAt === null ? 'info' : 'neutral'}
          label={a.returnedAt === null ? t('it.custody.open') : t('it.custody.closed')}
        />
      ),
    },
    {
      key: 'returnedAt',
      header: t('it.custody.returnedAt'),
      sortable: true,
      render: (a) =>
        a.returnedAt === null ? (
          '—'
        ) : (
          <span className="tabular-nums">{formatDate(a.returnedAt, locale)}</span>
        ),
    },
    {
      // FR-18 — the paper the holder signed: print it again, file or view the signed copy.
      key: 'receipt',
      header: t('it.custody.receipt.column'),
      render: (a) => <CustodyReceiptActions assignment={a} />,
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (a) => (
        <button
          type="button"
          className={actionButton}
          aria-label={t('it.custody.openAsset')}
          title={t('it.custody.openAsset')}
          onClick={() => navigate(`/it/assets/${a.assetId}`)}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.custody')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.custody') }]}
        actions={
          <>
            {/* «عايز الزرارين قبل مش بعد زرار الـ Action بتاع الفورم» — the files first, the
                hand-over after them. Not offered when the list failed: the file behind them
                would be empty or short. */}
            {!isError && (
              <RegisterExportButtons name="it-custody" onExcel={exportSheet} onPdf={exportPdf} />
            )}
            {can('itAsset.assign') && (
              <Button
                size="sm"
                leftIcon={<UsersIcon className="h-4 w-4" />}
                onClick={() => setHandingOver(true)}
              >
                {t('it.custody.receipt.title')}
              </Button>
            )}
          </>
        }
      />
      <AssignAssetDialog open={handingOver} onClose={() => setHandingOver(false)} asset={null} />

      <div className="space-y-4">
        {/* The table's columns, in the table's order, each under the column's name. «الصنف» and
            its category are facts of the asset, the rest of the interval; the server reads each
            set a filter names once (`assignment.service`). */}
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => {
            setPickedHolder({ id: '', label: '' });
            patch({
              open: null,
              branch: null,
              employee: null,
              q: null,
              category: null,
              assignedFrom: null,
              assignedTo: null,
              overdue: null,
              returnedFrom: null,
              returnedTo: null,
              receipt: null,
            });
          }}
        >
          <FilterField
            label={t('it.custody.asset')}
            active={search.trim() !== ''}
            className={cn(FIELD, 'sm:w-64')}
          >
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('it.custody.searchPlaceholder')}
              className="w-full"
            />
          </FilterField>
          <FilterField
            label={t('it.assets.columns.category')}
            active={categoryId !== ''}
            className={cn(FIELD, 'sm:w-44')}
          >
            <ItCatalogSelect
              kind="assetCategory"
              value={categoryId}
              onChange={(id) => patch({ category: id || null })}
              allLabel={t('it.assets.allCategories')}
              ariaLabel={t('it.assets.columns.category')}
              className="w-full"
            />
          </FilterField>
          {dayWindowField(
            t('it.custody.assignedAt'),
            assignedFrom,
            assignedTo,
            (day) => patch({ assignedFrom: day || null }),
            (day) => patch({ assignedTo: day || null }),
          )}
          {/* The holder filter searches the server (ADR-019) — the browser never holds the staff
              list. The id goes in the URL so a filtered register can be linked and shared. It
              finds the people who have LEFT as well: their intervals are still in this register,
              and «who left with a laptop» is one of the questions it exists to answer. */}
          <FilterField
            label={t('it.custody.holder')}
            active={employeeId !== ''}
            className={cn(FIELD, 'sm:w-64')}
          >
            <EmployeePicker
              includeExited
              value={employeeId}
              valueLabel={holderLabel}
              ariaLabel={t('it.custody.filterHolder')}
              onChange={(id, label) => {
                setPickedHolder({ id, label });
                patch({ employee: id || null });
              }}
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
          {/* «موعد الإعادة» asks one thing of a date: has it passed while the asset is still out —
              the column's own red. */}
          <FilterField
            label={t('it.custody.expectedReturnAt')}
            active={overdue}
            className={cn(FIELD, 'sm:w-48')}
          >
            <Select
              aria-label={t('it.custody.expectedReturnAt')}
              value={overdue ? 'true' : ''}
              onChange={(e) => pickOverdue(e.target.value === 'true')}
            >
              <option value="">{t('it.custody.filterAll')}</option>
              <option value="true">{t('it.custody.filters.overdue')}</option>
            </Select>
          </FilterField>
          <FilterField
            label={t('it.assets.columns.status')}
            active={openParam !== 'true'}
            className={cn(FIELD, 'sm:w-44')}
          >
            <Select
              aria-label={t('it.assets.columns.status')}
              value={openParam}
              onChange={(e) => pickStatus(e.target.value)}
            >
              <option value="true">{t('it.custody.filterOpen')}</option>
              <option value="false">{t('it.custody.filterClosed')}</option>
              <option value="all">{t('it.custody.filterAll')}</option>
            </Select>
          </FilterField>
          {dayWindowField(
            t('it.custody.returnedAt'),
            returnedFrom,
            returnedTo,
            (day) => pickReturnDay('returnedFrom', day),
            (day) => pickReturnDay('returnedTo', day),
          )}
          {/* The receipt column's own words: signed, awaiting the signature — or no paper at all,
              an interval handed over before receipts existed. */}
          <FilterField
            label={t('it.custody.receipt.column')}
            active={receipt !== null}
            className={cn(FIELD, 'sm:w-44')}
          >
            <Select
              aria-label={t('it.custody.receipt.column')}
              value={receipt ?? ''}
              onChange={(e) => patch({ receipt: e.target.value || null })}
            >
              <option value="">{t('it.custody.filterAll')}</option>
              <option value="signed">{t('it.custody.receipt.signed')}</option>
              <option value="unsigned">{t('it.custody.receipt.awaitingSignature')}</option>
              <option value="none">{t('it.custody.receipt.none')}</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
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
