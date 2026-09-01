// Help-desk settings (design §2.6, §8.3) — the priorities, which ARE the SLA policy.
//
// One screen, one grant (`itSlaPolicy.manage`), one collection. v1.0 of the design split priority
// and policy into two joined tables; an admin tunes the name, the rank and the two targets as ONE
// decision, so they are one row and one form.
//
// The banner is the point of the page: an edit here changes what FUTURE tickets promise. Every
// open ticket snapshotted its targets when it was opened and the server never recomputes them, so
// nobody should leave this screen believing they just fixed a running breach.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ItTicketPriorityDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { localized } from '../../../shared/lib/format';
import { useItTicketPriorities } from '../api/it-queries';
import { TicketPriorityDialog } from '../components/TicketPriorityDialog';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const HelpDeskSettingsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'rank:asc').split(':');
  const sort = { by: sortByRaw ?? 'rank', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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
      isActive: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItTicketPriorities(params);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ItTicketPriorityDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const duration = (value: number): string =>
    value >= 60
      ? t('it.priorities.hoursShort', { hours: String(Math.round((value / 60) * 10) / 10) })
      : t('it.priorities.minutesShort', { minutes: String(value) });

  const columns: Column<ItTicketPriorityDto>[] = [
    {
      key: 'rank',
      header: t('it.priorities.fields.rank'),
      sortable: true,
      render: (p) => <span className="tabular-nums">{p.rank}</span>,
    },
    {
      key: 'name',
      header: t('it.priorities.fields.name'),
      render: (p) => localized(p.name, locale),
    },
    // The two targets are NOT sortable: the API's `sortableFields` is `rank | createdAt | name.ar`,
    // and an undeclared `sortBy` silently falls back to `createdAt` — a header that looks like it
    // sorted and did not.
    {
      key: 'responseMinutes',
      header: t('it.priorities.fields.responseMinutes'),
      render: (p) => <span className="tabular-nums">{duration(p.responseMinutes)}</span>,
    },
    {
      key: 'resolutionMinutes',
      header: t('it.priorities.fields.resolutionMinutes'),
      render: (p) => <span className="tabular-nums">{duration(p.resolutionMinutes)}</span>,
    },
    {
      key: 'isActive',
      header: t('it.assets.columns.status'),
      render: (p) => (
        <StatusBadge
          tone={p.isActive ? 'success' : 'neutral'}
          label={p.isActive ? t('it.catalogs.active') : t('it.catalogs.archived')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (p) => (
        <Can permission="itSlaPolicy.manage">
          <button
            type="button"
            className={actionButton}
            aria-label={`${t('it.priorities.edit')} — ${localized(p.name, locale)}`}
            title={t('it.priorities.edit')}
            onClick={() => setEditing(p)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.helpDeskSettings')}
        description={t('it.priorities.subtitle')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.tickets'), to: '/it/tickets' },
          { label: t('it.nav.helpDeskSettings') },
        ]}
        actions={
          <Can permission="itSlaPolicy.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('it.priorities.add')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title={t('it.priorities.sections.policy')}
            description={t('it.priorities.policyHint')}
          />
          <CardBody>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {t('it.priorities.snapshotWarning')}
            </p>
          </CardBody>
        </Card>

        <FilterBar hasActiveFilters={active !== ''} onClear={() => patch({ active: null })}>
          <Select
            aria-label={t('it.assets.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.catalogs.allStatuses')}</option>
            <option value="true">{t('it.catalogs.active')}</option>
            <option value="false">{t('it.catalogs.archived')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={t('it.priorities.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <TicketPriorityDialog
        open={creating}
        onClose={() => setCreating(false)}
        priority={null}
      />
      <TicketPriorityDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        priority={editing}
      />
    </PageContainer>
  );
};
