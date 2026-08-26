// ONE PHASE'S batches (RW7/RW8). Batches are permanent, so this list is the complete history —
// cancelled and closed ones included — with the status strip as its filter.
//
// It used to be every phase's batches in one table, told apart only by a `phase` COLUMN. That is
// what made a security check and a driving test look like the same errand: they are two different
// documents, sent to two different bodies, read by two different people, and the screen merged
// them. Reached through `phase/:phaseKey` the list is scoped, and the phase column disappears
// because every row now carries the same value.
//
// The unscoped route still answers — a caller who typed `/evaluation-batches` gets everything they
// may see — but nothing links there any more. And an UNKNOWN key never falls back to "everything":
// silently widening the very filter this page exists to apply is how the old bug would come back.
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type EvaluationBatchStatus, type EvaluationBatchSummaryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { StageBuckets } from '../../shared/StageBuckets';
import { BatchPackageBadge, BatchStatusBadge } from '../components/BatchStatusBadge';
import { useBulkEvaluationBatches, useEvaluationBatches } from '../api/evaluation-batch-queries';
import { useEvaluationPhases } from '../../evaluations/api/evaluation-queries';

const DEFAULT_PAGE_SIZE = 25;
const STATUSES: EvaluationBatchStatus[] = ['draft', 'issued', 'closed', 'cancelled'];

export const EvaluationBatchesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { phaseKey } = useParams<{ phaseKey?: string }>();

  // The catalog is the only thing that maps a stable key to the id the API filters by. While it
  // loads there is no id yet, so the query waits rather than asking for every phase at once.
  const { data: phases, isLoading: phasesLoading } = useEvaluationPhases();
  const phase = phaseKey === undefined ? undefined : phases?.find((p) => p.key === phaseKey);
  const phaseUnknown = phaseKey !== undefined && phases !== undefined && phase === undefined;
  const awaitingPhase = phaseKey !== undefined && phase === undefined;

  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'createdAt',
      sortDir: 'desc' as const,
      ...(status === '' ? {} : { status }),
      ...(phase === undefined ? {} : { phaseId: phase.id }),
    }),
    [page, pageSize, status, phase],
  );
  const { data, isLoading, isError, error, refetch } = useEvaluationBatches(params, !awaitingPhase);
  const rows = data?.items ?? [];

  // RW17 — closing and cancelling are the two acts that make sense over a selection; both run per
  // batch through the ordinary service, so one that is already terminal fails as that item alone.
  const rowIds = useMemo(() => rows.map((b) => b.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkEvaluationBatches(() => {
    selection.clear();
    setCancelOpen(false);
    setReason('');
  });
  const closable = rows.filter((b) => selection.selectedIds.has(b.id) && b.status === 'issued').map((b) => b.id);
  const cancellable = rows
    .filter((b) => selection.selectedIds.has(b.id) && (b.status === 'draft' || b.status === 'issued'))
    .map((b) => b.id);

  const columns: Column<EvaluationBatchSummaryDto>[] = [
    {
      key: 'code',
      header: t('batches.columns.code'),
      render: (b) => (
        <span className="font-mono text-xs" dir="ltr">
          {b.code}
        </span>
      ),
    },
    ...(phaseKey === undefined
      ? [
          {
            key: 'phase',
            header: t('batches.columns.phase'),
            render: (b: EvaluationBatchSummaryDto) => localized(b.phaseName, locale),
          },
        ]
      : []),
    { key: 'title', header: t('batches.columns.title'), render: (b) => b.title ?? '—' },
    { key: 'status', header: t('batches.columns.status'), render: (b) => <BatchStatusBadge status={b.status} /> },
    {
      key: 'counts',
      header: t('batches.columns.progress'),
      align: 'center',
      render: (b) => `${b.counts.approved + b.counts.rejected}/${b.counts.total - b.counts.voided}`,
    },
    {
      key: 'package',
      header: t('batches.columns.package'),
      render: (b) => <BatchPackageBadge status={b.package.status} />,
    },
    {
      key: 'sentAt',
      header: t('batches.columns.sentAt'),
      render: (b) => (b.sentAt === null ? '—' : formatDate(b.sentAt, locale)),
    },
    {
      key: 'returnedAt',
      header: t('batches.columns.returnedAt'),
      render: (b) => (b.returnedAt === null ? '—' : formatDate(b.returnedAt, locale)),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={phase === undefined ? t('batches.title') : localized(phase.name, locale)}
        description={t('batches.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: phase === undefined ? t('batches.title') : localized(phase.name, locale) },
        ]}
      />

      {phaseUnknown && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {t('batches.unknownPhase')}
        </div>
      )}

      <div className="space-y-4">
        <StageBuckets
          buckets={[
            { key: '', label: t('batches.filter.all'), count: data?.meta.totalItems ?? 0 },
            ...STATUSES.map((s) => ({ key: s, label: t(`batches.status.${s}`), count: 0 })),
          ]}
          active={status}
          onPick={(key) => patch({ status: key })}
        />

        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Button
            size="sm"
            loading={bulk.isPending}
            disabled={closable.length === 0}
            onClick={() => void bulk.mutateAsync({ action: 'close', ids: closable })}
          >
            {t('batches.actions.closeSelected')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={cancellable.length === 0}
            onClick={() => setCancelOpen(true)}
          >
            {t('batches.actions.cancelSelected')}
          </Button>
        </BulkActionBar>

        <DataTable
          selection={selection}
          columns={columns}
          rows={phaseUnknown ? [] : rows}
          rowKey={(b) => b.id}
          loading={isLoading || phasesLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          onRowClick={(b) => navigate(`/evaluation-batches/${b.id}`)}
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
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('batches.actions.cancelSelected')}
        description={t('bulk.reason.required')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={bulk.isPending}
              disabled={reason.trim() === ''}
              onClick={() =>
                void bulk.mutateAsync({ action: 'cancel', ids: cancellable, reason: reason.trim() })
              }
            >
              {t('batches.actions.cancelSelected')}
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
