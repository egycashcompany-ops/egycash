// Job Offer list: free-text search + status + active-only filters, a sortable DataTable, pagination,
// and a create entry point — all permission-gated. Filters/sort/pagination are synchronized with the
// URL query string (deep-linkable, back/forward aware).
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type JobOfferDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../../../shared/lib/format';
import { OfferStatusBadge } from '../components/OfferStatusBadge';
import { OfferFilters, type OfferFiltersState } from '../components/OfferFilters';
import { useJobOffers } from '../api/job-offer-queries';
import { type JobOfferListParams } from '../api/job-offer-api';

const DEFAULT_PAGE_SIZE = 25;

export const JobOffersListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const filters: OfferFiltersState = {
    search: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as OfferFiltersState['status'],
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
    patch({ q: nf.search || null, status: nf.status || null, active: nf.active ? 'true' : null });
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

  const columns: Column<JobOfferDto>[] = [
    {
      key: 'code',
      header: t('offers.columns.code'),
      render: (o) => <span className="font-mono text-xs" dir="ltr">{o.code}</span>,
    },
    {
      key: 'applicant',
      header: t('offers.columns.applicant'),
      render: (o) => <span className="font-mono text-xs" dir="ltr">{o.applicantCode}</span>,
    },
    { key: 'status', header: t('offers.columns.status'), sortable: true, render: (o) => <OfferStatusBadge status={o.status} /> },
    {
      key: 'salary',
      header: t('offers.columns.salary'),
      align: 'end',
      render: (o) => formatMoney(o.terms.salary.amount, o.terms.salary.currency, locale),
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
        <DataTable
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
    </PageContainer>
  );
};
