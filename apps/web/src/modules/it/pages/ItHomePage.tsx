// The `/it` home — the IT dashboard (design §11). «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل
// اللى موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop
// Down بـ Multiselection · وشوف إيه تانى ممكن يتعمل بس وريني Sample الأول بتاع UI» — the sample was
// shown and approved («ماشى تمام كمل»), and this is it, in the app's own components and in its
// order: the filters, the five counts, the status split, by category and by branch, «يحتاج متابعة»
// and «آخر الحركات», the lines and the consumables at their minimum, then the help desk's counts
// and the IT pages.
//
// EVERY NUMBER IS THE SERVER'S. The asset figures are counted by `GET /it/dashboard/assets` under
// the reader's data scope — a branch-scoped reader sees their branch's — and never tallied from a
// page of rows here. Every figure opens the list it counts, under the same filters
// (`lib/it-dashboard.ts`), so none of them has to be taken on trust.
//
// EVERY PANEL RIDES ITS OWN GRANT. The asset panels, the lines and the consumables ride
// `itAsset.view`, the help desk's counts `itTicket.view`; a query never fires for a panel the reader
// may not see, a reader with some grants sees only those panels, and a reader with none gets one
// honest empty state instead of a wall of errors. A count that FAILED says so; it never reads as 0.
//
// THE FILTERS are the asset register's own params — `category` (several, comma-joined) and `branch`
// (one) — remembered across visits like every register's.
//
// No sentence under the title, though the sample had one: a page header carries no subtitle, by the
// owner's standing decision (`page-header-has-no-subtitle.spec.ts`). What it said — which categories
// and branch the figures are of — is written where it is read: on «إجمالي الأصول» and over the split.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IT_MOBILE_LINE_STATUSES,
  IT_MOBILE_NETWORKS,
  type ItAssetStatus,
  type ItAssetStatusCountsDto,
  type ItDashboardActivityItemDto,
  type ItDashboardAssetsDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { StatCard, type StatCardTone } from '../../../shared/ui/StatCard';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { FilterField } from '../../../shared/ui/FilterField';
