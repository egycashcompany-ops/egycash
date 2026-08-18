// Secured shipments register (B4) — the legacy `/mohsana` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §7.1, contad_app.js:648-960): every secured shipment not
// yet completed, with NO DATE FILTER at all — an open working list, not a day's work. Shipments
// were created and edited here, and the same screen also carried a `received` toggle that flipped
// that field WITHOUT touching status (:948/:953), unlike /main_ops which moved both.
//
// PARITY: the unbounded, all-time backlog is preserved — it is what makes this a backlog rather
// than a board. NORMALIZED: the orphan `received` toggle is gone (Q23 — one lifecycle), so this
// screen shows status and leaves confirming delivery to the day board, where the legacy system
// actually did it.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type OperationsShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import {
  useOperationsBankBranches,
  useOperationsBanks,
  useOperationsCurrencies,
  useSecuredBacklog,
} from '../api/operations-queries';
import { totalsByCurrency } from '../lib/day-board';
import { ShipmentStatusBadge } from '../components/ShipmentBadges';
import { ShipmentFormDialog } from '../components/ShipmentFormDialog';

const DEFAULT_PAGE_SIZE = 25;

export const SecuredBacklogPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((s) => s.locale.locale);
  const [sp, setSp] = useSearchParams();

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const backlog = useSecuredBacklog({ page, pageSize: DEFAULT_PAGE_SIZE, sortDir: 'desc' });
  const banks = useOperationsBanks({ page: 1, pageSize: MAX_PAGE_SIZE });
  const branches = useOperationsBankBranches({ page: 1, pageSize: MAX_PAGE_SIZE });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });

  const [editing, setEditing] = useState<OperationsShipmentDto | null>(null);
  const [creating, setCreating] = useState(false);

  const nameOf = (list: { id: string }[] | undefined, id: string, key: string): string =>
    ((list ?? []).find((x) => x.id === id) as Record<string, string> | undefined)?.[key] ?? '—';

  const columns: Column<OperationsShipmentDto>[] = [
    {
      key: 'bank',
      header: t('operations.shipment.mainBank'),
      render: (row) => nameOf(banks.data?.items, row.mainBankId, 'opsName'),
    },
    {
      key: 'origin',
      header: t('operations.shipment.origin'),
      render: (row) => nameOf(branches.data?.items, row.originBranchId, 'name'),
    },
    {
      key: 'destination',
      header: t('operations.shipment.destination'),
      render: (row) => nameOf(branches.data?.items, row.destinationBranchId, 'name'),
    },
    {
      key: 'amount',
      header: t('operations.shipment.amount'),
      render: (row) => (
        <div className="space-y-0.5">
          {totalsByCurrency(row).map((total) => (
            <div key={total.currencyId} className="whitespace-nowrap tabular-nums">
              {formatNumber(total.amount, locale)}{' '}
              {nameOf(currencies.data?.items, total.currencyId, 'name')}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'collectionDate',
      header: t('operations.shipment.collectionDate'),
      render: (row) => formatDate(row.collectionDate, locale),
    },
    {
      key: 'deliveryDate',
      header: t('operations.shipment.deliveryDate'),
      render: (row) => (row.deliveryDate === null ? '—' : formatDate(row.deliveryDate, locale)),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => <ShipmentStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        can('operationsShipment.edit') ? (
          <button
            type="button"
            aria-label={t('common.edit')}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => setEditing(row)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.secured.backlog.title')}
        description={t('operations.secured.backlog.subtitle')}
        actions={
          can('operationsShipment.create') ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" />
              {t('operations.secured.backlog.add')}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={backlog.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={backlog.isLoading}
        error={backlog.error}
        onRetry={() => void backlog.refetch()}
        empty={t('operations.secured.backlog.empty')}
      />
      {backlog.data !== undefined && (
        <Pagination
          meta={backlog.data.meta}
          onPageChange={(next) => {
            const params = new URLSearchParams(sp);
            params.set('page', String(next));
            setSp(params);
          }}
        />
      )}

      <ShipmentFormDialog
        open={creating || editing !== null}
        shipment={editing}
        defaultDate={new Date().toISOString().slice(0, 10)}
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
