// The preventive schedule (design §2.7, §4.6, §12).
//
// `nextDueAt` is the ONE column that matters here, and it is a stored stamp, never a recomputed
// schedule: the sweep reads it, a completion advances it from the completion date, and this table
// shows the same value both of them use. Nothing on this page derives a due date.
//
// A plan DEACTIVATES rather than deletes (FR-11): the orders it generated point at it forever.
import { useMemo, useState } from 'react';
import { type ItMaintenancePlanDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { CalendarIcon, EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useItMaintenancePlans, useSetItMaintenancePlanActive } from '../api/it-queries';
import { MaintenancePlanDialog } from '../components/MaintenancePlanDialog';
import { ItAssetLink } from '../components/ItAssetLink';

const DEFAULT_PAGE_SIZE = 25;

export const MaintenancePlansPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const [active, setActive] = useState('true');
  const [due, setDue] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({
    by: 'nextDueAt',
    dir: 'asc',
  });
  const [editing, setEditing] = useState<ItMaintenancePlanDto | null>(null);
  const [creating, setCreating] = useState(false);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      active: active === '' ? undefined : active === 'true',
      due: due === '' ? undefined : true,
    }),
    [page, pageSize, sort.by, sort.dir, active, due],
  );
  const { data, isLoading, isError, error, refetch } = useItMaintenancePlans(params);
  const setPlanActive = useSetItMaintenancePlanActive();

  const changeSort = (by: string): void =>
    setSort((prev) => ({ by, dir: prev.by === by && prev.dir === 'asc' ? 'desc' : 'asc' }));

  const toggle = async (plan: ItMaintenancePlanDto): Promise<void> => {
    try {
      await setPlanActive.mutateAsync({ id: plan.id, active: !plan.active });
      toast.success(plan.active ? t('it.plans.deactivated') : t('it.plans.activated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItMaintenancePlanDto>[] = [
    {
      key: 'name',
      header: t('it.plans.columns.name'),
      sortable: true,
      render: (plan) => plan.name,
    },
    {
      key: 'asset',
      header: t('it.plans.columns.asset'),
      render: (plan) => <ItAssetLink id={plan.assetId} />,
    },
    {
      key: 'intervalDays',
      header: t('it.plans.columns.interval'),
      render: (plan) => t('it.plans.everyDays', { days: String(plan.intervalDays) }),
    },
    {
      key: 'nextDueAt',
      header: t('it.plans.columns.nextDue'),
      sortable: true,
      render: (plan) => (
        <span className={new Date(plan.nextDueAt).getTime() <= Date.now() ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>
          {formatDate(plan.nextDueAt, locale)}
        </span>
      ),
    },
    {
      key: 'lastCompletedAt',
      header: t('it.plans.columns.lastCompleted'),
      render: (plan) =>
        plan.lastCompletedAt === null ? '—' : formatDate(plan.lastCompletedAt, locale),
    },
    {
      key: 'active',
      header: t('it.plans.columns.state'),
      render: (plan) => (
        <StatusBadge
          tone={plan.active ? 'success' : 'neutral'}
          label={plan.active ? t('it.plans.stateActive') : t('it.plans.statePaused')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (plan) =>
        can('itMaintenancePlan.manage') ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className={actionButton}
              aria-label={`${t('common.edit')} — ${plan.name}`}
              title={t('common.edit')}
              onClick={() => setEditing(plan)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
            <Button size="sm" variant="ghost" onClick={() => void toggle(plan)}>
              {plan.active ? t('it.plans.deactivate') : t('it.plans.activate')}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.maintenancePlans')}
        description={t('it.plans.subtitle')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.maintenance'), to: '/it/maintenance' },
          { label: t('it.nav.maintenancePlans') },
        ]}
        actions={
          <Can permission="itMaintenancePlan.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('it.plans.add')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={active !== 'true' || due !== ''}
          onClear={() => {
            setActive('true');
            setDue('');
            setPage(1);
          }}
        >
          <Select
            aria-label={t('it.plans.columns.state')}
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.plans.anyState')}</option>
            <option value="true">{t('it.plans.stateActive')}</option>
            <option value="false">{t('it.plans.statePaused')}</option>
          </Select>
          <Select
            aria-label={t('it.plans.dueFilter')}
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.plans.anyDue')}</option>
            <option value="due">{t('it.plans.onlyDue')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(plan) => plan.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={
            <EmptyState
              icon={<CalendarIcon className="h-10 w-10" />}
              title={t('it.plans.emptyTitle')}
              description={t('it.plans.emptyBody')}
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

      <MaintenancePlanDialog open={creating} onClose={() => setCreating(false)} plan={null} />
      <MaintenancePlanDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        plan={editing}
      />
    </PageContainer>
  );
};
