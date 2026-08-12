// The regularization queue (AT-6, §7) — the Leave approvals-inbox shape, deliberately: a worklist
// tab fed by `/pending-decisions` (my direct reports' MANAGER step, plus the HR step within my
// scope), and an "all" tab fed by the scoped list. Approving at the manager step advances to
// pendingHr, never to approved; the server enforces that, and no button here can bypass it.
import { useState } from 'react';
import { type AttendanceRegularizationStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState, Pagination } from '../../../../shared/ui';
import { Field, Select } from '../../../../shared/ui/form';
import { RegularizationsTable } from '../components/RegularizationsTable';
import { usePendingRegularizations, useRegularizations } from '../api/attendance-queries';

const TABS = ['queue', 'all'] as const;
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
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const pending = usePendingRegularizations();
  const all = useRegularizations(
    { page, pageSize: 25, ...(status === '' ? {} : { status }) },
    tab === 'all' && can('attendance.decideRegularization'),
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