import { filterResetTone } from '../../../shared/ui/FilterBar';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import {
  AlertIcon,
  BadgeIcon,
  CalendarIcon,
  ChatIcon,
  ClipboardIcon,
  CogIcon,
  FolderIcon,
  GridIcon,
  InboxIcon,
  LayersIcon,
  MonitorIcon,
  PhoneIcon,
  QrIcon,
  TagIcon,
  TrashIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDateTime, formatNumber, localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import {
  useItBranchOptions,
  useItCatalog,
  useItConsumables,
  useItDashboardActivity,
  useItDashboardAssets,
  useItMobileLinesSummary,
  useItTickets,
} from '../api/it-queries';
import { ItCatalogMultiSelect } from '../components/ItCatalogMultiSelect';
import { MobileNetworkLogo } from '../components/MobileNetworkLogo';
import { ASSET_EVENT_TONE } from '../components/AssetHistoryList';
import { capList, readCategoryIds, writeCategoryIds } from '../lib/category-name-filter';
import {
  DASHBOARD_STATUSES,
  STATUS_FILL,
  assetsLink,
  consumablesLink,
  custodyLink,
  dashboardQuery,
  largestFirst,
  mobileLinesLink,
  pickBranch,
  share,
  toggleCategory,
  warrantyLink,
  type DashboardFilters,
} from '../lib/it-dashboard';
import { warrantyWithin } from '../lib/warranty-window';

/** Remembered across visits: the dashboard's two filters, under the asset register's own names. */
const REMEMBERED_FILTERS = ['branch', 'category'] as const;

/** How many consumables at their minimum the panel lists — «a few rows», the rest one link away. */
const CONSUMABLE_ROWS = 5;

type Translate = ReturnType<typeof useT>;

/** Id → name lookups for the panels, with the printed register's fallback for a name not had. */
interface Names {
  category: (id: string) => string;
  branch: (id: string) => string;
}

/** A dashboard panel: a card with its question as the title, and where it leads at its end. */
const Panel = ({
  title,
  hint,
  action,
  className,
  children,
}: {
  title: string;
  hint?: string;
  action?: JSX.Element;
  className?: string;
  children: JSX.Element;
}): JSX.Element => (
  <Card className={cn('flex h-full min-w-0 flex-col', className)}>
    <CardHeader
      title={title}
      {...(hint === undefined ? {} : { description: hint })}
      {...(action === undefined ? {} : { actions: action })}
    />
    <CardBody className="min-w-0 flex-1">{children}</CardBody>
  </Card>
);

/** Rows on their way: the panel keeps its shape rather than collapsing and jumping back. */
const PendingRows = ({ rows = 3 }: { rows?: number }): JSX.Element => (
  <div className="space-y-3">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

/** A link at a panel's end — «عرض الكل». */
const PanelLink = ({ to, children }: { to: string; children: string }): JSX.Element => (
  <Link to={to} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
    {children}
  </Link>
);

/** A query as a panel reads it. */
interface PanelQuery<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** The panel's body by the state of its query: waiting, failed (with a retry), or its rows. */
const byState = <T,>(query: PanelQuery<T>, rows: (data: T) => JSX.Element): JSX.Element => {
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data === undefined) return <PendingRows />;
  return rows(query.data);
};

/** The icon and the tile colour each count wears — the sample's, the split's below it. */
const KPI_LOOK: Record<ItAssetStatus, { icon: typeof MonitorIcon; tone: StatCardTone }> = {
  inStock: { icon: InboxIcon, tone: 'success' },
  assigned: { icon: UsersIcon, tone: 'brand' },
  underMaintenance: { icon: WrenchIcon, tone: 'warning' },
  disposed: { icon: TrashIcon, tone: 'neutral' },
};

/** «٤٢٪» — the share in the reader's digits. */
const percent = (t: Translate, locale: Locale, part: number, total: number): string =>
  t('it.dashboard.percent', { value: formatNumber(share(part, total), locale) });

// ── The filters ──────────────────────────────────────────────────────────────

const DashboardFilterBar = ({
  categoryIds,
  branchId,
  onCategories,
  onBranch,
  onClear,
}: {
  categoryIds: readonly string[];
  branchId: string;
  onCategories: (ids: string[]) => void;
  onBranch: (id: string) => void;
  onClear: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const options = branches.data ?? [];
  // A branch the link or the remembered view names that the options do not hold (closed, or not
  // loaded yet) stays visible as «فرع محدد» — the box must not read «كل الفروع» while it narrows.
  const unlisted = branchId !== '' && !options.some((branch) => branch.id === branchId);
  const filtered = categoryIds.length > 0 || branchId !== '';
  return (
    <div className="flex flex-wrap items-end justify-end gap-3">
      {/* «أقدر أفلتر بـالفئة.. من خلال Drop Down بـ Multiselection» — the asset list's own control. */}
      <FilterField
        label={t('it.assets.columns.category')}
        active={categoryIds.length > 0}
        className="w-full sm:w-64"
      >
        <ItCatalogMultiSelect
          kind="assetCategory"
          label={t('it.assets.columns.category')}
          placeholder={t('it.assets.allCategories')}
          value={categoryIds}
          onChange={onCategories}
          fullWidth
          className="w-full"
        />
      </FilterField>
      <FilterField
        label={t('it.assets.columns.branch')}
        active={branchId !== ''}
        className="w-full sm:w-48"
      >
        <Select
          aria-label={t('it.assets.columns.branch')}
          value={branchId}
          onChange={(e) => onBranch(e.target.value)}
        >
          <option value="">{t('it.assets.allBranches')}</option>
          {options.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {localized(branch.name, locale)}
            </option>
          ))}
          {unlisted && <option value={branchId}>{t('it.export.oneBranch')}</option>}
        </Select>
      </FilterField>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className={cn(
            'inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2',
            filterResetTone('red'),
          )}
        >
          {t('it.dashboard.clearFilters')}
        </button>
      )}
    </div>
  );
};

