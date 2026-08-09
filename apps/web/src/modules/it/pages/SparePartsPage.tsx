// The IT store (design §2.7, ADR-024) — the parts catalogue, their levels, and the ledger behind
// each level.
//
// **There is no "consume" button on this screen, and that is the design (FR-9).** Stock leaves the
// store only through a maintenance order's completion, so the only write here is a receipt. A
// button that issued parts without an order would break the one question the ledger exists to
// answer: which repair used them.
//
// `onHandQty` is DENORMALIZED from the movements by the same atomic write, so the number in this
// table and the rows in the drawer can never disagree.
import { useMemo, useState } from 'react';
import { type ItSparePartDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { EditIcon, LayersIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDateTime, formatNumber } from '../../../shared/lib/format';
import { Dialog } from '../../../shared/ui/Dialog';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { useItSparePartMovements, useItSpareParts } from '../api/it-queries';
import { ReceiveStockDialog, SparePartDialog } from '../components/SparePartDialogs';

const DEFAULT_PAGE_SIZE = 25;

/** The ledger for one part, newest first. Read-only: a movement is never edited (ADR-024). */
const MovementsPanel = ({ part }: { part: ItSparePartDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isPending } = useItSparePartMovements(part.id, { pageSize: 50, sortBy: 'at', sortDir: 'desc' });

  if (isPending) return <Skeleton className="h-40 w-full" />;
  const rows = data?.items ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.parts.noMovements')}</p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((movement) => (
        <li key={movement.id} className="py-2">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`font-mono text-sm ${
                movement.qty > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
              dir="ltr"
            >
              {movement.qty > 0 ? '+' : ''}
              {formatNumber(movement.qty, locale)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatDateTime(movement.at, locale)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            {movement.orderId === null
              ? t('it.parts.movementReceipt')
              : t('it.parts.movementForOrder')}
            {movement.note === null ? '' : ` — ${movement.note}`}
          </p>
        </li>
      ))}
    </ul>
  );
};

export const SparePartsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const [search, setSearch] = useState('');
  const [active, setActive] = useState('true');
  const [belowMin, setBelowMin] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({
    by: 'name',
    dir: 'asc',
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ItSparePartDto | null>(null);
  const [receiving, setReceiving] = useState<ItSparePartDto | null>(null);
  const [inspecting, setInspecting] = useState<ItSparePartDto | null>(null);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      active: active === '' ? undefined : active === 'true',
      belowMin: belowMin === '' ? undefined : true,
    }),
    [page, pageSize, sort.by, sort.dir, search, active, belowMin],
  );
  const { data, isLoading, isError, error, refetch } = useItSpareParts(params);

  const changeSort = (by: string): void =>
    setSort((prev) => ({ by, dir: prev.by === by && prev.dir === 'asc' ? 'desc' : 'asc' }));

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItSparePartDto>[] = [
    {
      key: 'partCode',
      header: t('it.parts.columns.code'),
      sortable: true,
      render: (part) => (
        <span className="font-mono text-xs" dir="ltr">
          {part.partCode}
        </span>
      ),
    },
    { key: 'name', header: t('it.parts.columns.name'), sortable: true, render: (p) => p.name },
    {
      key: 'onHandQty',
      header: t('it.parts.columns.onHand'),
      sortable: true,
      render: (part) => (
        <span
          className={
            part.minQty !== null && part.onHandQty <= part.minQty
              ? 'font-semibold text-amber-700 dark:text-amber-400'
              : ''
          }
        >
          {`${formatNumber(part.onHandQty, locale)} ${part.unit}`}
        </span>
      ),
    },
    {
      key: 'minQty',
      header: t('it.parts.columns.minQty'),
      render: (part) => (part.minQty === null ? '—' : formatNumber(part.minQty, locale)),
    },
    {
      key: 'active',
      header: t('it.parts.columns.state'),
      render: (part) => (
        <StatusBadge
          tone={part.active ? 'success' : 'neutral'}
          label={part.active ? t('it.parts.stateActive') : t('it.parts.stateArchived')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (part) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setInspecting(part)}>
            {t('it.parts.viewLedger')}
          </Button>
          {can('itSparePart.manage') && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setReceiving(part)}>
                {t('it.parts.receive')}
              </Button>
              <button
                type="button"
                className={actionButton}
                aria-label={`${t('common.edit')} — ${part.partCode}`}
                title={t('common.edit')}
                onClick={() => setEditing(part)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.spareParts')}
        description={t('it.parts.subtitle')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.spareParts') },
        ]}
        actions={
          <Can permission="itSparePart.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('it.parts.add')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || active !== 'true' || belowMin !== ''}
          onClear={() => {
            setSearch('');
            setActive('true');
            setBelowMin('');
            setPage(1);
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('it.parts.searchPlaceholder')}
            aria-label={t('it.parts.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('it.parts.columns.state')}
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.parts.anyState')}</option>
            <option value="true">{t('it.parts.stateActive')}</option>
            <option value="false">{t('it.parts.stateArchived')}</option>
          </Select>
          <Select
            aria-label={t('it.parts.belowMinFilter')}
            value={belowMin}
            onChange={(e) => {
              setBelowMin(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.parts.anyLevel')}</option>
            <option value="below">{t('it.parts.onlyBelowMin')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(part) => part.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={
            <EmptyState
              icon={<LayersIcon className="h-10 w-10" />}
              title={t('it.parts.emptyTitle')}
              description={t('it.parts.emptyBody')}
            />
          }
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <SparePartDialog open={creating} onClose={() => setCreating(false)} part={null} />
      <SparePartDialog open={editing !== null} onClose={() => setEditing(null)} part={editing} />
      {receiving !== null && (
        <ReceiveStockDialog open onClose={() => setReceiving(null)} part={receiving} />
      )}
      {inspecting !== null && (
        <Dialog
          open
          onClose={() => setInspecting(null)}
          title={`${inspecting.partCode} — ${inspecting.name}`}
          description={t('it.parts.ledgerHint')}
          size="lg"
          footer={
            <Button variant="secondary" onClick={() => setInspecting(null)}>
              {t('common.close')}
            </Button>
          }
        >
          <MovementsPanel part={inspecting} />
        </Dialog>
      )}
    </PageContainer>
  );
};
