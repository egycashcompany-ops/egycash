// The employees register — «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين واللى ادوس عليه
// يجيب الهيستورى بتاعه كله».
//
// Everybody HR has, the people who work here today and the people who have left, with what each
// one holds right now. A row opens that person's whole IT history. URL-synced like every register
// in the module, so a filtered view is a link and the back button behaves.
//
// The names are HR's, read through IT's own `/it/people` under IT's own grant (`itAsset.view`) —
// a technician needs no HR permission to see who they hand laptops to. Nothing here is IT's but
// the custody count, and nothing here is editable: a person is changed in HR, never from IT.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ItPersonDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Select } from '../../../shared/ui/form';
import { EyeIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { useItBranchOptions, useItDepartmentOptions, useItPeople } from '../api/it-queries';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['branch', 'q', 'status', 'size', 'sort'] as const;

const DEFAULT_PAGE_SIZE = 25;

export const ItEmployeesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  // Everybody by default: the register is the answer to «who ever worked here», not only «who does».
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branch') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'name:asc').split(':');
  const sort = {
    by: sortByRaw === 'code' ? 'code' : 'name',
    dir: sortDirRaw === 'desc' ? 'desc' : 'asc',
  } as { by: 'name' | 'code'; dir: 'asc' | 'desc' };
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
      search: search || undefined,
      status: status === 'employed' || status === 'exited' ? status : 'all',
      branchId: branchId || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItPeople(params);

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  const departments = useItDepartmentOptions();
  const departmentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const department of departments.data ?? []) {
      map.set(department.id, localized(department.name, locale));
    }
    return map;
  }, [departments.data, locale]);

  const open = (person: ItPersonDto): void => navigate(`/it/employees/${person.employeeId}`);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItPersonDto>[] = [
    {
      key: 'code',
      header: t('it.employees.columns.code'),
      sortable: true,
      render: (p) => (
        <span className="font-mono text-xs" dir="ltr">
          {p.code}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('it.employees.columns.name'),
      sortable: true,
      render: (p) => p.fullNameAr,
    },
    {
      key: 'status',
      header: t('it.employees.columns.status'),
      render: (p) => <PersonStatusBadge status={p.status} />,
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (p) => (p.branchId === null ? '—' : (branchName.get(p.branchId) ?? '—')),
    },
    {
      key: 'department',
      header: t('it.employees.columns.department'),
      render: (p) => (p.departmentId === null ? '—' : (departmentName.get(p.departmentId) ?? '—')),
    },
    {
      key: 'openCustodyCount',
      header: t('it.employees.columns.holding'),
      align: 'center',
      render: (p) => (
        <span
          className={
            p.openCustodyCount > 0
              ? 'font-medium tabular-nums text-brand-700 dark:text-brand-300'
              : 'tabular-nums text-slate-400'
          }
        >
          {p.openCustodyCount}
        </span>
      ),
    },
    {
      key: 'hiredAt',
      header: t('it.employees.columns.hiredAt'),
      render: (p) =>
        p.hiredAt === null ? (
          '—'
        ) : (
          <span className="tabular-nums">{formatDate(p.hiredAt, locale)}</span>
        ),
    },
    {
      key: 'exitedAt',
      header: t('it.employees.columns.exitedAt'),
      render: (p) =>
        p.exitedAt === null ? (
          '—'
        ) : (
          <span className="tabular-nums">{formatDate(p.exitedAt, locale)}</span>
        ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (p) => (
        <button
          type="button"
          className={actionButton}
          aria-label={`${t('it.employees.openHistory')} — ${p.fullNameAr}`}
          title={t('it.employees.openHistory')}
          onClick={(event) => {
            event.stopPropagation();
            open(p);
          }}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.employees')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.employees') }]}
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || status !== '' || branchId !== ''}
          onClear={() => patch({ q: null, status: null, branch: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.employees.searchPlaceholder')}
            aria-label={t('it.employees.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('it.employees.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.employees.filterAll')}</option>
            <option value="employed">{t('it.employees.filterEmployed')}</option>
            <option value="exited">{t('it.employees.filterExited')}</option>
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
          rowKey={(p) => p.employeeId}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={open}
          empty={t('it.employees.empty')}
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
