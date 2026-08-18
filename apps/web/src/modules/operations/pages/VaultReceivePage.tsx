// Receiving into the vault (B4) — the legacy `/receive_mohsana` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §7.2, contad_app.js:968-1310): the treasurer's queue of
// secured shipments not yet in the vault, with an edit form that recorded packaging, seals and a
// receipt number. Three things about it are worth stating, because two are preserved and one is
// deliberately not:
//
//   · NO DATE FILTER (:977). The queue is everything outstanding, all-time. PRESERVED — a
//     shipment does not stop needing to be received because a day rolled over.
//   · The "receive" was implemented as a GENERIC EDIT gated only on `deleted_dock == 0`, so ANY
//     save from this screen re-stamped `status: 2` and the receive timestamp — even a note fix
//     (quirk Q29). NOT PRESERVED: receiving is its own act here, and it happens once.
//   · `treasurer_receive` was written as `""` on every path (:1211/:1266), so the two-man rule the
//     schema described never actually recorded two people (quirk Q2). NORMALIZED: both treasurers
//     are required, and the server refuses the same person twice.
import { useState } from 'react';
import { MAX_PAGE_SIZE, type OperationsShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useSecuredBacklog,
} from '../api/operations-queries';
import { totalsByCurrency } from '../lib/day-board';
import { ReceiveIntoVaultDialog } from '../components/ReceiveIntoVaultDialog';

export const VaultReceivePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((s) => s.locale.locale);

  // Only what is still OUTSIDE the vault — the legacy queue was `status $nin [1,2,3]`, i.e. draft.
  const queue = useSecuredBacklog({ page: 1, pageSize: MAX_PAGE_SIZE, sortDir: 'desc', status: ['draft'] });
  const banks = useOperationsBanks({ page: 1, pageSize: MAX_PAGE_SIZE });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });

  const [receiving, setReceiving] = useState<OperationsShipmentDto | null>(null);
  const canReceive = can('operationsVault.receive');

  const columns: Column<OperationsShipmentDto>[] = [
    {
      key: 'bank',
      header: t('operations.shipment.mainBank'),
      render: (row) =>
        banks.data?.items.find((b) => b.id === row.mainBankId)?.opsName ?? '—',
    },
    {
      key: 'amount',
      header: t('operations.shipment.amount'),
      render: (row) => (
        <div className="space-y-0.5">
          {totalsByCurrency(row).map((total) => (
            <div key={total.currencyId} className="whitespace-nowrap tabular-nums">
              {formatNumber(total.amount, locale)}{' '}
              {currencies.data?.items.find((c) => c.id === total.currencyId)?.name ?? ''}
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
      key: 'actions',
      header: '',
      render: (row) =>
        canReceive ? (
          <Button size="sm" onClick={() => setReceiving(row)}>
            {t('operations.secured.receive.action')}
          </Button>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.secured.receive.title')}
        description={t('operations.secured.receive.subtitle')}
      />
      <DataTable
        columns={columns}
        rows={queue.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={queue.isLoading}
        error={queue.error}
        onRetry={() => void queue.refetch()}
        empty={t('operations.secured.receive.empty')}
      />
      <ReceiveIntoVaultDialog
        shipment={receiving}
        onClose={() => setReceiving(null)}
      />
    </PageContainer>
  );
};
