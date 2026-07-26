// D12 — the employee profile's Contracts tab: current + historical contracts with
// links into the register, and a preselected "New contract" entry (frozen design §4).
import { Link, useNavigate } from 'react-router-dom';
import { type ContractDto, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { formatDate, localized } from '../../../../shared/lib/format';
import { useEmployeeContracts } from '../api/contract-queries';
import { ContractStatusBadge } from './ContractStatusBadge';

const EmployeeContractsTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading, isError, error, refetch } = useEmployeeContracts(employee.id);

  const columns: Column<ContractDto>[] = [
    {
      key: 'code',
      header: t('contracts.columns.code'),
      render: (c) => (
        <Link to={`/contracts/${c.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
          {c.code}
        </Link>
      ),
    },
    { key: 'type', header: t('contracts.columns.type'), render: (c) => localized(c.typeName, locale) },
    {
      key: 'version',
      header: t('contracts.columns.version'),
      align: 'center',
      render: (c) => <span className="font-mono text-xs">v{c.contractVersion}</span>,
    },
    { key: 'status', header: t('contracts.columns.status'), render: (c) => <ContractStatusBadge status={c.status} /> },
    { key: 'startDate', header: t('contracts.fields.startDate'), render: (c) => formatDate(c.startDate, locale) },
    {
      key: 'endDate',
      header: t('contracts.fields.endDate'),
      render: (c) => (c.endDate === null ? '—' : formatDate(c.endDate, locale)),
    },
  ];

  return (
    <div className="space-y-3">
      {can('contract.create') && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => navigate(`/contracts/new?employeeId=${employee.id}`)}>
            {t('contracts.list.new')}
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(c) => c.id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        onRowClick={(c) => navigate(`/contracts/${c.id}`)}
        empty={<EmptyState title={t('contracts.employeeTab.empty')} />}
      />
    </div>
  );
};

export default EmployeeContractsTab;
