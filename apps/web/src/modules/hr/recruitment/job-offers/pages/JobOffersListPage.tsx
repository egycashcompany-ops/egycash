// Job Offer list: free-text search + status + active-only filters, a sortable DataTable, pagination,
// and a create entry point — all permission-gated. Filters/sort/pagination are synchronized with the
// URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type JobOfferDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../../../shared/lib/format';
import { OfferStatusBadge } from '../components/OfferStatusBadge';
import { OfferFilters, type OfferFiltersState } from '../components/OfferFilters';
import { useJobOffers, useBulkJobOffers } from '../api/job-offer-queries';
import { type JobOfferListParams } from '../api/job-offer-api';

const DEFAULT_PAGE_SIZE = 25;

export const JobOffersListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const filters: OfferFiltersState = {
    search: sp.get('q') ?? '',
    status: readList(sp, 'status') as OfferFiltersState['status'],
    active: sp.get('active') === 'true',
  };
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

  const changeFilters = (nf: OfferFiltersState): void =>
    patch({ q: nf.search || null, status: writeList(nf.status), active: nf.active ? 'true' : null });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<JobOfferListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: filters.search,
      status: filters.status,
      active: filters.active ? true : undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useJobOffers(params);
  const rows = data?.items ?? [];

  // Bulk send/withdraw (RW17). Each action is offered only for the rows that can take it: a
  // draft can be sent, a draft or sent offer can be withdrawn.
  const rowIds = useMemo(() => rows.map((o) => o.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkJobOffers(() => {
    selection.clear();
    setWithdrawOpen(false);
    setReason('');
  });
  const picked = rows.filter((o) => selection.selectedIds.has(o.id));
  const sendable = picked.filter((o) => o.status === 'draft').map((o) => o.id);
  const withdrawable = picked
    .filter((o) => o.status === 'draft' || o.status === 'sent')
    .map((o) => o.id);

  const columns: Column<JobOfferDto>[] = [
    {
      key: 'code',
      header: t('offers.columns.code'),
      render: (o) => <span className="font-mono text-xs" dir="ltr">{o.code}</span>,
    },
    {
      key: 'applicant',
      header: t('offers.columns.applicant'),
      render: (o) => <span>{o.applicantName}</span>,
    },
    { key: 'status', header: t('offers.columns.status'), sortable: true, render: (o) => <OfferStatusBadge status={o.status} /> },
    {
      key: 'salary',
      header: t('offers.columns.salary'),
      align: 'end',
      render: (o) =>
        o.terms?.salary == null
          ? '—'
          : formatMoney(o.terms.salary.amount, o.terms.salary.currency, locale),
    },
    { key: 'createdAt', header: t('offers.columns.created'), sortable: true, render: (o) => formatDate(o.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.offers')}
        description={t('offers.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.offers') }]}
        actions={
          <Can permission="jobOffer.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('offers.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <OfferFilters value={filters} onChange={changeFilters} />
        <Can permission="jobOffer.edit">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              loading={bulk.isPending}
              disabled={sendable.length === 0}
              onClick={() => void bulk.mutateAsync({ action: 'send', ids: sendable })}
            >
              {t('offers.actions.sendSelected')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={withdrawable.length === 0}
              onClick={() => setWithdrawOpen(true)}
            >
              {t('offers.actions.withdrawSelected')}
            </Button>
          </BulkActionBar>
        </Can>
        <DataTable
          selection={selection}
          columns={columns}
          rows={rows}
          rowKey={(o) => o.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(o) => navigate(o.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t('offers.actions.withdrawSelected')}
        description={t('bulk.reason.required')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={bulk.isPending}
              disabled={reason.trim() === ''}
              onClick={() =>
                void bulk.mutateAsync({ action: 'withdraw', ids: withdrawable, reason: reason.trim() })
              }
            >
              {t('offers.actions.withdrawSelected')}
            </Button>
          </>
        }
      >
        <Field label={t('bulk.reason.title')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </PageContainer>
  );
};
