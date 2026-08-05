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
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { formatDate, formatNumber } from '../../../../../shared/lib/format';
import { ScreeningStatusBadge } from '../components/ScreeningStatusBadge';
import { ScreeningFilters, type ScreeningFiltersState } from '../components/ScreeningFilters';
import { useBulkScreenings, useScreenings } from '../api/screening-queries';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { type ScreeningListParams } from '../api/screening-api';
import { useRememberedQueue } from '../../shared/useRememberedQueue';

const DEFAULT_PAGE_SIZE = 25;

export const ScreeningQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  // A screening exists for every registered applicant already, so the queue's job is the work
  // still waiting on someone — not a ledger of every screening ever decided.
  useRememberedQueue('screening', [sp, setSp], 'status=waiting');

  const filters: ScreeningFiltersState = {
    status: readList(sp, 'status') as ScreeningFiltersState['status'],
    applicantId: sp.get('applicant') ?? '',
    applicantLabel: sp.get('al') ?? '',
    createdFrom: sp.get('cf') ?? '',
    createdTo: sp.get('ct') ?? '',
    ageFrom: sp.get('af') ?? '',
    ageTo: sp.get('at') ?? '',
    educationLevel: readList(sp, 'edu') as ScreeningFiltersState['educationLevel'],
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
      status: writeList(nf.status),
      applicant: nf.applicantId || null,
      al: nf.applicantLabel || null,
      cf: nf.createdFrom || null,
      ct: nf.createdTo || null,
      af: nf.ageFrom || null,
      at: nf.ageTo || null,
      edu: writeList(nf.educationLevel),
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
      // Empty stays empty: `buildQuery` drops blanks, so an untouched box adds no parameter and
      // the server never sees `ageFrom=`.
      ageFrom: filters.ageFrom,
      ageTo: filters.ageTo,
      educationLevel: filters.educationLevel,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useScreenings(params);
  const rows = data?.items ?? [];

  // Bulk decide (RW17). Only WAITING rows can be decided, so the selection offers the actions
  // exactly when every picked row can take them — never a button that half-works.
  const rowIds = useMemo(() => rows.map((s) => s.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkScreenings(() => {
    selection.clear();
    setRejectOpen(false);
    setReason('');
  });
  const decidable = selection.ids.filter((id) => rows.find((r) => r.id === id)?.status === 'waiting');

  const columns: Column<ScreeningDto>[] = [
    {
      key: 'applicant',
      header: t('screening.columns.applicant'),
      render: (s) => <span>{s.applicantName}</span>,
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
      />

      <div className="space-y-4">
        <ScreeningFilters value={filters} onChange={changeFilters} />
        <Can permission="screening.decide">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              loading={bulk.isPending}
              disabled={decidable.length === 0}
              onClick={() => void bulk.mutateAsync({ action: 'approve', ids: decidable })}
            >
              {t('screening.actions.approveSelected')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={decidable.length === 0}
              onClick={() => setRejectOpen(true)}
            >
              {t('screening.actions.rejectSelected')}
            </Button>
          </BulkActionBar>
        </Can>
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
          selection={selection}
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
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('screening.actions.rejectSelected')}
        description={t('bulk.reason.required')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={bulk.isPending}
              disabled={reason.trim() === ''}
              onClick={() =>
                void bulk.mutateAsync({ action: 'reject', ids: decidable, reason: reason.trim() })
              }
            >
              {t('screening.actions.rejectSelected')}
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
