// Evaluations queue: the post-interview, file-based approval checks. A status filter, a sortable
// DataTable keyed by Application Number (no names), pagination, and an "Open evaluation" entry
// point — all permission-gated. Filter/sort/pagination sync with the URL query string.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EVALUATION_STATUSES, type EvaluationDto, type Locale } from '@ecms/contracts';
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
import { Select } from '../../../../../shared/ui/form';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { EvaluationStatusBadge } from '../components/EvaluationStatusBadge';
import { OpenEvaluationDialog } from '../components/OpenEvaluationDialog';
import { useBulkEvaluations, useEvaluations } from '../api/evaluation-queries';
import { type EvaluationListParams } from '../api/evaluation-api';

const DEFAULT_PAGE_SIZE = 25;

export const EvaluationQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [openDialog, setOpenDialog] = useState(false);

  const status = sp.get('status') ?? '';
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

  const params = useMemo<EvaluationListParams>(
    () => ({ page, pageSize, sortBy: sort.by, sortDir: sort.dir, status: status || undefined }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useEvaluations(params);
  const rows = data?.items ?? [];

  // Bulk decide (RW10/RW17). A selection can only be decided together when it belongs to ONE
  // phase and every row is still waiting — the backend enforces both, and the UI offers the
  // actions only when they can actually apply.
  const rowIds = useMemo(() => rows.map((e) => e.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkEvaluations(() => {
    selection.clear();
    setRejectOpen(false);
    setReason('');
  });
  const picked = rows.filter((e) => selection.selectedIds.has(e.id));
  const phaseIds = new Set(picked.map((e) => e.phaseId));
  const decidable = picked.filter((e) => e.status === 'waiting');
  const canDecide = phaseIds.size === 1 && decidable.length === picked.length && picked.length > 0;
  const phaseId = [...phaseIds][0] ?? '';

  const columns: Column<EvaluationDto>[] = [
    {
      key: 'applicantCode',
      header: t('evaluations.columns.applicant'),
      render: (e) => <span>{e.applicantName}</span>,
    },
    { key: 'phase', header: t('evaluations.columns.phase'), render: (e) => `${e.phaseOrder}. ${localized(e.phaseName, locale)}` },
    { key: 'status', header: t('evaluations.columns.status'), render: (e) => <EvaluationStatusBadge status={e.status} /> },
    {
      key: 'decidedAt',
      header: t('evaluations.columns.decidedAt'),
      render: (e) => (e.decidedAt === null ? '—' : formatDate(e.decidedAt, locale)),
    },
    { key: 'createdAt', header: t('evaluations.columns.created'), sortable: true, render: (e) => formatDate(e.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.evaluations')}
        description={t('evaluations.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.evaluations') }]}
        actions={
          <div className="flex items-center gap-2">
            <Can permission="evaluationPhase.manage">
              <Button size="sm" variant="ghost" onClick={() => navigate('phases')}>
                {t('evaluations.phases.title')}
              </Button>
            </Can>
            <Can permission="evaluation.manage">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setOpenDialog(true)}>
                {t('evaluations.actions.open')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-full sm:w-56"
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            aria-label={t('evaluations.columns.status')}
          >
            <option value="">{t('evaluations.filters.allStatuses')}</option>
            {EVALUATION_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`evaluations.status.${s}`)}</option>
            ))}
          </Select>
        </div>
        <Can permission="evaluation.manage">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              loading={bulk.isPending}
              disabled={!canDecide}
              onClick={() =>
                void bulk.mutateAsync({ action: 'approve', ids: selection.ids, phaseId })
              }
            >
              {t('evaluations.actions.approveSelected')}
            </Button>
            <Button size="sm" variant="danger" disabled={!canDecide} onClick={() => setRejectOpen(true)}>
              {t('evaluations.actions.rejectSelected')}
            </Button>
            {!canDecide && selection.count > 0 && (
              <span className="text-xs text-slate-600 dark:text-slate-300">
                {t('evaluations.bulk.samePhaseOnly')}
              </span>
            )}
          </BulkActionBar>
        </Can>
        <DataTable
          selection={selection}
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(e) => navigate(e.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <OpenEvaluationDialog open={openDialog} onClose={() => setOpenDialog(false)} />
      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('evaluations.actions.rejectSelected')}
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
                void bulk.mutateAsync({
                  action: 'reject',
                  ids: selection.ids,
                  phaseId,
                  reason: reason.trim(),
                })
              }
            >
              {t('evaluations.actions.rejectSelected')}
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