// ── The asset panels ─────────────────────────────────────────────────────────

/** «في المخزن ٣٠ · مُسلَّم ١٢ …» as a bar — each state's part of `max`, in the split's colours. */
const StatusBar = ({
  counts,
  max,
  height,
  t,
  locale,
}: {
  counts: ItAssetStatusCountsDto;
  max: number;
  height: string;
  t: Translate;
  locale: Locale;
}): JSX.Element => (
  <span
    className={cn('flex overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', height)}
    aria-hidden="true"
  >
    {DASHBOARD_STATUSES.map((status) =>
      counts[status] === 0 ? null : (
        <span
          key={status}
          data-segment={status}
          title={`${t(`it.assets.status.${status}`)}: ${formatNumber(counts[status], locale)}`}
          className={cn('block h-full', STATUS_FILL[status])}
          // A width is the one thing a class cannot say: it is the figure itself.
          style={{ width: `${max <= 0 ? 0 : (counts[status] * 100) / max}%` }}
        />
      ),
    )}
  </span>
);

const AssetDashboard = ({
  filters,
  onToggleCategory,
  onPickBranch,
}: {
  filters: DashboardFilters;
  onToggleCategory: (categoryId: string) => void;
  onPickBranch: (branchId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { categoryIds, branchId } = filters;
  const query = useMemo(() => dashboardQuery(filters), [filters]);
  const assets = useItDashboardAssets(query);
  const activity = useItDashboardActivity(query);
  // The lines carry no category; the branch narrows them as it narrows everything else here.
  const lines = useItMobileLinesSummary(branchId === '' ? {} : { branchId });
  const consumables = useItConsumables({
    pageSize: CONSUMABLE_ROWS,
    belowMin: true,
    active: true,
    sortBy: 'onHandQty',
    sortDir: 'asc',
    ...(branchId === '' ? {} : { branchId }),
  });

  const categories = useItCatalog('assetCategory');
  const branches = useItBranchOptions();
  const categoryName = useMemo(
    () =>
      new Map(
        (categories.data?.items ?? []).map((item) => [item.id, localized(item.name, locale)]),
      ),
    [categories.data, locale],
  );
  const branchName = useMemo(
    () => new Map((branches.data ?? []).map((unit) => [unit.id, localized(unit.name, locale)])),
    [branches.data, locale],
  );
  // A category or branch the lists do not hold (archived, closed, not loaded yet) is still said
  // to be one — «فئة محددة» / «فرع محدد», the printed registers' words — never shown as an id.
  const names: Names = {
    category: (id) => categoryName.get(id) ?? t('it.export.oneCategory'),
    branch: (id) => branchName.get(id) ?? t('it.export.oneBranch'),
  };

  // What the figures are OF — «كل الفئات · كل الفروع», or the categories and branch chosen.
  const scopeLine = [
    categoryIds.length === 0
      ? t('it.assets.allCategories')
      : categoryIds.map((id) => names.category(id)).join('، '),
    branchId === '' ? t('it.assets.allBranches') : names.branch(branchId),
  ].join(' · ');

  const totals = assets.data?.totals;
  /** A count tile: loading, failed (said, never a 0), or the figure and its share of the whole. */
  const kpi = (
    count: number | undefined,
    caption: string,
  ): { value?: string; caption?: string; loading: boolean } => {
    if (assets.isError && totals === undefined) {
      return { caption: t('it.overview.countUnavailable'), loading: false };
    }
    if (count === undefined) return { loading: true };
    return { value: formatNumber(count, locale), caption, loading: false };
  };

  return (
    <div className="space-y-6" aria-busy={assets.isFetching}>
      {/* «يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم» — and the two states between. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" data-kpis="">
        <StatCard
          label={t('it.dashboard.totalAssets')}
          icon={MonitorIcon}
          tone="brand"
          to={assetsLink(filters, null)}
          {...kpi(totals?.total, scopeLine)}
        />
        {DASHBOARD_STATUSES.map((status) => (
          <StatCard
            key={status}
            label={t(`it.assets.status.${status}`)}
            icon={KPI_LOOK[status].icon}
            tone={KPI_LOOK[status].tone}
            to={assetsLink(filters, status)}
            {...kpi(
              totals?.[status],
              totals === undefined
                ? ''
                : t('it.dashboard.ofTotal', {
                    share: percent(t, locale, totals[status], totals.total),
                  }),
            )}
          />
        ))}
      </div>

      {/* What the split is of, under its name — where several categories can wrap on a phone. */}
      <Panel title={t('it.dashboard.statusSplit')} hint={scopeLine}>
        {byState(assets, (data) => (
          <div className="space-y-3" data-status-split="">
            <StatusBar
              counts={data.totals}
              max={data.totals.total}
              height="h-4"
              t={t}
              locale={locale}
            />
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {DASHBOARD_STATUSES.map((status) => (
                <li key={status} className="flex items-center gap-2" data-legend={status}>
                  <span
                    className={cn('h-3 w-3 shrink-0 rounded-sm', STATUS_FILL[status])}
                    aria-hidden="true"
                  />
                  <span className="text-slate-700 dark:text-slate-300">
                    {t(`it.assets.status.${status}`)}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(data.totals[status], locale)}
                  </span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">
                    ({percent(t, locale, data.totals[status], data.totals.total)})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('it.dashboard.byCategory.title')} hint={t('it.dashboard.byCategory.hint')}>
          {byState(assets, (data) => (
            <CategoryRows
              rows={data.byCategory}
              chosen={categoryIds}
              names={names}
              onToggle={onToggleCategory}
            />
          ))}
        </Panel>
        <Panel title={t('it.dashboard.byBranch.title')} hint={t('it.dashboard.byBranch.hint')}>
          {byState(assets, (data) => (
            <BranchTable
              rows={data.byBranch}
              chosen={branchId}
              names={names}
              onPick={onPickBranch}
            />
          ))}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('it.dashboard.attention.title')}>
          {byState(assets, (data) => (
            <AttentionRows attention={data.attention} filters={filters} />
          ))}
        </Panel>
        <Panel title={t('it.dashboard.activity.title')}>
          {byState(activity, (data) => (
            <ActivityRows items={data.items} names={names} />
          ))}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={t('it.nav.mobileLines')}
          action={<PanelLink to={mobileLinesLink(branchId)}>{t('it.dashboard.viewAll')}</PanelLink>}
        >
          {byState(lines, (data) => {
            const byNetwork = new Map(data.networks.map((entry) => [entry.network, entry]));
            return (
              <div className="grid gap-3 sm:grid-cols-3">
                {IT_MOBILE_NETWORKS.map((network) => {
                  const figures = byNetwork.get(network);
                  return (
                    <div
                      key={network}
                      data-line-network={network}
                      className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        {/* The logos the lines page wears — the network's name beside its mark. */}
                        <MobileNetworkLogo network={network} decorative />
                        <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {t(`it.mobileLines.network.${network}`)}
                        </span>
                      </span>
                      <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatNumber(figures?.total ?? 0, locale)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {IT_MOBILE_LINE_STATUSES.map(
                          (status) =>
                            `${t(`it.mobileLines.status.${status}`)} ${formatNumber(figures?.[status] ?? 0, locale)}`,
                        ).join(' · ')}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Panel>
        <Panel
          title={t('it.dashboard.consumables.title')}
          action={
            <PanelLink to={consumablesLink(branchId)}>
              {consumables.data === undefined || consumables.data.meta.totalItems === 0
                ? t('it.dashboard.viewAll')
                : t('it.dashboard.viewAllCount', {
                    count: formatNumber(consumables.data.meta.totalItems, locale),
                  })}
            </PanelLink>
          }
        >
          {byState(consumables, (data) =>
            data.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('it.dashboard.consumables.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    data-consumable={item.code}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                  >
                    <span
                      className="min-w-[5rem] font-mono text-xs text-slate-500 dark:text-slate-400"
                      dir="ltr"
                    >
                      {item.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {item.name}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                      {t('it.consumables.columns.onHand')} {formatNumber(item.onHandQty, locale)}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {t('it.consumables.columns.minQty')} {formatNumber(item.minQty, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          )}
        </Panel>
      </div>
    </div>
  );
};

/**
 * «حسب الفئة» — every category the reader's assets fall in, under the BRANCH only, so the ones not
 * chosen stand (dimmed) beside the chosen. A click adds the category to the filter, or takes it out.
 */
const CategoryRows = ({
  rows,
  chosen,
  names,
  onToggle,
}: {
  rows: ItDashboardAssetsDto['byCategory'];
  chosen: readonly string[];
  names: Names;
  onToggle: (categoryId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('it.dashboard.noAssets')}
      </p>
    );
  }
  const sorted = largestFirst(rows, (row) => names.category(row.categoryId));
  // Every bar against the largest category, so the rows compare with each other at a glance.
  const max = Math.max(1, ...sorted.map((row) => row.total));
  return (
    <div className="space-y-2">
      {sorted.map((row) => {
        const picked = chosen.includes(row.categoryId);
        const inView = chosen.length === 0 || picked;
        return (
          <button
            key={row.categoryId}
            type="button"
            data-category-row={row.categoryId}
            aria-pressed={picked}
            onClick={() => onToggle(row.categoryId)}
            className={cn(
              'flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              picked
                ? 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40'
                : 'border-slate-100 hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700',
              !inView && 'opacity-50',
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {names.category(row.categoryId)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {t('it.dashboard.byCategory.detail', {
                  total: formatNumber(row.total, locale),
                  inStock: formatNumber(row.inStock, locale),
                  assigned: formatNumber(row.assigned, locale),
                })}
              </span>
            </span>
            <StatusBar counts={row} max={max} height="h-2.5" t={t} locale={locale} />
          </button>
        );
      })}
    </div>
  );
};

/**
 * «حسب الفرع» — every branch the reader's assets are in, under the CATEGORIES only. A click on a
 * branch shows it alone; a click on the branch shown clears it. The table scrolls in its own box on
 * a phone, never the page.
 */
const BranchTable = ({
  rows,
  chosen,
  names,
  onPick,
}: {
  rows: ItDashboardAssetsDto['byBranch'];
  chosen: string;
  names: Names;
  onPick: (branchId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('it.dashboard.noAssets')}
      </p>
    );
  }
  const sorted = largestFirst(rows, (row) => names.branch(row.branchId));
  const head = 'px-2 py-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
  const cell = 'px-2 py-2 tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className={head}>{t('it.assets.columns.branch')}</th>
            <th className={head}>{t('it.dashboard.byBranch.total')}</th>
            <th className={head}>{t('it.assets.status.inStock')}</th>
            <th className={head}>{t('it.assets.status.assigned')}</th>
            <th className={cn(head, 'w-1/3')}>{t('it.dashboard.byBranch.assignedShare')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const picked = chosen === row.branchId;
            const handedOver = share(row.assigned, row.total);
            return (
              <tr
                key={row.branchId}
                data-branch-row={row.branchId}
                className={cn(
                  'border-b border-slate-100 last:border-0 dark:border-slate-800',
                  picked && 'bg-brand-50 dark:bg-brand-950/40',
                  chosen !== '' && !picked && 'opacity-50',
                )}
              >
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-pressed={picked}
                    onClick={() => onPick(row.branchId)}
                    className="text-start font-medium text-slate-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-100"
                  >
                    {names.branch(row.branchId)}
                  </button>
                </td>
                <td className={cn(cell, 'font-semibold text-slate-900 dark:text-white')}>
                  {formatNumber(row.total, locale)}
                </td>
                <td className={cn(cell, 'text-emerald-700 dark:text-emerald-300')}>
                  {formatNumber(row.inStock, locale)}
                </td>
                <td className={cn(cell, 'text-brand-700 dark:text-brand-300')}>
                  {formatNumber(row.assigned, locale)}
                </td>
                <td className={cell}>
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-2 flex-1 overflow-hidden rounded-full bg-brand-50 dark:bg-brand-950"
                      aria-hidden="true"
                    >
                      <span
                        className={cn('block h-full', STATUS_FILL.assigned)}
                        style={{ width: `${handedOver}%` }}
                      />
                    </span>
                    <span className="min-w-[2.5rem] text-xs text-slate-500 dark:text-slate-400">
                      {t('it.dashboard.percent', { value: formatNumber(handedOver, locale) })}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * «يحتاج متابعة» — the four counts that ask somebody to act, each opening its list under the same
 * filters: the custody register for the first three, the asset list for the warranties.
 */
const AttentionRows = ({
  attention,
  filters,
}: {
  attention: ItDashboardAssetsDto['attention'];
  filters: DashboardFilters;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const rows = [
    {
      key: 'heldByLeavers',
      count: attention.heldByLeavers,
      label: t('it.dashboard.attention.heldByLeavers'),
      hint: t('it.dashboard.attention.heldByLeaversHint'),
      to: custodyLink(filters, 'heldByLeavers'),
      dot: 'bg-red-500 dark:bg-red-400',
    },
    {
      key: 'receiptsAwaitingSignature',
      count: attention.receiptsAwaitingSignature,
      label: t('it.dashboard.attention.receiptsAwaitingSignature'),
      hint: t('it.dashboard.attention.receiptsAwaitingSignatureHint'),
      to: custodyLink(filters, 'receiptsAwaitingSignature'),
      dot: 'bg-amber-500 dark:bg-amber-400',
    },
    {
      key: 'overdueReturns',
      count: attention.overdueReturns,
      label: t('it.dashboard.attention.overdueReturns'),
      hint: t('it.dashboard.attention.overdueReturnsHint'),
      to: custodyLink(filters, 'overdueReturns'),
      dot: 'bg-amber-500 dark:bg-amber-400',
    },
    // `it.warrantyWarnDays` = 0 switches the early warning off: no window, so no row to open.
    ...(attention.warrantyWindowDays === 0
      ? []
      : [
          {
            key: 'warrantyEndingSoon',
            count: attention.warrantyEndingSoon,
            // The window is the `it.warrantyWarnDays` setting the server read, not a number of ours.
            label: t('it.dashboard.attention.warranty', {
              within: warrantyWithin(t, locale, attention.warrantyWindowDays),
            }),
            hint: t('it.dashboard.attention.warrantyHint'),
            to: warrantyLink(filters, attention.warrantyWindowDays),
            dot: 'bg-brand-500 dark:bg-brand-400',
          },
        ]),
  ];
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => (
        <li key={row.key} data-attention={row.key} className="flex items-center gap-3 py-2.5">
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              // Nothing to follow up is not an alarm: the dot goes quiet.
              row.count === 0 ? 'bg-slate-300 dark:bg-slate-600' : row.dot,
            )}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {row.label}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{row.hint}</span>
          </span>
          <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(row.count, locale)}
          </span>
          <Link
            to={row.to}
            aria-label={`${t('it.dashboard.attention.open')} — ${row.label}`}
            className="shrink-0 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            {t('it.dashboard.attention.open')}
          </Link>
        </li>
      ))}
    </ul>
  );
};

/** One movement's second line: who it went to or came from, and where. */
/**
 * What a movement line says beneath the asset — only what the movement itself recorded: the person
 * it went to or came from, and a branch only where it moved between two. An asset's CURRENT branch
 * is not where an older hand-over or its registration happened, so it is never printed as that.
 */
const activityDetail = (
  t: Translate,
  item: ItDashboardActivityItemDto,
  names: Names,
): string | null => {
  // HR's name for the person, else their code — never a guessed name.
  const person = item.employeeName ?? item.employeeCode;
  switch (item.kind) {
    case 'assigned':
      return person === null ? null : t('it.dashboard.activity.to', { name: person });
    case 'returned':
      return person === null ? null : t('it.dashboard.activity.from', { name: person });
    case 'transferred': {
      const parts = [
        ...(person === null ? [] : [t('it.dashboard.activity.to', { name: person })]),
        ...(item.fromBranchId === null || item.toBranchId === null
          ? []
          : [
              t('it.dashboard.activity.move', {
                from: names.branch(item.fromBranchId),
                to: names.branch(item.toBranchId),
              }),
            ]),
      ];
      return parts.length === 0 ? null : parts.join(' — ');
    }
    default:
      return null;
  }
};

/** «آخر الحركات» — the newest movements, each linking to its asset. */
const ActivityRows = ({
  items,
  names,
}: {
  items: ItDashboardActivityItemDto[];
  names: Names;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('it.dashboard.activity.empty')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item) => (
        <li key={item.id} data-activity={item.kind} className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5 shrink-0">
            <Badge tone={ASSET_EVENT_TONE[item.kind] ?? 'neutral'} size="sm">
              {t(`it.custody.event.${item.kind}`)}
            </Badge>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              to={`/it/assets/${item.assetId}`}
              className="truncate text-sm text-slate-800 hover:underline dark:text-slate-100"
            >
              <span className="font-mono text-xs font-semibold" dir="ltr">
                {item.assetCode}
              </span>{' '}
              · {item.assetName}
            </Link>
            {activityDetail(t, item, names) !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {activityDetail(t, item, names)}
              </span>
            )}
          </span>
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatDateTime(item.at, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
};

// ── The help desk ────────────────────────────────────────────────────────────

/**
 * The help desk's two counts the home always showed. Both ride the SERVER's own filters — `active`
 * is the lifecycle split and `breached` reads the STAMPS, so neither is a clock this page recomputed
 * (FR-6). Under the `own` scope these are honestly the caller's own tickets.
 */
const HelpDeskCounts = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // pageSize 1 — only `meta.totalItems` is wanted.
  const active = useItTickets({ pageSize: 1, active: true });
  const breached = useItTickets({ pageSize: 1, breached: true, active: true });
  const tile = (query: typeof active): { value?: string; caption?: string; loading: boolean } => {
    if (query.isError) return { caption: t('it.overview.countUnavailable'), loading: false };
    const total = query.data?.meta.totalItems;
    return {
      ...(total === undefined ? {} : { value: formatNumber(total, locale) }),
      loading: query.isPending,
    };
  };
  return (
    <section className="space-y-3" data-help-desk="">
      <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
        {t('it.nav.tickets')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('it.overview.activeTickets')}
          icon={InboxIcon}
          to="/it/tickets?active=true"
          {...tile(active)}
        />
        <StatCard
          label={t('it.overview.breachedTickets')}
          icon={AlertIcon}
          tone="warning"
          to="/it/tickets?view=breached&active=true"
          {...tile(breached)}
        />
      </div>
    </section>
  );
};

// ── The page ─────────────────────────────────────────────────────────────────

export const ItHomePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const canAssets = can('itAsset.view');
  const canVendors = can('itVendor.view');
  const canCatalogs = can('itCatalog.manage');
  const canTickets = can('itTicket.view');
  const canSla = can('itSlaPolicy.manage');
  const canMaintenance = can('itMaintenance.view');
  const canSpareParts = can('itSparePart.view');
  const canSoftware = can('itSoftware.view');
  const canLicenses = can('itLicense.view');
  // «فحص أجهزة السيارات» — the reports the phone form files, read on their own view grant.
  const canVehicleChecks = can('itVehicleCheck.view');
  // Every grant that opens at least one panel or page below. A viewer holding only
  // `itSoftware.view` has a screen to reach, so leaving them on «no access» would be a lie.
  const anything =
    canAssets ||
    canVendors ||
    canCatalogs ||
    canTickets ||
    canSla ||
    canMaintenance ||
    canSpareParts ||
    canSoftware ||
    canLicenses ||
    canVehicleChecks;

  // «الفئة» (several) and «الفرع» (one), under the asset register's own names.
  const categoryIds = useMemo(() => readCategoryIds(sp.get('category')), [sp]);
  const branchId = sp.get('branch') ?? '';
  const filters = useMemo(() => ({ categoryIds, branchId }), [categoryIds, branchId]);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next);
  };
  const setCategories = (ids: readonly string[]): void =>
    patch({ category: writeCategoryIds(capList(ids)) || null });

  /** The IT pages, by grant — the old home's cards, compact, at the foot. */
  const pages: { to: string; label: string; icon: typeof MonitorIcon }[] = [
    ...(canAssets
      ? [
          { to: '/it/assets', label: t('it.nav.assets'), icon: MonitorIcon },
          { to: '/it/custody', label: t('it.nav.custody'), icon: ClipboardIcon },
          { to: '/it/assets/scan', label: t('it.nav.scan'), icon: QrIcon },
          { to: '/it/employees', label: t('it.nav.employees'), icon: UsersIcon },
          // The SIM lines and the consumables ride the assets' grants, so they sit with them.
          { to: '/it/mobile-lines', label: t('it.nav.mobileLines'), icon: PhoneIcon },
          { to: '/it/consumables', label: t('it.nav.consumables'), icon: InboxIcon },
        ]
      : []),
    ...(canTickets ? [{ to: '/it/tickets', label: t('it.nav.tickets'), icon: ChatIcon }] : []),
    ...(canMaintenance
      ? [
          { to: '/it/maintenance', label: t('it.nav.maintenance'), icon: WrenchIcon },
          { to: '/it/maintenance-plans', label: t('it.nav.maintenancePlans'), icon: CalendarIcon },
        ]
      : []),
    ...(canSpareParts
      ? [{ to: '/it/spare-parts', label: t('it.nav.spareParts'), icon: LayersIcon }]
      : []),
    ...(canSoftware ? [{ to: '/it/software', label: t('it.nav.software'), icon: GridIcon }] : []),
    ...(canLicenses ? [{ to: '/it/licenses', label: t('it.nav.licenses'), icon: BadgeIcon }] : []),
    ...(canVehicleChecks
      ? [{ to: '/it/vehicle-checks', label: t('it.vehicleChecks.title'), icon: TruckIcon }]
      : []),
    ...(canVendors ? [{ to: '/it/vendors', label: t('it.nav.vendors'), icon: FolderIcon }] : []),
    ...(canCatalogs ? [{ to: '/it/catalogs', label: t('it.nav.catalogs'), icon: TagIcon }] : []),
    ...(canSla
      ? [{ to: '/it/helpdesk-settings', label: t('it.nav.helpDeskSettings'), icon: CogIcon }]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.dashboard.title')}
        // The filters on the title's line, as the sample has them — they narrow the asset panels
        // only, so they are offered only to a reader who sees those.
        {...(canAssets
          ? {
              toolbar: (
                <DashboardFilterBar
                  categoryIds={categoryIds}
                  branchId={branchId}
                  onCategories={setCategories}
                  onBranch={(id) => patch({ branch: id || null })}
                  onClear={() => patch({ category: null, branch: null })}
                />
              ),
            }
          : {})}
      />

      {!anything ? (
        <EmptyState
          title={t('it.overview.noAccessTitle')}
          description={t('it.overview.noAccessBody')}
        />
      ) : (
        <div className="space-y-6">
          {canAssets && (
            <AssetDashboard
              filters={filters}
              onToggleCategory={(id) => setCategories(toggleCategory(categoryIds, id))}
              onPickBranch={(id) => patch({ branch: pickBranch(branchId, id) || null })}
            />
          )}

          {canTickets && <HelpDeskCounts />}

          {pages.length > 0 && (
            <nav className="space-y-3" aria-label={t('it.dashboard.pages')} data-pages="">
              <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {t('it.dashboard.pages')}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {pages.map((page) => (
                  <li key={page.to}>
                    <Link
                      to={page.to}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-card transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:text-brand-300"
                    >
                      <page.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {page.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}
    </PageContainer>
  );
};
