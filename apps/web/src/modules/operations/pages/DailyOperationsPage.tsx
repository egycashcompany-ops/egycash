// Daily operations (B2) — the replacement for the legacy `/main_ops` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §5.1, contad_app.js:253-300): the desk's working set for
// TODAY — daily shipments collected today, plus secured shipments due for delivery today that had
// already left the vault. It computed "today" server-side and offered no date picker at all.
//
// The membership rule is the SERVER's (`GET /operations/shipments/day-board`). This page asks for
// a day and renders the answer; it never unions two lists. What it does own is presentation: the
// eight filters, the descending row numbers, the cross-bank highlight — all in `lib/day-board.ts`
// as pure functions, because the legacy versions of them read rendered HTML (main_ops.ejs:995).
//
// ONE ADDITION over legacy: a date picker. The default is still today, so the legacy answer is
// the default answer; being able to look at yesterday is additive, not a changed rule.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type OperationsShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, EditIcon, PlusIcon, ResetIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatAmount } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import {
  useDeleteOperationsShipment,
  useOperationsBanks,
  useOperationsBankBranches,
  useOperationsCurrencies,
  useOperationsDayBoard,
  useSetShipmentReceived,
} from '../api/operations-queries';
import {
  EMPTY_DAY_BOARD_FILTERS,
  filterDayBoard,
  isCrossBank,
  isReceived,
  legacyRowNumber,
  totalsByCurrency,
  type DayBoardFilters,
} from '../lib/day-board';
import { ShipmentStatusBadge, ShipmentTypeBadge } from '../components/ShipmentBadges';
import { ShipmentFormDialog } from '../components/ShipmentFormDialog';

/** `?date=` empty means today, resolved by the server. */
export const resolveBoardDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

