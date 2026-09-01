// The rows a round opened — who is being reviewed, by whom, and where each one stands
// (P-HR-PRF D4, D5, D6, D15).
//
// THIS SCREEN READS AND ASSIGNS, AND THAT IS ALL IT DOES IN THIS PHASE. There is no rating field,
// no submit and no finalize here, because none of them exists on the server yet (P4). Rendering an
// input for an assessment nothing can store would be a screen that loses somebody's work.
//
// THE UNASSIGNED FILTER IS THE POINT OF THE SCREEN TODAY. Opening a round leaves a row without an
// evaluator wherever the org chart had a hole, and those rows are the ones nobody will otherwise
// find — they look exactly like every other row until the day the round cannot close.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type EmployeeDto, type Locale, type PerformanceReviewDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { SearchInput } from '../../../../shared/ui';
import { StatusBadge, type Tone } from '../../../../shared/ui/Badge';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { Dialog } from '../../../../shared/ui/Dialog';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { buildQuery, getPage } from '../../../../shared/lib/api-client';
import {
  useAssignPerformanceEvaluator,
  usePerformanceCycles,
  usePerformanceReviews,
} from '../api/performance-queries';
import { GoalsDialog } from '../components/GoalsDialog';
import { AssessmentDialog } from '../components/AssessmentDialog';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
  'status',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** Enough characters to mean something. One letter matches most of the company. */
const MIN_QUERY = 2;

const STATUS_TONE: Record<PerformanceReviewDto['status'], Tone> = {
  draft: 'neutral',
  submitted: 'info',
  finalized: 'success',
  excused: 'warning',
};

