// Screening queue: filters (status, applicant, created-date range), sortable DataTable,
// pagination, and a create entry point — all permission-gated. Filters/sort/pagination are
// synchronized with the URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ScreeningDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../../../shared/lib/format';
import { ScreeningStatusBadge } from '../components/ScreeningStatusBadge';
import { ScreeningFilters, type ScreeningFiltersState } from '../components/ScreeningFilters';
import { AwaitingScreeningsPanel } from '../components/AwaitingScreeningsPanel';
import { CreateScreeningDialog, type PickedApplicant } from '../components/CreateScreeningDialog';
import { useScreenings } from '../api/screening-queries';
import { type ScreeningListParams } from '../api/screening-api';

const DEFAULT_PAGE_SIZE = 25;

export const ScreeningQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [createFor, setCreateFor] = useState<PickedApplicant | null>(null);

  const filters: ScreeningFiltersState = {
    status: (sp.get('status') ?? '') as ScreeningFiltersState['status'],
    applicantId: sp.get('applicant') ?? '',
    applicantLabel: sp.get('al') ?? '',
    createdFrom: sp.get('cf') ?? '',
    createdTo: sp.get('ct') ?? '',
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

  const changeFilters = (nf: ScreeningFiltersState): void =>
    patch({
      status: nf.status || null,
      applicant: nf.applicantId || null,
      al: nf.applicantLabel || null,
      cf: nf.createdFrom || null,
      ct: nf.createdTo || null,
    });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<ScreeningListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      status: filters.status,
      applicantId: filters.applicantId,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useScreenings(params);
  const rows = data?.items ?? [];

  const columns: Column<ScreeningDto>[] = [
    {
      key: 'applicant',
      header: t('screening.columns.applicant'),
      render: (s) => <span className="font-mono text-xs" dir="ltr">{s.applicantCode}</span>,
    },
    { key: 'status', header: t('screening.columns.status'), sortable: true, render: (s) => <ScreeningStatusBadge status={s.status} /> },
    { key: 'notes', header: t('screening.columns.notes'), align: 'center', render: (s) => formatNumber(s.notes.length, locale) },
    {
      key: 'decidedAt',
      header: t('screening.columns.decided'),
      sortable: true,
      render: (s) => (s.decision === null ? '—' : formatDate(s.decision.decidedAt, locale)),
    },
    { key: 'createdAt', header: t('screening.columns.created'), sortable: true, render: (s) => formatDate(s.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.screening')}
        description={t('screening.queue.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.screening') }]}
        actions={
          <Can permission="screening.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => { setCreateFor(null); setCreateOpen(true); }}>
              {t('screening.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <AwaitingScreeningsPanel onOpen={(a) => { setCreateFor(a); setCreateOpen(true); }} />
        <ScreeningFilters value={filters} onChange={changeFilters} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(s) => navigate(s.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateScreeningDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateFor(null); }}
        {...(createFor === null ? {} : { applicant: createFor })}
      />
    </PageContainer>
  );
};
