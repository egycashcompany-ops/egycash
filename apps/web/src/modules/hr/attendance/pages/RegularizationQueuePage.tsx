// The regularization queue (AT-6, §7) — the Leave approvals-inbox shape, deliberately: a worklist
// tab fed by `/pending-decisions` (my direct reports' MANAGER step, plus the HR step within my
// scope), and an "all" tab fed by the scoped list. Approving at the manager step advances to
// pendingHr, never to approved; the server enforces that, and no button here can bypass it.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AttendanceRegularizationStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState, Pagination } from '../../../../shared/ui';
import { Field, Select } from '../../../../shared/ui/form';
import { RegularizationsTable } from '../components/RegularizationsTable';
import { usePendingRegularizations, useRegularizations } from '../api/attendance-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['status'] as const;

const TABS = ['queue', 'all', 'postFreeze'] as const;
type Tab = (typeof TABS)[number];

const STATUSES: AttendanceRegularizationStatus[] = [
  'pendingManager',
  'pendingHr',
  'approved',
  'rejected',
  'cancelled',
];

export const RegularizationQueuePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('queue');
  // The filters live in the URL so the screen is shareable and survives a reload — and so the
  // remembered-filters hook has something to remember. Written with `replace`, because narrowing a
  // list is a view of this screen rather than a place to go Back to.
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next, { replace: true });
  };

  const status = sp.get('status') ?? '';
  const setStatus = (value: string): void => patch({ status: value });
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);

  const pending = usePendingRegularizations();
  const all = useRegularizations(
    { page, pageSize: 25, ...(status === '' ? {} : { status }) },
    tab === 'all' && can('attendance.decideRegularization'),
  );
  /**
   * The post-freeze corrections (P-HR-08).
   *
   * These are approved requests whose day was already frozen, so the row did NOT move and the
   * month was already paid. The stamp has existed since AT-5 and nothing could list it — which
   * made the one case that needs a human the one case nobody could see. This tab is that list.
   */
  const corrections = useRegularizations(
    { page, pageSize: 25, postFreeze: 'true' },
    tab === 'postFreeze' && can('attendance.decideRegularization'),
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.queue.title')}
        description={t('attendance.queue.subtitle')}
        breadcrumbs={[
          { label: t('attendance.module.title') },
          { label: t('attendance.queue.title') },
        ]}
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === key
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`attendance.queue.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <RegularizationsTable
          rows={pending.data ?? []}
          loading={pending.isLoading}
          error={pending.isError ? pending.error : undefined}
          onRetry={() => void pending.refetch()}
          showEmployee
          showDecisions
          empty={<EmptyState title={t('attendance.queue.empty')} />}
        />
      ) : tab === 'postFreeze' ? (
        <div className="space-y-4">
          {/*
            Said out loud, because the screen must not imply an action it does not have. The day
            is frozen and the month is paid; there is no button here that could change either.
            What a correction is WORTH is not derivable from anything in this system — see the
            P-HR-08 design note — so the forward payment stays a decision somebody records by hand
            as a payroll adjustment in a later, open month.
          */}
          <p
            role="note"
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('attendance.queue.postFreezeHint')}
          </p>
          <RegularizationsTable
            rows={corrections.data?.items ?? []}
            loading={corrections.isLoading}
            error={corrections.isError ? corrections.error : undefined}
            onRetry={() => void corrections.refetch()}
            showEmployee
            showDecisions
            empty={<EmptyState title={t('attendance.queue.emptyPostFreeze')} />}
          />
          {corrections.data !== undefined && (
            <Pagination meta={corrections.data.meta} onPageChange={setPage} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="max-w-xs">
            <Field label={t('attendance.reg.status')}>
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label={t('attendance.reg.status')}
              >
                <option value="">{t('attendance.queue.allStatuses')}</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`attendance.regStatus.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <RegularizationsTable
            rows={all.data?.items ?? []}
            loading={all.isLoading}
            error={all.isError ? all.error : undefined}
            onRetry={() => void all.refetch()}
            showEmployee
            showDecisions
            empty={<EmptyState title={t('attendance.queue.emptyAll')} />}
          />
          {all.data !== undefined && <Pagination meta={all.data.meta} onPageChange={setPage} />}
        </div>
      )}
    </PageContainer>
  );
};
