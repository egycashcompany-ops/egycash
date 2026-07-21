// Hiring-documents list: free-text search + status filter, a sortable DataTable, pagination, and an
// open-set entry point — all permission-gated. Search/status/sort/pagination are synchronized with
// the URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type HiringDocumentsDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../../../shared/lib/format';
import { HiringDocsStatusBadge } from '../components/HiringDocsStatusBadge';
import { HiringDocsFilters, type HiringDocsFiltersState } from '../components/HiringDocsFilters';
import { CreateHiringDocsDialog } from '../components/CreateHiringDocsDialog';
import { useHiringDocsList } from '../api/hiring-documents-queries';
import { type HiringDocsListParams } from '../api/hiring-documents-api';

const DEFAULT_PAGE_SIZE = 25;

export const HiringDocsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);

  const filters: HiringDocsFiltersState = {
    search: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as HiringDocsFiltersState['status'],
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

  const changeFilters = (nf: HiringDocsFiltersState): void => patch({ q: nf.search || null, status: nf.status || null });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<HiringDocsListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: filters.search,
      status: filters.status,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useHiringDocsList(params);
  const rows = data?.items ?? [];

  const columns: Column<HiringDocumentsDto>[] = [
    {
      key: 'employeeCode',
      header: t('hiringDocs.columns.employee'),
      sortable: true,
      render: (h) => <span className="font-mono text-xs" dir="ltr">{h.employeeCode}</span>,
    },
    { key: 'status', header: t('hiringDocs.columns.status'), render: (h) => <HiringDocsStatusBadge status={h.status} /> },
    { key: 'documents', header: t('hiringDocs.columns.documents'), align: 'center', render: (h) => formatNumber(h.documents.length, locale) },
    {
      key: 'missing',
      header: t('hiringDocs.columns.missing'),
      align: 'center',
      render: (h) =>
        h.missingRequired.length === 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">—</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">{formatNumber(h.missingRequired.length, locale)}</span>
        ),
    },
    { key: 'createdAt', header: t('hiringDocs.columns.created'), sortable: true, render: (h) => formatDate(h.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.hiringDocuments')}
        description={t('hiringDocs.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.hiringDocuments') }]}
        actions={
          <Can permission="hiringDocuments.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              {t('hiringDocs.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <HiringDocsFilters value={filters} onChange={changeFilters} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(h) => h.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(h) => navigate(h.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateHiringDocsDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
};
