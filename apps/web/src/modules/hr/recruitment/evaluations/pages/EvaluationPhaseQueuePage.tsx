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
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { EvaluationFilters, type EvaluationFiltersState } from '../components/EvaluationFilters';
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
import { GenerateBatchDialog } from '../../evaluation-batches/components/GenerateBatchDialog';
import { RecordResultDialog } from '../components/RecordResultDialog';
import { useBulkEvaluations, useEvaluationPhases, useEvaluations } from '../api/evaluation-queries';

const DEFAULT_PAGE_SIZE = 25;

/** The buckets a phase page offers. `waiting` is the queue the navigation counter reports. */
// The phase's own status enum (I10) — `cancelled` included, so a phase closed by the candidate
// leaving the pipeline is still reachable rather than silently absent from every tab.
const BUCKETS: EvaluationStatus[] = ['waiting', 'approved', 'rejected', 'cancelled'];

export const EvaluationPhaseQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { phaseId = '' } = useParams();
  const [sp, setSp] = useSearchParams();

  const status = (sp.get('status') ?? 'waiting') as EvaluationStatus;
  // The phase comes from the route and the status from the tab strip, so the bar carries only the
  // rest. Every value round-trips through the URL: deep-linkable, refresh-safe.
  const filters: EvaluationFiltersState = {
    search: sp.get('q') ?? '',
    applicantId: sp.get('applicant') ?? '',
    applicantLabel: sp.get('al') ?? '',
    branchId: readList(sp, 'branch'),
    createdFrom: sp.get('cf') ?? '',
    createdTo: sp.get('ct') ?? '',
  };
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

  const changeFilters = (nf: EvaluationFiltersState): void =>
    patch({
      applicant: nf.applicantId || null,
      al: nf.applicantLabel || null,
      q: nf.search || null,
      branch: writeList(nf.branchId),
      cf: nf.createdFrom || null,
      ct: nf.createdTo || null,
    });

  // Keyed on the whole query string, so every filter is part of the React Query key and two
  // different filter sets can never share a cache entry.
  const paramsKey = sp.toString();
  const params = useMemo(
    () => ({
      page,
      pageSize,
      phaseId,
      status,
      applicantId: filters.applicantId,
      search: filters.search,
      branchId: filters.branchId,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      sortBy: 'createdAt',
      sortDir: 'desc' as const,
    }),
    [paramsKey, page, pageSize, phaseId, status],
  );
  const { data, isLoading, isError, error, refetch } = useEvaluations(params);
  const rows = data?.items ?? [];

  const rowIds = useMemo(() => rows.map((e) => e.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [resultFor, setResultFor] = useState<EvaluationDto | null>(null);
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
    // RW9 — an individual phase is worked one applicant at a time: the result document and the
    // decision are recorded right here, without a detour through the detail page.
    ...(phase?.kind === 'individual'
      ? [
          {
            key: 'actions',
            header: '',
            align: 'end' as const,
            render: (e: EvaluationDto) => (
              <Button
                size="sm"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  setResultFor(e);
                }}
              >
                {t('evaluations.result.open')}
              </Button>
            ),
          },
        ]
      : []),
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
        // Only a BATCH phase offers batch generation — Medical Check is individual (RW9).
        actions={
          phase?.kind === 'batch' ? (
            <>
              <Button variant="secondary" onClick={() => navigate('/evaluation-batches')}>
                {t('batches.title')}
              </Button>
              <Can permission="evaluation.manage">
                <Button onClick={() => setBatchOpen(true)}>{t('batches.generate.open')}</Button>
              </Can>
            </>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <StageBuckets
          buckets={BUCKETS.map((b) => ({ key: b, label: t(`evaluations.status.${b}`), count: buckets[b] ?? 0 }))}
          active={status}
          onPick={(key) => patch({ status: key })}
        />

        <EvaluationFilters value={filters} onChange={changeFilters} />

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

      <RecordResultDialog
        evaluation={resultFor}
        appointmentEnabled={phase?.appointmentEnabled ?? false}
        open={resultFor !== null}
        onClose={() => setResultFor(null)}
      />

      <GenerateBatchDialog
        phaseId={phaseId}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onCreated={(batchId) => {
          setBatchOpen(false);
          navigate(`/evaluation-batches/${batchId}`);
        }}
      />
    </PageContainer>
  );
};
