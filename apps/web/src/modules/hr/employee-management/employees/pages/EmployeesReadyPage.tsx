// The Employees Ready queue (A6/RW15) — candidates who ACCEPTED an offer and have not been
// converted into an Employee yet. It is read from a fact on the offer (`accepted` with no
// `hiredEmployeeId`) rather than from the absence of an Employee row, which is why the stage
// counter and this page can never disagree.
//
// Hiring copies the terms from the offer's immutable accepted snapshot, so this page only has to
// get HR to the right offer.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type JobOfferDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { formatDate } from '../../../../../shared/lib/format';
import {
  EmployeesReadyFilters,
  type EmployeesReadyFiltersState,
} from '../components/EmployeesReadyFilters';
import { useJobOffers } from '../../../recruitment/job-offers/api/job-offer-queries';
import { useRememberedFilters } from '../../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'af',
  'at',
  'branch',
  'q',
  'size',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const EmployeesReadyPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // Every filter round-trips through the URL: deep-linkable, and a refresh restores the view.
  const filters: EmployeesReadyFiltersState = {
    search: sp.get('q') ?? '',
    branchId: readList(sp, 'branch'),
    acceptedFrom: sp.get('af') ?? '',
    acceptedTo: sp.get('at') ?? '',
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  const patch = (updates: Record<string, string | null>, resetPage = false): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  // Narrowing the result set moves the rows, so page 3 of the old set is meaningless — back to 1.
  const changeFilters = (nf: EmployeesReadyFiltersState): void =>
    patch(
      {
        q: nf.search || null,
        branch: writeList(nf.branchId),
        af: nf.acceptedFrom || null,
        at: nf.acceptedTo || null,
      },
      true,
    );

  // `hired: false` is a SERVER-side predicate — the same one the stage counter counts. Filtering
  // client-side would page over already-hired offers and make the page's totals disagree with the
  // badge, which is exactly the drift this queue exists to avoid.
  // Keyed on the whole query string, so every filter is part of the React Query key and two
  // different filter sets can never share a cache entry.
  const paramsKey = sp.toString();
  const params = useMemo(
    () => ({
      page,
      pageSize,
      status: 'accepted',
      hired: false,
      search: filters.search,
      branchId: filters.branchId,
      respondedFrom: filters.acceptedFrom,
      respondedTo: filters.acceptedTo,
      sortBy: 'respondedAt',
      sortDir: 'desc' as const,
    }),
    [paramsKey, page, pageSize],
  );
  const { data, isLoading, isError, error, refetch } = useJobOffers(params);
  const rows = data?.items ?? [];

  const columns: Column<JobOfferDto>[] = [
    {
      key: 'applicant',
      header: t('employees.ready.columns.applicant'),
      render: (o) => (
        <span>{o.applicantName}</span>
      ),
    },
    {
      key: 'offer',
      header: t('employees.ready.columns.offer'),
      render: (o) => (
        <span className="font-mono text-xs" dir="ltr">
          {o.code ?? '—'}
        </span>
      ),
    },
    {
      key: 'acceptedAt',
      header: t('employees.ready.columns.acceptedAt'),
      render: (o) => (o.respondedAt === null ? '—' : formatDate(o.respondedAt, locale)),
    },
    {
      key: 'startDate',
      header: t('employees.ready.columns.startDate'),
      render: (o) =>
        o.acceptedSnapshot === null ? '—' : formatDate(o.acceptedSnapshot.terms.startDate, locale),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (o) => (
        <Can permission="employee.create">
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/employees/new?offerId=${o.id}`);
            }}
          >
            {t('employees.ready.hire')}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.ready.title')}
        description={t('employees.ready.subtitle')}
        breadcrumbs={[{ label: t('employees.title'), to: '/employees' }, { label: t('employees.ready.title') }]}
      />

      <div className="space-y-4">
        <EmployeesReadyFilters value={filters} onChange={changeFilters} />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(o) => o.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('employees.ready.empty')}
          onRowClick={(o) => navigate(`/job-offers/${o.id}`)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) })}
            onPageSizeChange={(size) => patch({ size: String(size), page: null })}
          />
        )}
      </div>
    </PageContainer>
  );
};