/** Naming the evaluator (D4) — the one write this phase ships on a review. */
const AssignDialog = ({
  review,
  onClose,
}: {
  review: PerformanceReviewDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const assign = useAssignPerformanceEvaluator();
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<{ id: string; code: string; name: string } | null>(null);

  // A SEARCH BOX RATHER THAN A DROPDOWN, for the reason the nomination dialog records: the list is
  // the company, and a select loaded from one page answers «which of the ones that happened to be
  // fetched» while quietly hiding everybody else.
  const search = useQuery({
    queryKey: ['employees', 'picker', term.trim()],
    enabled: term.trim().length >= MIN_QUERY,
    queryFn: () =>
      getPage<EmployeeDto>(
        `/hr/employees${buildQuery({ search: term.trim(), page: 1, pageSize: 10 })}`,
      ),
    staleTime: 30_000,
  });
  const results = search.data?.items ?? [];

  const submit = async (): Promise<void> => {
    if (chosen === null) return;
    try {
      await assign.mutateAsync({
        id: review.id,
        body: { evaluatorId: chosen.id, version: review.version },
      });
      toast.success(t('performance.review.evaluatorAssigned'));
      onClose();
    } catch {
      // surfaced globally — including «nobody reviews themselves», which is D5 arriving as a message
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('performance.review.assignEvaluator')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={assign.isPending}
            disabled={chosen === null}
            onClick={() => void submit()}
          >
            {t('performance.review.assign')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${review.employeeName} · ${review.employeeCode}`}
      </p>
      <Field label={t('performance.review.evaluator')} required>
        {chosen === null ? (
          <div className="space-y-2">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('performance.review.evaluatorSearch')}
            />
            {results.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                {results.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => {
                        setChosen({ id: row.id, code: row.code, name: row.personal.fullNameAr });
                        setTerm('');
                      }}
                    >
                      <span>{row.personal.fullNameAr}</span>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {row.code}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <span className="text-slate-700 dark:text-slate-200">{chosen.name}</span>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="ms-2 text-xs text-brand-600 hover:underline"
            >
              {t('offers.form.change')}
            </button>
          </span>
        )}
      </Field>
    </Dialog>
  );
};

export const PerformanceReviewsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [assigning, setAssigning] = useState<PerformanceReviewDto | null>(null);
  const [viewingGoals, setViewingGoals] = useState<PerformanceReviewDto | null>(null);
  const [assessing, setAssessing] = useState<PerformanceReviewDto | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const params = {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    ...(search === '' ? {} : { search }),
    ...(status === '' ? {} : { status }),
  };
  const { data, isLoading, isError, error, refetch } = usePerformanceReviews(params);

  // The rounds, for their SCALES (D8). A review's rating is a point on its cycle's scale, and the
  // dialog cannot ask the row — the row carries the number, not the ruler it was measured with.
  const cycles = usePerformanceCycles({ page: 1, pageSize: 100 });
  const cycleOf = (review: PerformanceReviewDto) =>
    cycles.data?.items.find((c) => c.id === review.cycleId);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<PerformanceReviewDto>[] = [
    {
      key: 'employee',
      header: t('performance.review.employee'),
      render: (r) => (
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {r.employeeName}
          </span>
          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {r.employeeCode}
          </span>
        </div>
      ),
    },
    {
      key: 'cycle',
      header: t('performance.cycle.title'),
      // The row's OWN copy of the round's name (D7), not a lookup.
      render: (r) => <span>{locale === 'ar' ? r.cycleName.ar : r.cycleName.en}</span>,
    },
    {
      key: 'evaluator',
      header: t('performance.review.evaluator'),
      render: (r) =>
        r.evaluatorName === null ? (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('performance.review.noEvaluator')}
          </span>
        ) : (
          <span className="text-sm">{r.evaluatorName}</span>
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <StatusBadge
          tone={STATUS_TONE[r.status]}
          label={t(`performance.review.status.${r.status}`)}
        />
      ),
    },
    {
      // Shown, and EMPTY until P4 — a review has a rating only once somebody has made one. An
      // em-dash rather than a zero: zero is a point on some scales, and a placeholder that reads as
      // a rating is the module's characteristic failure in miniature.
      key: 'rating',
      header: t('performance.review.rating'),
      render: (r) => <span dir="ltr">{r.rating === null ? '—' : r.rating}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex justify-end gap-2">
          {/* Goals ride the review row (P3): the row already answers «whose, which round». Gated
              by the goal's own read key, not the cycle's — different audiences (see hr.module). */}
          <Can permission="performanceGoal.view">
            <Button size="sm" variant="secondary" onClick={() => setViewingGoals(r)}>
              {t('performance.goal.title')}
            </Button>
          </Can>
          {/* Open to anybody who may READ the review: the dialog itself shows the evaluator's
              half or HR's half by permission, and a closed review renders read-only. Gating this
              button on a write key would hide a finalized assessment from the people entitled to
              read it. */}
          <Button size="sm" variant="secondary" onClick={() => setAssessing(r)}>
            {t('performance.review.assessment')}
          </Button>
          <Can permission="performanceCycle.conduct">
            {r.status === 'draft' && (
              <Button size="sm" variant="secondary" onClick={() => setAssigning(r)}>
                {t('performance.review.assignEvaluator')}
              </Button>
            )}
          </Can>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('performance.review.title')}
        description={t('performance.review.subtitle')}
        breadcrumbs={[{ label: t('performance.title') }, { label: t('performance.review.title') }]}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
              placeholder={t('performance.review.searchPlaceholder')}
            />
          </div>
          <Select
            value={status}
            onChange={(e) => patch({ status: e.target.value, page: null })}
            aria-label={t('common.status')}
          >
            <option value="">{t('common.all')}</option>
            <option value="draft">{t('performance.review.status.draft')}</option>
            <option value="submitted">{t('performance.review.status.submitted')}</option>
            <option value="finalized">{t('performance.review.status.finalized')}</option>
            <option value="excused">{t('performance.review.status.excused')}</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {assigning !== null && <AssignDialog review={assigning} onClose={() => setAssigning(null)} />}
      {viewingGoals !== null && (
        <GoalsDialog review={viewingGoals} onClose={() => setViewingGoals(null)} />
      )}
      {assessing !== null && (
        <AssessmentDialog
          review={assessing}
          cycle={cycleOf(assessing)}
          onClose={() => setAssessing(null)}
        />
      )}
    </PageContainer>
  );
};
