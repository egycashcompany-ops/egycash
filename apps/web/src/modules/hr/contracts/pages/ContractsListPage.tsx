// The Contracts register (frozen design §4): Employee, Type, Version, Status, Start/End
// + permission- and state-gated row actions (Preview / Print / Download PDF / Amend /
// Renew / Terminate), free-text search (A12) and the expiring-soon filter (D11).
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CONTRACT_STATUSES, type ContractDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  toast,
  type Column,
} from '../../../../shared/ui';
import { Select } from '../../../../shared/ui/form';
import { formatDate, localized } from '../../../../shared/lib/format';
import { useContracts, useContractTypes } from '../api/contract-queries';
import { ContractStatusBadge } from '../components/ContractStatusBadge';
import { AmendRenewDialog, TerminateDialog } from '../components/ContractActionDialogs';
import { downloadContractPdf, printContract } from '../components/contract-doc-actions';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'expiring',
  'q',
  'status',
  'type',
] as const;

const DEFAULT_PAGE_SIZE = 25;

const RowAction = ({ label, onClick }: { label: string; onClick: () => void }): JSX.Element => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
  >
    {label}
  </button>
);

export const ContractsListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const { data: types } = useContractTypes();
  const [dialog, setDialog] = useState<{ mode: 'amend' | 'renew' | 'terminate'; contract: ContractDto } | null>(null);

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const typeId = sp.get('type') ?? '';
  const expiring = sp.get('expiring') === '1';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (!('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      ...(search === '' ? {} : { search }),
      ...(status === '' ? {} : { status }),
      ...(typeId === '' ? {} : { typeId }),
      ...(expiring ? { expiringWithinDays: 30 } : {}),
    }),
    [sp.toString()],
  );
  const { data, isLoading, isError, error, refetch } = useContracts(params);

  const doPrint = (c: ContractDto): void => {
    printContract(c.id).catch(() => toast.error(t('contracts.actions.printFailed')));
  };
  const doPdf = (c: ContractDto): void => {
    downloadContractPdf(c.id)
      .then((ready) => {
        if (!ready) toast.info(t('contracts.actions.pdfNotReady'));
      })
      .catch(() => toast.error(t('contracts.actions.pdfFailed')));
  };

  const actionable = (c: ContractDto): boolean => c.status === 'active' || c.status === 'signed';
  const columns: Column<ContractDto>[] = [
    {
      key: 'code',
      header: t('contracts.columns.code'),
      render: (c) => (
        <span className="font-mono text-xs" dir="ltr">
          {c.code}
        </span>
      ),
    },
    {
      key: 'employee',
      header: t('contracts.columns.employee'),
      render: (c) => (
        <Link
          to={`/employees/${c.employeeId}?tab=contracts`}
          onClick={(e) => e.stopPropagation()}
          className="text-brand-700 hover:underline dark:text-brand-300"
        >
          {c.employeeName}
          <span className="ms-2 font-mono text-xs text-slate-400" dir="ltr">{c.employeeCode}</span>
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
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (c) => (
        <span className="flex flex-wrap justify-end gap-0.5">
          <RowAction label={t('contracts.actions.preview')} onClick={() => navigate(`/contracts/${c.id}`)} />
          {c.hasSnapshot && can('contract.print') && (
            <>
              <RowAction label={t('contracts.actions.print')} onClick={() => doPrint(c)} />
              <RowAction label={t('contracts.actions.pdf')} onClick={() => doPdf(c)} />
            </>
          )}
          {actionable(c) && can('contract.amend') && (
            <RowAction label={t('contracts.actions.amend')} onClick={() => setDialog({ mode: 'amend', contract: c })} />
          )}
          {actionable(c) && can('contract.renew') && (
            <RowAction label={t('contracts.actions.renew')} onClick={() => setDialog({ mode: 'renew', contract: c })} />
          )}
          {actionable(c) && can('contract.terminate') && (
            <RowAction
              label={t('contracts.actions.terminate')}
              onClick={() => setDialog({ mode: 'terminate', contract: c })}
            />
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.module.title')}
        description={t('contracts.list.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {can('contractTemplate.manage') && (
              <Button variant="secondary" onClick={() => navigate('/contracts/templates')}>
                {t('contracts.templates.title')}
              </Button>
            )}
            {can('contract.create') && (
              <Button onClick={() => navigate('/contracts/new')}>{t('contracts.list.new')}</Button>
            )}
          </div>
        }
      />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value })}
          placeholder={t('contracts.list.searchPlaceholder')}
          className="w-72"
        />
        <Select value={status} onChange={(e) => patch({ status: e.target.value })} className="w-44">
          <option value="">{t('contracts.filters.allStatuses')}</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`contracts.status.${s}`)}</option>
          ))}
        </Select>
        <Select value={typeId} onChange={(e) => patch({ type: e.target.value })} className="w-44">
          <option value="">{t('contracts.filters.allTypes')}</option>
          {(types ?? []).map((x) => (
            <option key={x.id} value={x.id}>{localized(x.name, locale)}</option>
          ))}
        </Select>
        <Checkbox
          label={t('contracts.filters.expiringSoon')}
          checked={expiring}
          onChange={(e) => patch({ expiring: e.target.checked ? '1' : null })}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(c) => c.id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        onRowClick={(c) => navigate(`/contracts/${c.id}`)}
        empty={<EmptyState title={t('contracts.list.empty')} />}
      />
      {data !== undefined && <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />}
      {dialog !== null && dialog.mode !== 'terminate' && (
        <AmendRenewDialog contract={dialog.contract} mode={dialog.mode} open onClose={() => setDialog(null)} />
      )}
      {dialog !== null && dialog.mode === 'terminate' && (
        <TerminateDialog contract={dialog.contract} open onClose={() => setDialog(null)} />
      )}
    </PageContainer>
  );
};
