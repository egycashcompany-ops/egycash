// Cost Centres list — the catalog, and nothing about who belongs to one.
//
// Membership is deliberately absent from this screen: it is per-employee and dated, and it lives
// on the employee's own file where the person is already in front of you. A "members" column here
// would have to pick a date to be true, and no date on a catalog screen is the right one.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type CostCenterDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { ListView } from '../../../../shared/ui/ListView';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Select } from '../../../../shared/ui/form';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { PlusIcon } from '../../../../shared/ui/icons';
import { localized } from '../../../../shared/lib/format';
import { useCostCenters } from '../cost-center-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
  'status',
  'sort',
  'size',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const CostCentersListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'code:asc').split(':');
  const sort = { by: sortByRaw ?? 'code', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useCostCenters(params);
  const rows = data?.items ?? [];
  const dash = '—';

  const columns: Column<CostCenterDto>[] = [
    {
      key: 'code',
      header: t('organization.field.code'),
      sortable: true,
      render: (cc) => (
        <span className="font-mono text-xs" dir="ltr">
          {cc.code}
        </span>
      ),
    },
    { key: 'name', header: t('organization.field.name'), render: (cc) => localized(cc.name, locale) },
    {
      key: 'description',
      header: t('organization.costCenter.description'),
      render: (cc) => (cc.description === null ? dash : localized(cc.description, locale)),
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (cc) => (
        <StatusBadge
          tone={cc.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${cc.status}`)}
        />
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.costCenters')}
        description={t('organization.costCenter.subtitle')}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.costCenters') },
        ]}
        actions={
          <Can permission="costCenter.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.costCenter.create')}
            </Button>
          </Can>
        }
      />

      <ListView
        total={data?.meta.totalItems}
        hasActiveFilters={search !== '' || status !== ''}
        onClear={() => setSp(new URLSearchParams())}
        search={
          <SearchInput
            className="w-full sm:w-64"
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.filter.search')}
          />
        }
        filters={
          <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
        }
        pagination={
          data !== undefined && data.meta.totalItems > 0 ? (
            <Pagination
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(cc) => cc.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(cc) => navigate(cc.id)}
          embedded
        />
      </ListView>
    </PageContainer>
  );
};
