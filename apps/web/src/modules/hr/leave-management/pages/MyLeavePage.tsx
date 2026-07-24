// My Leave — the self-service home (frozen design §11): balance cards, my requests, and the
// request wizard. Requires a login linked to an employee record; HR users without one see the
// guidance note instead.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { PlusIcon } from '../../../../shared/ui/icons';
import { useLeaveRequests } from '../api/leave-queries';
import { BalanceCards } from '../components/BalanceCards';
import { RequestsTable } from '../components/RequestsTable';
import { RequestLeaveDialog } from '../components/RequestLeaveDialog';

const Shortcut = ({ to, label }: { to: string; label: string }): JSX.Element => (
  <Link
    to={to}
    className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  >
    {label}
  </Link>
);

export const MyLeavePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const employeeId = useAppSelector((state) => state.auth.me?.employeeId ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const params = useMemo(() => ({ page: 1, pageSize: 50, sortBy: 'createdAt', sortDir: 'desc' }), []);
  const { data, isLoading, isError, refetch } = useLeaveRequests(params);

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.my.title')}
        description={t('leave.my.subtitle')}
        breadcrumbs={[{ label: t('leave.module.title') }, { label: t('leave.my.title') }]}
        actions={
          employeeId !== null ? (
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setDialogOpen(true)}>
              {t('leave.actions.request')}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Shortcut to="/leave/approvals" label={t('leave.approvals.title')} />
        {can('leave.view') && <Shortcut to="/leave/calendar" label={t('leave.calendar.title')} />}
        {can('leave.view') && <Shortcut to="/leave/requests" label={t('leave.all.title')} />}
        {can('leave.manageTypes') && <Shortcut to="/leave/types" label={t('leave.types.title')} />}
        {can('workCalendar.manage') && <Shortcut to="/leave/holidays" label={t('leave.holidays.title')} />}
      </div>
      {employeeId === null ? (
        <EmptyState title={t('leave.my.noEmployee')} description={t('leave.my.noEmployeeHint')} />
      ) : (
        <div className="space-y-6">
          <BalanceCards employeeId={employeeId} />
          <RequestsTable
            rows={data?.items ?? []}
            loading={isLoading}
            error={isError}
            onRetry={() => void refetch()}
            empty={<EmptyState title={t('leave.my.empty')} />}
          />
          <RequestLeaveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} employeeId={employeeId} />
        </div>
      )}
    </PageContainer>
  );
};
