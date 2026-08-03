// Interview queue: filters (status, outcome, stage, applicant, scheduled-date range), a sortable
// DataTable, pagination, and a schedule entry point — all permission-gated. Filters/sort/pagination
// are synchronized with the URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type InterviewDto, type Locale } from '@ecms/contracts';
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
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDateTime, formatNumber, localized } from '../../../../../shared/lib/format';
import { InterviewStatusBadge } from '../components/InterviewStatusBadge';
import { InterviewFilters, type InterviewFiltersState } from '../components/InterviewFilters';
import { ScheduleInterviewDialog, type PickedApplicant } from '../components/ScheduleInterviewDialog';
import { PhaseBoard } from '../components/PhaseBoard';
import { useBulkInterviews, useInterviews } from '../api/interview-queries';
import { type InterviewListParams } from '../api/interview-api';

const DEFAULT_PAGE_SIZE = 25;

export const InterviewQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<PickedApplicant | null>(null);
  const view = sp.get('view') === 'board' ? 'board' : 'list';

  const filters: InterviewFiltersState = {
    status: (sp.get('status') ?? '') as InterviewFiltersState['status'],
    outcome: (sp.get('outcome') ?? '') as InterviewFiltersState['outcome'],
    stageId: sp.get('stage') ?? '',
    applicantId: sp.get('applicant') ?? '',
    applicantLabel: sp.get('al') ?? '',
    search: sp.get('q') ?? '',
    interviewerId: sp.get('interviewer') ?? '',
    interviewerLabel: sp.get('il') ?? '',
    branchId: sp.get('branch') ?? '',
    scheduledFrom: sp.get('sf') ?? '',
    scheduledTo: sp.get('st') ?? '',
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'scheduledAt:asc').split(':');
  const sort = { by: sortByRaw ?? 'scheduledAt', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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

  const changeFilters = (nf: InterviewFiltersState): void =>
    patch({
      status: nf.status || null,
      outcome: nf.outcome || null,
      stage: nf.stageId || null,
      applicant: nf.applicantId || null,
      al: nf.applicantLabel || null,
      q: nf.search || null,
      interviewer: nf.interviewerId || null,
      il: nf.interviewerLabel || null,
      branch: nf.branchId || null,
      sf: nf.scheduledFrom || null,
      st: nf.scheduledTo || null,
    });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<InterviewListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      status: filters.status,
      outcome: filters.outcome,
      stageId: filters.stageId,
      applicantId: filters.applicantId,
      search: filters.search,
      interviewerId: filters.interviewerId,
      branchId: filters.branchId,
      scheduledFrom: filters.scheduledFrom,
      scheduledTo: filters.scheduledTo,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useInterviews(params);
  const rows = data?.items ?? [];

  // Bulk cancel (RW17). Pass/fail is deliberately NOT offered in bulk: a round can only be
  // decided once every panel member has submitted or been skipped, which is a per-round fact
  // the queue cannot show — so the decision stays on the round's own page.
  const rowIds = useMemo(() => rows.map((i) => i.id), [rows]);
  const selection = useTableSelection(rowIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const bulk = useBulkInterviews(() => {
    selection.clear();
    setCancelOpen(false);
    setReason('');
  });
  const cancellable = rows
    .filter((i) => selection.selectedIds.has(i.id) && (i.status === 'scheduled' || i.status === 'inProgress'))
    .map((i) => i.id);

  const columns: Column<InterviewDto>[] = [
    {
      key: 'applicant',
      header: t('interviews.columns.applicant'),
      render: (i) => <span>{i.applicantName} <span className="font-mono text-xs text-slate-500" dir="ltr">{i.applicantCode}</span></span>,
    },
    {
      key: 'stageOrder',
      header: t('interviews.columns.stage'),
      sortable: true,
      render: (i) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-700 dark:text-slate-200">{localized(i.stageName, locale)}</span>
          <span className="text-xs text-slate-400">#{formatNumber(i.stageOrder, locale)}</span>
        </span>
      ),
    },
    { key: 'status', header: t('interviews.columns.status'), render: (i) => <InterviewStatusBadge status={i.status} outcome={i.outcome} /> },
    { key: 'panel', header: t('interviews.columns.panel'), align: 'center', render: (i) => formatNumber(i.panel.length, locale) },
    { key: 'scheduledAt', header: t('interviews.columns.scheduled'), sortable: true, render: (i) => formatDateTime(i.scheduledAt, locale) },
    { key: 'createdAt', header: t('interviews.columns.created'), sortable: true, render: (i) => formatDateTime(i.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.interviews')}
        description={t('interviews.queue.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.interviews') }]}
        actions={
          <div className="flex items-center gap-2">
            {/* List ⇄ Phases (Kanban) toggle, persisted in the URL. */}
            <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'list'}
                onClick={() => patch({ view: null }, false)}
                className={
                  view === 'list'
                    ? 'rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }
              >
                {t('interviews.view.list')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'board'}
                onClick={() => patch({ view: 'board' }, false)}
                className={
                  view === 'board'
                    ? 'rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }
              >
                {t('interviews.view.board')}
              </button>
            </div>
            <Can permission="interviewStage.manage">
              <Button size="sm" variant="ghost" onClick={() => navigate('stages')}>
                {t('interviews.stages.title')}
              </Button>
            </Can>
            <Can permission="interview.create">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => { setScheduleFor(null); setScheduleOpen(true); }}>
                {t('interviews.actions.schedule')}
              </Button>
            </Can>
          </div>
        }
      />

      {view === 'board' ? (
        <PhaseBoard />
      ) : (
        <div className="space-y-4">
          <InterviewFilters value={filters} onChange={changeFilters} />
          <Can permission="interview.cancel">
            <BulkActionBar count={selection.count} onClear={selection.clear}>
              <Button
                size="sm"
                variant="danger"
                disabled={cancellable.length === 0}
                onClick={() => setCancelOpen(true)}
              >
                {t('interviews.actions.cancelSelected')}
              </Button>
            </BulkActionBar>
          </Can>
          <DataTable
            selection={selection}
            columns={columns}
            rows={rows}
            rowKey={(i) => i.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sort}
            onSortChange={changeSort}
            onRowClick={(i) => navigate(i.id)}
          />
          {data !== undefined && data.meta.totalItems > 0 && (
            <Pagination
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          )}
        </div>
      )}

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

      <ScheduleInterviewDialog
        open={scheduleOpen}
        onClose={() => { setScheduleOpen(false); setScheduleFor(null); }}
        {...(scheduleFor === null ? {} : { applicant: scheduleFor })}
      />
    </PageContainer>
  );
};
