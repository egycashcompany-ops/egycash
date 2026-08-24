// /atm/machines — the legacy /all_atm page (all_atm.ejs) by parity: every ACTIVE machine of the
// branch, with search and an Excel-style export. The legacy exported via a CDN-loaded xlsx build
// (:986); this exports the same four columns as CSV with a UTF-8 BOM so Excel opens the Arabic
// correctly — a dependency-free equivalent recorded in the port doc.
import { useMemo, useState } from 'react';
import { MAX_PAGE_SIZE, type AtmMachineDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { DownloadIcon } from '../../../shared/ui/icons';
import { useAtmMachines } from '../api/atm-queries';

export const machinesCsv = (rows: readonly AtmMachineDto[]): string => {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [
    ['Bank', 'ID', 'ATM Name', 'Area'].join(','),
    ...rows.map((row) => [row.bankName, row.machineCode, row.name, row.area].map(escape).join(',')),
  ];
  // BOM: Excel misreads UTF-8 Arabic without it.
  return '\ufeff' + lines.join('\n');
};

export const MachinesPage = (): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');

  const params = useMemo(
    () => ({
      pageSize: MAX_PAGE_SIZE,
      isActive: 'true',
      sortBy: 'machineCode',
      sortDir: 'asc' as const,
      ...(search === '' ? {} : { search }),
    }),
    [search],
  );
  const list = useAtmMachines(params);
  const rows = list.data?.items ?? [];

  const exportCsv = (): void => {
    const blob = new Blob([machinesCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'atm-machines.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<AtmMachineDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.name },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('atm.machines.title')}
        description={t('atm.machines.subtitle')}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <DownloadIcon className="h-4 w-4" />
            {t('atm.machines.export')}
          </Button>
        }
      />
      <div className="mb-4 max-w-sm">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('atm.machines.searchPlaceholder')}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.machines.empty')}
      />
    </PageContainer>
  );
};
