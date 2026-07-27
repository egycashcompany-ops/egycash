// One interview stage's own page (RW11): its queue, its buckets, its counters, its actions.
// The stage is addressed by the route, so the flat stage menu opens a complete workspace rather
// than a filtered view of a shared list.
//
// Buckets are the stage's OWN status enum (I10) — there is no second vocabulary — and the counts
// come from the same aggregated endpoint the navigation badge reads, so a tab and its badge can
// never disagree.
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type InterviewDto, type InterviewStatus, type Locale } from '@ecms/contracts';
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
import { InterviewStatusBadge } from '../components/InterviewStatusBadge';
import {
  useBulkInterviews,
  useBulkStartInterviews,
  useInterviews,
  useInterviewStages,
} from '../api/interview-queries';

const DEFAULT_PAGE_SIZE = 25;

/** The buckets this stage's page offers, in workflow order. `waiting` is the queue itself. */
const BUCKETS: InterviewStatus[] = ['waiting', 'scheduled', 'inProgress', 'completed', 'cancelled'];

export const InterviewStageQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { stageId = '' } = useParams();
  const [sp, setSp] = useSearchParams();

  const status = (sp.get('status') ?? 'waiting') as InterviewStatus;
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

  const { data: stages } = useInterviewStages();
  const stage = (stages ?? []).find((s) => s.id === stageId);

  const { data: counts } = useRecruitmentStageCounts();
  const buckets =
    counts?.stages.find((s) => s.refId === stageId && s.kind === 'interview')?.buckets ?? {};

  const params = useMemo(
    () => ({ page, pageSize, stageId, status, sortBy: 'scheduledAt', sortDir: 'asc' as const }),
    [page, pageSize, stageId, status],
  );
  const { data, isLoading, isError, error, refetch } = useInterviews(params);
  const rows = data?.items ?? [];

  const rowIds = useMemo(() => rows.map((i) => i.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulkStart = useBulkStartInterviews(() => selection.clear());
  const bulk = useBulkInterviews(() => {
    selection.clear();
    setCancelOpen(false);
    setReason('');
  });
  const cancellable = rows
    .filter((i) => selection.selectedIds.has(i.id) && (i.status === 'scheduled' || i.status === 'inProgress'))
    .map((i) => i.id);
  // "Start now" addresses APPLICANTS (RW12): the round may not exist yet, so the endpoint takes
  // the candidate and the stage, not an interview id.
  const startable = rows
    .filter((i) => selection.selectedIds.has(i.id) && (i.status === 'waiting' || i.status === 'scheduled'))
    .map((i) => i.applicantId);

  const columns: Column<InterviewDto>[] = [
    {
      key: 'applicant',
      header: t('interviews.columns.applicant'),
      render: (i) => (
        <span>
          {i.applicantName}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {i.applicantCode}
          </span>
        </span>
      ),
    },
    { key: 'status', header: t('interviews.columns.status'), render: (i) => <InterviewStatusBadge status={i.status} outcome={i.outcome} /> },
    {
      key: 'scheduledAt',
      header: t('interviews.columns.scheduled'),
      render: (i) => (i.scheduledAt === null ? '—' : formatDate(i.scheduledAt, locale)),
    },
    {
      key: 'panel',
      header: t('interviews.columns.panel'),
      align: 'center',
      render: (i) => i.panel.length,
    },
  ];

  if (stages === undefined) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={stage === undefined ? t('recruitment.nav.interviews') : localized(stage.name, locale)}
        description={t('interviews.stagePage.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.interviews'), to: '/interviews' },
          { label: stage === undefined ? '' : localized(stage.name, locale) },
        ]}
      />

      <div className="space-y-4">
        <StageBuckets
          buckets={BUCKETS.map((b) => ({ key: b, label: t(`interviews.status.${b}`), count: buckets[b] ?? 0 }))}
          active={status}
          onPick={(key) => patch({ status: key })}
        />

        <BulkActionBar count={selection.count} onClear={selection.clear}>
          {/* RW12 — start the round NOW for everyone still waiting at this stage. */}
          <Can permission="interview.create">
            <Button
              size="sm"
              loading={bulkStart.isPending}
              disabled={startable.length === 0}
              onClick={() =>
                void bulkStart.mutateAsync({ applicantIds: startable, stageId })
              }
            >
              {t('interviews.actions.startSelected')}
            </Button>
          </Can>
          <Can permission="interview.cancel">
            <Button
              size="sm"
              variant="danger"
              disabled={cancellable.length === 0}
              onClick={() => setCancelOpen(true)}
            >
              {t('interviews.actions.cancelSelected')}
            </Button>
          </Can>
        </BulkActionBar>

        <DataTable
          selection={selection}
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          onRowClick={(i) => navigate(`/interviews/${i.id}`)}
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
        title={t('interviews.actions.cancelSelected')}
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
              {t('interviews.actions.cancelSelected')}
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