export const DailyOperationsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const date = resolveBoardDate(sp.get('date'));
  const board = useOperationsDayBoard(date);
  const banks = useOperationsBanks({ page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const branches = useOperationsBankBranches({ page: 1, pageSize: MAX_PAGE_SIZE });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });

  const setReceived = useSetShipmentReceived();
  const remove = useDeleteOperationsShipment();

  const [filters, setFilters] = useState<DayBoardFilters>(EMPTY_DAY_BOARD_FILTERS);
  const [editing, setEditing] = useState<OperationsShipmentDto | null>(null);
  const [creating, setCreating] = useState(false);

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const branchNameOf = (id: string): string =>
    branches.data?.items.find((branch) => branch.id === id)?.name ?? '';
  const currencyNameOf = (id: string): string =>
    currencies.data?.items.find((currency) => currency.id === id)?.name ?? '';

  const shipments = board.data?.shipments ?? [];
  const rows = useMemo(
    () => filterDayBoard(shipments, filters, bankNameOf, branchNameOf),
    [shipments, filters, banks.data, branches.data],
  );

  const setFilter = (patch: Partial<DayBoardFilters>): void =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const canEdit = can('operationsShipment.edit');
  const canDelete = can('operationsShipment.delete');
  const canComplete = can('operationsShipment.complete');

  const toggleReceived = async (shipment: OperationsShipmentDto): Promise<void> => {
    try {
      await setReceived.mutateAsync({
        id: shipment.id,
        received: !isReceived(shipment),
        body: { version: shipment.version },
      });
    } catch {
      toast.error(t('operations.shipment.receiveFailed'));
    }
  };

  const removeShipment = async (shipment: OperationsShipmentDto): Promise<void> => {
    // Destructive and not obviously reversible from this screen — always confirmed.
    if (!window.confirm(t('operations.shipment.confirmDelete'))) return;
    try {
      await remove.mutateAsync(shipment.id);
      toast.success(t('operations.shipment.deleted'));
    } catch {
      toast.error(t('operations.shipment.deleteFailed'));
    }
  };

  const iconButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800';

  const columns: Column<OperationsShipmentDto>[] = [
    {
      key: 'no',
      header: '#',
      // Descending, newest highest — the legacy numbering operators call shipments by.
      render: (row) => legacyRowNumber(rows.indexOf(row), rows.length),
    },
    {
      key: 'type',
      header: t('operations.shipment.type'),
      render: (row) => <ShipmentTypeBadge shipmentType={row.shipmentType} />,
    },
    {
      key: 'bank',
      header: t('operations.shipment.mainBank'),
      render: (row) => (
        <div>
          <div>{bankNameOf(row.mainBankId)}</div>
          {isCrossBank(row) && (
            // The legacy board highlighted a cross-bank movement in dark red because it is the
            // case an operator must not miss (main_ops.ejs:867).
            <div className="text-xs font-semibold text-red-700 dark:text-red-400">
              → {bankNameOf(row.secondaryBankId ?? '')}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'origin',
      header: t('operations.shipment.origin'),
      render: (row) => branchNameOf(row.originBranchId),
    },
    {
      key: 'destination',
      header: t('operations.shipment.destination'),
      render: (row) => branchNameOf(row.destinationBranchId),
    },
    {
      key: 'amount',
      header: t('operations.shipment.amount'),
      render: (row) => (
        <div className="space-y-0.5">
          {totalsByCurrency(row).map((total) => (
            <div key={total.currencyId} className="whitespace-nowrap tabular-nums">
              {formatAmount(total.amount, locale)} {currencyNameOf(total.currencyId)}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'area',
      header: t('operations.shipment.area'),
      render: (row) => row.areaName ?? '—',
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ShipmentStatusBadge status={row.status} />,
    },
    { key: 'notes', header: t('operations.shipment.notes'), render: (row) => row.notes ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center gap-1">
          {canComplete && (
            <button
              type="button"
              className={iconButton}
              aria-label={t(
                isReceived(row) ? 'operations.shipment.unreceive' : 'operations.shipment.receive',
              )}
              title={t(
                isReceived(row) ? 'operations.shipment.unreceive' : 'operations.shipment.receive',
              )}
              disabled={setReceived.isPending}
              onClick={() => void toggleReceived(row)}
            >
              {isReceived(row) ? (
                <ResetIcon className="h-4 w-4" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className={iconButton}
              aria-label={t('common.edit')}
              onClick={() => setEditing(row)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className={iconButton}
              aria-label={t('common.remove')}
              onClick={() => void removeShipment(row)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const boardDay = (board.data?.date ?? '').slice(0, 10);

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.dailyOps.title')}
        description={t('operations.dailyOps.subtitle')}
        actions={
          can('operationsShipment.create') ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" />
              {t('operations.shipment.add')}
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.dailyOps.date')}</span>
            <Input
              type="date"
              value={date ?? boardDay}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                if (e.target.value === '') next.delete('date');
                else next.set('date', e.target.value);
                setSp(next);
              }}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.shipment.mainBank')}</span>
            <Input value={filters.bank} onChange={(e) => setFilter({ bank: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.shipment.origin')}</span>
            <Input value={filters.origin} onChange={(e) => setFilter({ origin: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">
              {t('operations.shipment.destination')}
            </span>
            <Input
              value={filters.destination}
              onChange={(e) => setFilter({ destination: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.shipment.area')}</span>
            <Input value={filters.area} onChange={(e) => setFilter({ area: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.shipment.notes')}</span>
            <Input value={filters.notes} onChange={(e) => setFilter({ notes: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.shipment.type')}</span>
            <Select
              value={filters.type}
              onChange={(e) => setFilter({ type: e.target.value as DayBoardFilters['type'] })}
            >
              <option value="">{t('operations.dailyOps.all')}</option>
              <option value="daily">{t('operations.shipment.type.daily')}</option>
              <option value="secured">{t('operations.shipment.type.secured')}</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.dailyOps.received')}</span>
            <Select
              value={filters.received}
              onChange={(e) =>
                setFilter({ received: e.target.value as DayBoardFilters['received'] })
              }
            >
              <option value="">{t('operations.dailyOps.all')}</option>
              <option value="yes">{t('operations.dailyOps.receivedYes')}</option>
              <option value="no">{t('operations.dailyOps.receivedNo')}</option>
            </Select>
          </label>
        </CardBody>
      </Card>

      <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">
        {t('operations.dailyOps.count', { count: rows.length, total: shipments.length })}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={board.isLoading}
        error={board.error}
        onRetry={() => void board.refetch()}
        empty={t('operations.dailyOps.empty')}
      />

      <ShipmentFormDialog
        open={creating || editing !== null}
        shipment={editing}
        defaultDate={date ?? boardDay}
        banks={banks.data?.items ?? []}
        currencies={currencies.data?.items ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </PageContainer>
  );
};
