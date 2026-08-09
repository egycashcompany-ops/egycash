// The help-desk queue (design §2.6, §4.4, §12) — URL-synced search + filters + sort + pagination
// over the real IT-3 list API, so a dispatcher's filtered view is a shareable link.
//
// Two audiences, one screen, and the difference is a QUERY PARAM rather than a second page:
//
//   * a dispatcher/technician sees the queue and filters it;
//   * a requester sees `?mine=true`, which the SERVER answers from the caller's own id (FR-8).
//
// `mine` is honest in both directions: it never widens what a requester may read (the `own` scope
// already bounds that server-side), and it never hides anything from a dispatcher who clears it.
// The tab is a convenience over a server filter, never a permission boundary.
//
// Every column is a SERVER fact — `ticketCode` from the sequence (FR-1), `status` only from a
// named transition (§4.4), and the SLA state from the snapshot plus the breach stamps (FR-6).
// Nothing on this page recomputes any of them.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IT_TICKET_STATUSES, type ItTicketDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { EyeIcon, InboxIcon, PlusIcon, SearchIcon } from '../../../shared/ui/icons';
import { localized } from '../../../shared/lib/format';
import { useItCatalog, useItTicketPriorities, useItTickets } from '../api/it-queries';
import { TicketStatusBadge } from '../components/TicketStatusBadge';
import { SlaIndicator } from '../components/SlaIndicator';
import { ItUserName } from '../components/ItUserName';
import { CreateTicketDialog } from '../components/TicketDialogs';

const DEFAULT_PAGE_SIZE = 25;

/** The three saved views. `scope` is presentation over the server's own filters, nothing more. */
const VIEWS = ['queue', 'mine', 'breached'] as const;
type View = (typeof VIEWS)[number];
const isView = (value: string | null): value is View =>
  (VIEWS as readonly string[]).includes(value ?? '');

