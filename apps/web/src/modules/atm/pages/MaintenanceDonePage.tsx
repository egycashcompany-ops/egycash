// /atm/maintenance/done — the legacy /atm_maintenance_done page (atm_maintenance_done.ejs) by
// parity: the replenishment done page's shape plus the maintenance facts (service, notes,
// reference), with the same visible reopen the done icon's double-click performed.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type AtmMaintenanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { RowActions } from '../../../shared/ui/RowActions';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import { useDoneAtmMaintenances, useReopenAtmMaintenance } from '../api/atm-queries';
import { cairoToday, formatDuration } from '../lib/operation-view';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { DoneRangeBar } from '../components/DoneRangeBar';

export const MaintenanceDonePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const from = sp.get('from') ?? cairoToday();
  const to = sp.get('to') ?? from;
  const params = useMemo(() => ({ from, to, pageSize: MAX_PAGE_SIZE }), [from, to]);
  const list = useDoneAtmMaintenances(params);
  const reopen = useReopenAtmMaintenance();
  const [reopening, setReopening] = useState<AtmMaintenanceDto | null>(null);

  const setRange = (next: { from: string; to: string }): void => {
    const nextParams = new URLSearchParams(sp);
    nextParams.set('from', next.from);
    nextParams.set('to', next.to);
    setSp(nextParams);
  };

  const confirmReopen = async (): Promise<void> => {
    if (reopening === null) return;
    try {
      await reopen.mutateAsync({ id: reopening.id, version: reopening.version });
      toast.success(t('atm.done.reopened'));
      setReopening(null);
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const columns: Column<AtmMaintenanceDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.machineName },
    {
      key: 'service',
      header: t('atm.maintenance.serviceType'),
      render: (row) => row.serviceType ?? '—',
    },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
    {
      key: 'opened',
      header: t('atm.common.openTime'),
      render: (row) => formatDateTime(row.openedAt, locale),
    },
    {
      key: 'closed',
      header: t('atm.common.closeTime'),
      render: (row) => (row.closedAt === null ? '—' : formatDateTime(row.closedAt, locale)),
    },
    {
      key: 'duration',
      header: t('atm.common.takenTime'),
      render: (row) => (row.closedAt === null ? '—' : formatDuration(row.openedAt, row.closedAt)),
    },
    { key: 'notes', header: t('atm.maintenance.notes'), render: (row) => row.notes ?? '—' },
    {
      key: 'reference',
      header: t('atm.maintenance.referenceNumber'),
      render: (row) => row.referenceNumber ?? '—',
    },
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    { key: 'closedBy', header: t('atm.common.closedBy'), render: (row) => row.closedByName ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) =>
        can('atmMaintenance.complete') ? (
          <RowActions>
            <Button
              size="icon"
              variant="ghost-warning"
              title={t('atm.done.reopen')}
              onClick={() => setReopening(row)}
            >
              ↩
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('atm.done.maintTitle')} />
      <DoneRangeBar from={from} to={to} onChange={setRange} />
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.done.empty')}
      />
      <ConfirmActionDialog
        open={reopening !== null}
        title={t('atm.done.reopenTitle')}
        body={t('atm.done.reopenBody', { code: reopening?.machineCode ?? '' })}
        confirmLabel={t('atm.done.reopen')}
        busy={reopen.isPending}
        onConfirm={() => void confirmReopen()}
        onClose={() => setReopening(null)}
      />
    </PageContainer>
  );
};
