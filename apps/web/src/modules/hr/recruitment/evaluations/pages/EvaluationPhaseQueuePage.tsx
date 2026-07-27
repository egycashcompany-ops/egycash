// One evaluation phase's own page (RW6a): its queue, its buckets, its counters, its actions.
// Phases are independent, so each page is a complete workspace rather than a filter over a
// shared list — and a phase the caller cannot see never reaches the navigation at all (RW7).
//
// Buckets are the phase's OWN status enum (I10) and their counts come from the aggregated
// counters endpoint, the same numbers the navigation badge reads.
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type EvaluationDto, type EvaluationStatus, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { StageBuckets } from '../../shared/StageBuckets';
import { useRecruitmentStageCounts } from '../../counters/stage-counts-queries';
import { EvaluationStatusBadge } from '../components/EvaluationStatusBadge';
import { useBulkEvaluations, useEvaluationPhases, useEvaluations } from '../api/evaluation-queries';

const DEFAULT_PAGE_SIZE = 25;

/** The buckets a phase page offers. `waiting` is the queue the navigation counter reports. */
const BUCKETS: EvaluationStatus[] = ['waiting', 'approved', 'rejected'];

export const EvaluationPhaseQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { phaseId = '' } = useParams();
  const [sp, setSp] = useSearchParams();

  const status = (sp.get('status') ?? 'waiting') as EvaluationStatus;
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

  const { data: phases } = useEvaluationPhases();
  const phase = (phases ?? []).find((p) => p.id === phaseId);

  const { data: counts } = useRecruitmentStageCounts();
  const buckets =
    counts?.stages.find((s) => s.refId === phaseId && s.kind === 'evaluation')?.buckets ?? {};

  const params = useMemo(
    () => ({ page, pageSize, phaseId, status, sortBy: 'createdAt', sortDir: 'desc' as const }),
    [page, pageSize, phaseId, status],
  );
  const { data, isLoading, isError, error, refetch } = useEvaluations(params);
  const rows = data?.items ?? [];

  const rowIds = useMemo(() => rows.map((e) => e.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkEvaluations(() => {
    selection.clear();
    setRejectOpen(false);
    setReason('');
  });
  // The page IS one phase, so a selection can only span it — only "still waiting" has to hold.
  const decidable =
    rows.filter((e) => selection.selectedIds.has(e.id) && e.status === 'waiting').length ===
      selection.count && selection.count > 0;

  const columns: Column<EvaluationDto>[] = [
    {
      key: 'applicant',
      header: t('evaluations.columns.applicant'),
      render: (e) => (
        <span>
          {e.applicantName}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {e.applicantCode}
          </span>
        </span>
      ),
    },
    { key: 'status', header: t('evaluations.columns.status'), render: (e) => <EvaluationStatusBadge status={e.status} /> },
    { key: 'files', header: t('evaluations.columns.files'), align: 'center', render: (e) => e.files.length },
    { key: 'createdAt', header: t('evaluations.columns.opened'), render: (e) => formatDate(e.createdAt, locale) },
  ];

  if (phases === undefined) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={phase === undefined ? t('recruitment.nav.evaluations') : localized(phase.name, locale)}
        description={t('evaluations.phasePage.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.evaluations'), to: '/evaluations' },
          { label: phase === undefined ? '' : localized(phase.name, locale) },
        ]}
      />

      <div className="space-y-4">
        <StageBuckets
          buckets={BUCKETS.map((b) => ({ key: b, label: t(`evaluations.status.${b}`), count: buckets[b] ?? 0 }))}
          active={status}
          onPick={(key) => patch({ status: key })}
        />

        <Can permission="evaluation.manage">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              loading={bulk.isPending}
              disabled={!decidable}
              onClick={() => void bulk.mutateAsync({ action: 'approve', ids: selection.ids, phaseId })}
            >
              {t('evaluations.actions.approveSelected')}
            </Button>
            <Button size="sm" variant="danger" disabled={!decidable} onClick={() => setRejectOpen(true)}>
              {t('evaluations.actions.rejectSelected')}
            </Button>
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
          onRowClick={(e) => navigate(`/evaluations/${e.id}`)}
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