export const TicketsListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const view: View = isView(sp.get('view')) ? (sp.get('view') as View) : 'queue';
  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const categoryId = sp.get('category') ?? '';
  const priorityId = sp.get('priority') ?? '';
  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
  const hasActiveFilters =
    search !== '' || status !== '' || categoryId !== '' || priorityId !== '' || active !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      categoryId: categoryId || undefined,
      priorityId: priorityId || undefined,
      active: active === '' ? undefined : active === 'true',
      // The two views that ARE server filters. `queue` sends neither.
      mine: view === 'mine' ? true : undefined,
      breached: view === 'breached' ? true : undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItTickets(params);
  const rows = data?.items ?? [];

  const categories = useItCatalog('ticketCategory');
  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of categories.data?.items ?? []) map.set(item.id, localized(item.name, locale));
    return map;
  }, [categories.data, locale]);

  const priorities = useItTicketPriorities();
  const priorityName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of priorities.data?.items ?? []) map.set(p.id, localized(p.name, locale));
    return map;
  }, [priorities.data, locale]);

  const [creating, setCreating] = useState(false);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItTicketDto>[] = [
    {
      key: 'ticketCode',
      header: t('it.tickets.columns.code'),
      sortable: true,
      render: (ticket) => (
        <span className="font-mono text-xs" dir="ltr">
          {ticket.ticketCode}
        </span>
      ),
    },
    // Only the fields the API's `sortableFields` accepts carry a sort header. An undeclared
    // `sortBy` does not error — the repository quietly falls back to `createdAt` — so a header
    // wired to `title` would look like it worked and sort by something else entirely.
    {
      key: 'title',
      header: t('it.tickets.columns.title'),
      render: (ticket) => ticket.title,
    },
    {
      key: 'category',
      header: t('it.tickets.columns.category'),
      render: (ticket) => categoryName.get(ticket.categoryId) ?? '—',
    },
    {
      key: 'priority',
      header: t('it.tickets.columns.priority'),
      render: (ticket) => priorityName.get(ticket.priorityId) ?? '—',
    },
    {
      key: 'status',
      header: t('it.tickets.columns.status'),
      sortable: true,
      render: (ticket) => <TicketStatusBadge status={ticket.status} />,
    },
    {
      key: 'requester',
      header: t('it.tickets.columns.requester'),
      render: (ticket) => <ItUserName id={ticket.requesterUserId} />,
    },
    {
      key: 'technician',
      header: t('it.tickets.columns.technician'),
      render: (ticket) =>
        ticket.assignedTechnicianUserId === null ? (
          <span className="text-slate-500 dark:text-slate-400">{t('it.tickets.unassigned')}</span>
        ) : (
          <ItUserName id={ticket.assignedTechnicianUserId} />
        ),
    },
    {
      key: 'sla.resolutionDueAt',
      header: t('it.tickets.columns.sla'),
      sortable: true,
      render: (ticket) => <SlaIndicator ticket={ticket} phase="resolution" />,
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (ticket) => (
        <button
          type="button"
          className={actionButton}
          aria-label={`${t('it.tickets.open')} — ${ticket.ticketCode}`}
          title={t('it.tickets.open')}
          onClick={() => navigate(ticket.id)}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.tickets')}
        description={t('it.tickets.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.tickets') }]}
        actions={
          <div className="flex items-center gap-2">
            {can('itSlaPolicy.manage') && (
              <Button size="sm" variant="secondary" onClick={() => navigate('/it/helpdesk-settings')}>
                {t('it.nav.helpDeskSettings')}
              </Button>
            )}
            <Can permission="itTicket.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              >
                {t('it.tickets.create')}
              </Button>
            </Can>
          </div>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
        aria-label={t('it.tickets.views')}
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            type="button"
            onClick={() => patch({ view: v === 'queue' ? null : v })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              view === v
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`it.tickets.view.${v}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({ q: null, status: null, category: null, priority: null, active: null })
          }
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.tickets.searchPlaceholder')}
            aria-label={t('it.tickets.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('it.tickets.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.tickets.allStatuses')}</option>
            {IT_TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`it.tickets.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.tickets.openClosed')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.tickets.anyLifecycle')}</option>
            <option value="true">{t('it.tickets.onlyActive')}</option>
            <option value="false">{t('it.tickets.onlyFinished')}</option>
          </Select>
          <Select
            aria-label={t('it.tickets.columns.category')}
            value={categoryId}
            onChange={(e) => patch({ category: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.tickets.allCategories')}</option>
            {(categories.data?.items ?? [])
              .filter((item) => item.isActive || item.id === categoryId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {localized(item.name, locale)}
                </option>
              ))}
          </Select>
          <Select
            aria-label={t('it.tickets.columns.priority')}
            value={priorityId}
            onChange={(e) => patch({ priority: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.tickets.allPriorities')}</option>
            {(priorities.data?.items ?? [])
              .filter((p) => p.isActive || p.id === priorityId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {localized(p.name, locale)}
                </option>
              ))}
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(ticket) => ticket.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={
            // An empty QUEUE and an empty SEARCH are different problems, and a requester with no
            // tickets is a third: each gets the sentence that fits it.
            hasActiveFilters ? (
              <EmptyState
                icon={<SearchIcon className="h-10 w-10" />}
                title={t('it.tickets.emptyFilteredTitle')}
                description={t('it.tickets.emptyFilteredBody')}
              />
            ) : (
              <EmptyState
                icon={<InboxIcon className="h-10 w-10" />}
                title={view === 'mine' ? t('it.tickets.emptyMineTitle') : t('it.tickets.emptyTitle')}
                description={
                  view === 'mine' ? t('it.tickets.emptyMineBody') : t('it.tickets.emptyBody')
                }
              />
            )
          }
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateTicketDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(ticket) => navigate(ticket.id)}
      />
    </PageContainer>
  );
};
