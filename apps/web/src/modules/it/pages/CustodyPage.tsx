// The custody register (design §12 `/it/assignments`): what is out, and who has it.
//
// This is the screen the question "who has the laptop" is actually asked of — the asset list
// answers "what do we own", and that is a different question. URL-synced so a filtered view is a
// shareable link, and defaulting to OPEN intervals because that is what the question means; the
// closed ones are one filter away for the times it means "who had it".
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ItAssetAssignmentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EyeIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useItAssignments, useItBranchOptions } from '../api/it-queries';

const DEFAULT_PAGE_SIZE = 25;

export const CustodyPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  // Default `open` — the register's whole purpose is "currently out".
  const openParam = sp.get('open') ?? 'true';
  const branchId = sp.get('branch') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'assignedAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'assignedAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
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
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      ...(openParam === 'all' ? {} : { open: openParam === 'true' }),
      branchId: branchId || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItAssignments(params);

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItAssetAssignmentDto>[] = [
    {
      key: 'assignedAt',
      header: t('it.custody.assignedAt'),
      sortable: true,
      render: (a) => <span className="tabular-nums">{formatDate(a.assignedAt, locale)}</span>,
    },
    {
      key: 'holder',
      header: t('it.custody.holder'),
      // The employee id is the honest thing to show until IT-6's directory join; a fabricated
      // name would be worse than a reference the user can copy.
      render: (a) => (
        <span className="font-mono text-xs" dir="ltr">
          {a.assignedToEmployeeId}
        </span>
      ),
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (a) => branchName.get(a.branchId) ?? '—',
    },
    {
      key: 'expectedReturnAt',
      header: t('it.custody.expectedReturnAt'),
      sortable: true,
      render: (a) => {
        if (a.expectedReturnAt === null) return '—';
        const overdue = a.returnedAt === null && new Date(a.expectedReturnAt) < new Date();
        return (
          <span
            className={cn('tabular-nums', overdue && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(a.expectedReturnAt, locale)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      render: (a) => (
        <StatusBadge
          tone={a.returnedAt === null ? 'info' : 'neutral'}
          label={a.returnedAt === null ? t('it.custody.open') : t('it.custody.closed')}
        />
      ),
    },
    {
      key: 'returnedAt',
      header: t('it.custody.returnedAt'),
      sortable: true,
      render: (a) =>
        a.returnedAt === null ? (
          '—'
        ) : (
          <span className="tabular-nums">{formatDate(a.returnedAt, locale)}</span>
        ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (a) => (
        <button
          type="button"
          className={actionButton}
          aria-label={t('it.custody.openAsset')}
          title={t('it.custody.openAsset')}
          onClick={() => navigate(`/it/assets/${a.assetId}`)}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.custody')}
        description={t('it.custody.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.custody') }]}
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={openParam !== 'true' || branchId !== ''}
          onClear={() => patch({ open: null, branch: null })}
        >
          <Select
            aria-label={t('it.assets.columns.status')}
            value={openParam}
            onChange={(e) => patch({ open: e.target.value })}
            className="w-auto"
          >
            <option value="true">{t('it.custody.filterOpen')}</option>
            <option value="false">{t('it.custody.filterClosed')}</option>
            <option value="all">{t('it.custody.filterAll')}</option>
          </Select>
          <Select
            aria-label={t('it.assets.columns.branch')}
            value={branchId}
            onChange={(e) => patch({ branch: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.assets.allBranches')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>
    </PageContainer>
  );
};
