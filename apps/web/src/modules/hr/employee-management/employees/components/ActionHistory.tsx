// The employment history — the applied/scheduled Personnel Actions, newest first (the action
// log IS the history; the profile shows the current snapshot). Scheduled actions can be
// cancelled before they apply (append-only). Salary-bearing entries arrive redacted for
// callers without employee.viewCompensation (`redacted`).
import { type EmployeeActionDto, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { Button } from '../../../../../shared/ui/Button';
import { formatDate } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useCancelEmployeeAction, useEmployeeActions } from '../api/employee-queries';

const STATUS_TONE: Record<EmployeeActionDto['status'], Tone> = {
  scheduled: 'info',
  applied: 'success',
  cancelled: 'neutral',
  failed: 'danger',
  pendingApproval: 'warning',
};

export const ActionHistory = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading, isError, error, refetch } = useEmployeeActions(employee.id, {
    page: 1,
    pageSize: 50,
  });
  const cancel = useCancelEmployeeAction(employee.id);

  const onCancel = async (action: EmployeeActionDto): Promise<void> => {
    try {
      await cancel.mutateAsync({ actionId: action.id, body: { version: employee.version } });
      toast.success(t('employees.actions.cancelled'));
    } catch {
      // surfaced globally
    }
  };

  const columns: Column<EmployeeActionDto>[] = [
    {
      key: 'seq',
      header: '#',
      render: (a) => <span className="font-mono text-xs text-slate-400">{a.seq}</span>,
    },
    {
      key: 'type',
      header: t('employees.history.type'),
      render: (a) => (
        <span>
          {t(`employees.actionType.${a.type}`)}
          {a.redacted && (
            <span className="ms-2 text-xs text-slate-400">{t('employees.compensation.hidden')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('employees.history.status'),
      render: (a) => <StatusBadge tone={STATUS_TONE[a.status]} label={t(`employees.actionStatus.${a.status}`)} />,
    },
    {
      key: 'effectiveDate',
      header: t('employees.actions.effectiveDate'),
      render: (a) => formatDate(a.effectiveDate, locale),
    },
    {
      key: 'reason',
      header: t('employees.actions.reason'),
      render: (a) => <span className="text-xs text-slate-500">{a.reason ?? a.failureReason ?? '—'}</span>,
    },
    {
      key: 'cancel',
      header: '',
      render: (a) =>
        a.status === 'scheduled' ? (
          <Can permission="employee.manageActions">
            <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => void onCancel(a)}>
              {t('common.cancel')}
            </Button>
          </Can>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data?.items ?? []}
      rowKey={(a) => a.id}
      loading={isLoading}
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
    />
  );
};
