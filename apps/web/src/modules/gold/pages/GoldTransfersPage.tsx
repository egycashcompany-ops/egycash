// عمليات التحويل — the ownership-transfer list.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldTransferDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { ChevronStartIcon, EditIcon, EyeIcon, PlusIcon, ResetIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { readList, writeList } from '../../../shared/lib/list-param';
import { useGoldTransfer, useGoldTransfersList, useRevertGoldTransfer } from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import { TransferEditorDialog } from '../components/TransferEditorDialog';
import {
  docStatusLabel,
  docStatusOptions,
  docStatusTone,
  metalOptions,
} from '../components/gold-labels';
import { fmtDate, fmtWeightValue } from '../lib/gold-format';

const PAGE_SIZE = 12;

const EditorLoader = ({
  target,
  onClose,
}: {
  target: string | null;
  onClose: () => void;
}): JSX.Element => {
  const { data, isFetching } = useGoldTransfer(target);
  return (
    <TransferEditorDialog
      existing={target === null ? null : (data ?? null)}
      loading={target !== null && isFetching}
      onClose={onClose}
    />
  );
};

export const GoldTransfersPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const statuses = readList(sp, 'status');
  const metals = readList(sp, 'metal');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: search === '' ? undefined : search,
      status: statuses.length === 0 ? undefined : statuses,
      metalType: metals.length === 0 ? undefined : metals,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldTransfersList(params);
  const revert = useRevertGoldTransfer();
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  const onRevert = async (row: GoldTransferDto): Promise<void> => {
    if (!window.confirm(t('gold.transfers.revertPrompt'))) return;
    try {
      await revert.mutateAsync({ id: row.id, version: row.version });
      toast.success(t('gold.transfers.reverted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('gold.receiving.revertFailed'));
    }
  };

  const columns: Column<GoldTransferDto>[] = [
    { key: 'transferDate', header: t('gold.common.date'), render: (r) => fmtDate(r.transferDate) },
    {
      key: 'transferNumber',
      header: t('gold.transfers.number'),
      render: (r) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {r.transferNumber}
          <BranchTag name={r.branchName} />
        </span>
      ),
    },
    {
      key: 'status',
      header: t('gold.common.status'),
      render: (r) => (
        <StatusBadge tone={docStatusTone(r.status)} label={docStatusLabel(t, r.status)} />
      ),
    },
    {
      key: 'owners',
      header: t('gold.transfers.direction'),
      render: (r) => (
        <span className="flex items-center gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{r.currentOwnerName ?? '—'}</span>
          <ChevronStartIcon className="h-3.5 w-3.5 text-brand-500" />
          <span className="text-slate-900 dark:text-slate-100">{r.newOwnerName ?? '—'}</span>
        </span>
      ),
    },
    { key: 'barsCount', header: t('gold.common.bars'), render: (r) => r.barsCount },
    {
      key: 'totalWeight',
      header: t('gold.common.weight'),
      render: (r) => t('gold.common.grams', { value: fmtWeightValue(r.totalWeight) }),
    },
    {
      key: 'actions',
      header: t('gold.common.actions'),
      align: 'end',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={
              r.status === 'draft' ? (
                <EditIcon className="h-3.5 w-3.5" />
              ) : (
                <EyeIcon className="h-3.5 w-3.5" />
              )
            }
            onClick={() => {
              setTarget(r.id);
            }}
          >
            {r.status === 'draft' ? t('gold.common.open') : t('gold.common.view')}
          </Button>
          {r.status === 'confirmed' && (
            <Can permission="goldTransfer.revert">
              <Button
                variant="ghost-warning"
                size="sm"
                leftIcon={<ResetIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                  void onRevert(r);
                }}
              >
                {t('gold.common.revert')}
              </Button>
            </Can>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.transfers')}
        description={t('gold.transfers.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.transfers') },
        ]}
        actions={
          <Can permission="goldTransfer.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setTarget(null);
              }}
            >
              {t('gold.transfers.new')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || statuses.length > 0 || metals.length > 0}
          onClear={() => {
            patch({ q: null, status: null, metal: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              patch({ q: value === '' ? null : value });
            }}
            placeholder={t('gold.transfers.searchPlaceholder')}
            className="w-64"
          />
          <MultiSelect
            label={t('gold.common.allMetals')}
            options={metalOptions(t)}
            value={metals}
            onChange={(values) => {
              patch({ metal: writeList(values) });
            }}
          />
          <MultiSelect
            label={t('gold.common.allStatuses')}
            options={docStatusOptions(t)}
            value={statuses}
            onChange={(values) => {
              patch({ status: writeList(values) });
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('gold.transfers.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => {
              patch({ page: String(p) }, false);
            }}
          />
        )}
      </div>

      {target !== undefined && (
        <EditorLoader
          target={target}
          onClose={() => {
            setTarget(undefined);
          }}
        />
      )}
    </PageContainer>
  );
};
