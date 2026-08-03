// Drivers registry (FW-5, legacy /drivers): the fleet-owned profiles over HR employees
// (FR-11). URL-synced search (license number, server-side) + specialization/active filters,
// sortable license-expiry column, names resolved through the shared HR cache. View opens the
// profile; create/edit are one dialog behind `fleetDriver.manage`.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type FleetDriverProfileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, EyeIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useDrivers } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { DriverFormDialog } from '../components/DriverFormDialog';

const DEFAULT_PAGE_SIZE = 25;

export const DriversListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const specialization = sp.get('spec') ?? '';
  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
  const hasActiveFilters = search !== '' || specialization !== '' || active !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      specialization: specialization || undefined,
      isActive: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useDrivers(params);
  const rows = data?.items ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverProfileDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetDriverProfileDto>[] = [
    {
      key: 'driver',
      header: t('fleet.drivers.columns.driver'),
      render: (d) => <EmployeeName employeeId={d.employeeId} />,
    },
    {
      key: 'licenseNumber',
      header: t('fleet.drivers.columns.licenseNumber'),
      render: (d) => (
        <span className="font-mono text-xs" dir="ltr">
          {d.licenseNumber}
        </span>
      ),
    },
    {
      key: 'licenseExpiresAt',
      header: t('fleet.drivers.columns.licenseExpiresAt'),
      sortable: true,
      render: (d) => {
        const expired = new Date(d.licenseExpiresAt).getTime() < Date.now();
        return (
          <span
            className={cn('tabular-nums', expired && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(d.licenseExpiresAt, locale)}
          </span>
        );
      },
    },
    {
      key: 'specialization',
      header: t('fleet.drivers.columns.specialization'),
      render: (d) => t(`fleet.drivers.specialization.${d.specialization}`),
    },
    { key: 'area', header: t('fleet.drivers.columns.area'), render: (d) => d.area ?? '—' },
    {
      key: 'isActive',
      header: t('fleet.drivers.columns.status'),
      render: (d) => (
        <StatusBadge
          tone={d.isActive ? 'success' : 'neutral'}
          label={d.isActive ? t('fleet.drivers.active') : t('fleet.drivers.inactive')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (d) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.drivers.view')}
            title={t('fleet.drivers.view')}
            onClick={() => navigate(d.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          {can('fleetDriver.manage') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.drivers.edit')}
              title={t('fleet.drivers.edit')}
              onClick={() => {
                setEditing(d);
                setFormOpen(true);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.drivers')}
        description={t('fleet.drivers.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.drivers') },
        ]}
        actions={
          <Can permission="fleetDriver.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('fleet.drivers.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, spec: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('fleet.drivers.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('fleet.drivers.columns.specialization')}
            value={specialization}
            onChange={(e) => patch({ spec: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.drivers.allSpecializations')}</option>
            {(['cashTransport', 'atm', 'both'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`fleet.drivers.specialization.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('fleet.drivers.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.drivers.allStatuses')}</option>
            <option value="true">{t('fleet.drivers.active')}</option>
            <option value="false">{t('fleet.drivers.inactive')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
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

      <DriverFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        profile={editing}
      />
    </PageContainer>
  );
};
