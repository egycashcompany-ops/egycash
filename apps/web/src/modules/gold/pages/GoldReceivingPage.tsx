// عمليات الدخول — the receipt list, and the way into the editor.
//
// The list is a queue: drafts to finish, approved receipts to read, reverted ones to fix and
// re-approve. `revert` appears only on an approved receipt, and it warns first — undoing an entry
// removes the bars it created, which the server refuses outright if any of them has since moved.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldReceivingReceiptDto } from '@ecms/contracts';
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
import { EditIcon, EyeIcon, PlusIcon, ResetIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { readList, writeList } from '../../../shared/lib/list-param';
import {
  useGoldReceiving,
  useGoldReceivingList,
  useRevertGoldReceiving,
} from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import { ReceivingEditorDialog } from '../components/ReceivingEditorDialog';
import { docStatusLabel, docStatusOptions, docStatusTone } from '../components/gold-labels';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';
import { fmtDate, fmtWeightValue } from '../lib/gold-format';

const PAGE_SIZE = 12;

/** `undefined` = closed, `null` = a new receipt, a string = that receipt. */
type EditorTarget = string | null | undefined;

const EditorLoader = ({
  target,
  onClose,
}: {
  target: string | null;
  onClose: () => void;
}): JSX.Element => {
  const { data, isFetching } = useGoldReceiving(target);
  return (
    <ReceivingEditorDialog
      existing={target === null ? null : (data ?? null)}
      loading={target !== null && isFetching}
      onClose={onClose}
    />
  );
};

export const GoldReceivingPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const companies = readList(sp, 'company');
  const statuses = readList(sp, 'status');
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
      companyId: companies.length === 0 ? undefined : companies,
      status: statuses.length === 0 ? undefined : statuses,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldReceivingList(params);
  const owners = useGoldCompanyOptions();
  const revert = useRevertGoldReceiving();
  const [target, setTarget] = useState<EditorTarget>(undefined);

  const onRevert = async (row: GoldReceivingReceiptDto): Promise<void> => {
    if (!window.confirm(t('gold.receiving.revertPrompt'))) return;
    try {
      await revert.mutateAsync({ id: row.id, version: row.version });
      toast.success(t('gold.common.reverted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('gold.receiving.revertFailed'));
    }
  };

  const columns: Column<GoldReceivingReceiptDto>[] = [
    { key: 'receiptDate', header: t('gold.common.date'), render: (r) => fmtDate(r.receiptDate) },
    {
      key: 'receiptNumber',
      header: t('gold.receiving.number'),
      render: (r) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {r.receiptNumber}
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
    { key: 'company', header: t('gold.common.owner'), render: (r) => r.companyName ?? '—' },
    { key: 'barsCount', header: t('gold.common.bars'), render: (r) => r.barsCount },
    {
      key: 'totalWeight',
      header: t('gold.common.weight'),
      render: (r) => t('gold.common.grams', { value: fmtWeightValue(r.totalWeight) }),
    },
    {
      key: 'printCount',
      header: t('gold.common.print'),
      render: (r) => t('gold.common.printedTimes', { count: r.printCount }),
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
              r.status === 'confirmed' ? (
                <EyeIcon className="h-3.5 w-3.5" />
              ) : (
                <EditIcon className="h-3.5 w-3.5" />
              )
            }
            onClick={() => {
              setTarget(r.id);
            }}
          >
            {r.status === 'confirmed' ? t('gold.common.view') : t('gold.common.open')}
          </Button>
          {r.status === 'confirmed' && (
            <Can permission="goldReceiving.revert">
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
        title={t('gold.nav.receiving')}
        description={t('gold.receiving.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.receiving') },
        ]}
        actions={
          <Can permission="goldReceiving.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setTarget(null);
              }}
            >
              {t('gold.receiving.new')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || companies.length > 0 || statuses.length > 0}
          onClear={() => {
            patch({ q: null, company: null, status: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              patch({ q: value === '' ? null : value });
            }}
            placeholder={t('gold.receiving.searchPlaceholder')}
            className="w-64"
          />
          <MultiSelect
            label={t('gold.common.allOwners')}
            options={owners}
            value={companies}
            onChange={(values) => {
              patch({ company: writeList(values) });
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
          empty={t('gold.receiving.empty')}
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
