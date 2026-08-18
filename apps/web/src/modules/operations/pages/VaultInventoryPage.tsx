// Vault inventory (B4) — the legacy `/vault1` screen.
//
// ONE THING TO KNOW ABOUT THE LEGACY SCREEN (discovery §C, quirk Q32): it had a date picker, and
// BOTH of its aggregations had their date filters COMMENTED OUT (contad_app.js:1374, 1530-1533).
// The page was all-time regardless of what the picker said — and that is the correct behaviour for
// an inventory: "what is in the vault" is a question about now, not about a day.
//
// So the behaviour is PRESERVED and the picker is DROPPED. Keeping a control that never did
// anything would only reproduce the confusion.
import { useSearchParams } from 'react-router-dom';
import { type OperationsVaultCustodyDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { formatDateTime } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { useOperationsCrewDirectory, useVaultInventory } from '../api/operations-queries';

export const VaultInventoryPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((s) => s.locale.locale);
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);

  const vault = useVaultInventory({ page, pageSize: 25 });
  const directory = useOperationsCrewDirectory(null);

  const nameOf = (employeeId: string | null): string =>
    employeeId === null
      ? '—'
      : (directory.data?.members.find((m) => m.employeeId === employeeId)?.fullNameAr ?? '—');

  const columns: Column<OperationsVaultCustodyDto>[] = [
    {
      key: 'receipt',
      header: t('operations.secured.receive.receiptNumber'),
      render: (row) => row.receiptNumber,
    },
    {
      key: 'packages',
      header: t('operations.vault.packages'),
      render: (row) => (
        <span className="tabular-nums">
          {t('operations.vault.packageCounts', {
            bags: row.bagCount,
            cartons: row.cartonCount,
            boxes: row.boxCount,
          })}
        </span>
      ),
    },
    {
      key: 'seals',
      header: t('operations.vault.seals'),
      render: (row) => (
        <span className="tabular-nums">{row.bagSeals.length + row.boxSeals.length}</span>
      ),
    },
    {
      key: 'receivedBy',
      // Both treasurers, because dual control is only meaningful if both are visible (Q2).
      header: t('operations.vault.receivedBy'),
      render: (row) => (
        <div className="text-sm">
          <div>{nameOf(row.receivedByPrimaryId)}</div>
          <div className="text-xs text-slate-500">{nameOf(row.receivedBySecondaryId)}</div>
        </div>
      ),
    },
    {
      key: 'receivedAt',
      header: t('operations.vault.receivedAt'),
      render: (row) => formatDateTime(row.receivedAt, locale),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.vault.title')}
        description={t('operations.vault.subtitle')}
      />
      <DataTable
        columns={columns}
        rows={vault.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={vault.isLoading}
        error={vault.error}
        onRetry={() => void vault.refetch()}
        empty={t('operations.vault.empty')}
      />
      {vault.data !== undefined && (
        <Pagination
          meta={vault.data.meta}
          onPageChange={(next) => {
            const params = new URLSearchParams(sp);
            params.set('page', String(next));
            setSp(params);
          }}
        />
      )}
    </PageContainer>
  );
};
