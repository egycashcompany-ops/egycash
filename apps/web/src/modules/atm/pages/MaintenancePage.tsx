// /atm/maintenance — the legacy /atm_maintenance page (atm_maintenance.ejs) by parity. The same
// two-group grid as replenishments, with the maintenance-only facts: service type, notes,
// reference number, and a CLOSE that requires assigning an employee (the modal). Rows can also
// arrive from an accepted mail ticket — the badge names that source.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type AtmMaintenanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { BulkActionBar } from '../../../shared/ui/BulkActionBar';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { RowActions } from '../../../shared/ui/RowActions';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, LockIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import {
  useAtmMaintenanceFacets,
  useDeleteAtmMaintenances,
  useOpenAtmMaintenancesList,
} from '../api/atm-queries';
import { isOpenedToday } from '../lib/operation-view';
import { LiveTimerCell, useNowTick } from '../components/LiveTimer';
import { OpenMaintenancesForm } from '../components/OpenMaintenancesForm';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { CloseMaintenanceDialog, EditMaintenanceDialog } from '../components/MaintenanceDialogs';

export const MaintenancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const banks = useMemo(() => (sp.get('banks') ?? '').split(',').filter(Boolean), [sp]);
  const areas = useMemo(() => (sp.get('areas') ?? '').split(',').filter(Boolean), [sp]);

  const setFilter = (key: 'banks' | 'areas', values: string[]): void => {
    const next = new URLSearchParams(sp);
    if (values.length === 0) next.delete(key);
    else next.set(key, values.join(','));
    setSp(next);
  };

  const listParams = useMemo(
    () => ({
      pageSize: MAX_PAGE_SIZE,
      ...(banks.length > 0 ? { banks: banks.join(',') } : {}),
      ...(areas.length > 0 ? { areas: areas.join(',') } : {}),
    }),
    [banks, areas],
  );
  const list = useOpenAtmMaintenancesList(listParams);
  const facets = useAtmMaintenanceFacets(banks);

  const now = useNowTick();
  const rows = list.data?.items ?? [];
  const todayRows = rows.filter((row) => isOpenedToday(row.openedAt, now));
  const otherRows = rows.filter((row) => !isOpenedToday(row.openedAt, now));

  const selection = useTableSelection(todayRows.map((row) => row.id));
  const remove = useDeleteAtmMaintenances();

  const [closing, setClosing] = useState<AtmMaintenanceDto[] | null>(null);
  const [deleting, setDeleting] = useState<AtmMaintenanceDto[] | null>(null);
  const [editing, setEditing] = useState<AtmMaintenanceDto[] | null>(null);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = selection.ids
    .map((id) => byId.get(id))
    .filter((row): row is AtmMaintenanceDto => row !== undefined);

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.map((row) => row.id));
      toast.success(t('atm.common.deleted'));
      selection.clear();
      setDeleting(null);
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const baseColumns: Column<AtmMaintenanceDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.machineName },
    {
      key: 'service',
      header: t('atm.maintenance.serviceType'),
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.serviceType ?? '—'}
          {row.source === 'mail' && (
            <StatusBadge tone="info" label={t('atm.maintenance.fromMail')} />
          )}
        </span>
      ),
    },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
    {
      key: 'opened',
      header: t('atm.common.openTime'),
      render: (row) => formatDateTime(row.openedAt, locale),
    },
  ];

  const tailColumns: Column<AtmMaintenanceDto>[] = [
    { key: 'notes', header: t('atm.maintenance.notes'), render: (row) => row.notes ?? '—' },
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    {
      key: 'reference',
      header: t('atm.maintenance.referenceNumber'),
      render: (row) => row.referenceNumber ?? '—',
    },
    { key: 'addedBy', header: t('atm.common.addedBy'), render: (row) => row.openedByName ?? '—' },
  ];

  const actionsColumn = (withClose: boolean): Column<AtmMaintenanceDto> => ({
    key: 'actions',
    header: '',
    align: 'end',
    render: (row) => (
      <RowActions>
        {withClose && can('atmMaintenance.complete') && (
          <Button
            size="icon"
            variant="ghost-brand"
            title={t('atm.common.close')}
            onClick={() => setClosing([row])}
          >
            <LockIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmMaintenance.edit') && (
          <Button
            size="icon"
            variant="ghost"
            title={t('atm.common.edit')}
            onClick={() => setEditing([row])}
          >
            <EditIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmMaintenance.delete') && (
          <Button
            size="icon"
            variant="ghost-danger"
            title={t('atm.common.delete')}
            onClick={() => setDeleting([row])}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        )}
      </RowActions>
    ),
  });

  const todayColumns: Column<AtmMaintenanceDto>[] = [
    ...baseColumns,
    {
      key: 'timer',
      header: t('atm.common.takenTime'),
      render: (row) => <LiveTimerCell openedAt={row.openedAt} now={now} />,
    },
    ...tailColumns,
    actionsColumn(true),
  ];
  const carriedColumns: Column<AtmMaintenanceDto>[] = [
    ...baseColumns,
    ...tailColumns,
    actionsColumn(false),
  ];

  return (
    <PageContainer>
      <PageHeader title={t('atm.maintenance.title')} description={t('atm.maintenance.subtitle')} />

      {can('atmMaintenance.create') && <OpenMaintenancesForm />}

      <div className="mb-4 flex flex-wrap gap-2">
        <MultiSelect
          label={t('atm.common.bank')}
          options={(facets.data?.banks ?? []).map((b) => ({ value: b, label: b }))}
          value={banks}
          onChange={(next) => setFilter('banks', next)}
        />
        <MultiSelect
          label={t('atm.common.area')}
          options={(facets.data?.areas ?? []).map((a) => ({ value: a, label: a }))}
          value={areas}
          onChange={(next) => setFilter('areas', next)}
        />
      </div>

      <BulkActionBar count={selection.count} onClear={selection.clear}>
        {can('atmMaintenance.complete') && (
          <Button variant="secondary" onClick={() => setClosing(selectedRows)}>
            {t('atm.common.closeSelected')}
          </Button>
        )}
        {can('atmMaintenance.edit') && (
          <Button variant="secondary" onClick={() => setEditing(selectedRows)}>
            {t('atm.common.editSelected')}
          </Button>
        )}
        {can('atmMaintenance.delete') && (
          <Button variant="danger" onClick={() => setDeleting(selectedRows)}>
            {t('atm.common.deleteSelected')}
          </Button>
        )}
      </BulkActionBar>

      <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
        {t('atm.replenishments.todayGroup')}
      </h2>
      <DataTable
        columns={todayColumns}
        rows={todayRows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.maintenance.emptyToday')}
        selection={selection}
      />

      {otherRows.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t('atm.replenishments.carriedGroup')}
          </h2>
          <div className="opacity-75">
            <DataTable
              columns={carriedColumns}
              rows={otherRows}
              rowKey={(row) => row.id}
              empty={t('atm.maintenance.emptyToday')}
            />
          </div>
        </>
      )}

      <CloseMaintenanceDialog
        open={closing !== null}
        rows={closing ?? []}
        onClose={() => {
          setClosing(null);
          selection.clear();
        }}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={t('atm.common.deleteTitle')}
        body={t('atm.common.deleteBody', { count: deleting?.length ?? 0 })}
        confirmLabel={t('atm.common.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
      <EditMaintenanceDialog
        open={editing !== null}
        rows={editing ?? []}
        onClose={() => {
          setEditing(null);
          selection.clear();
        }}
      />
    </PageContainer>
  );
};
