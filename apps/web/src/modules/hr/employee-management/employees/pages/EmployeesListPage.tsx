// Employees list — the registry's daily view. Defaults to EMPLOYED people (probation / active /
// on leave / suspended); exited employees appear via the explicit view filter (frozen design
// §8). Search covers employee code, applicant code, and name. Entry points: hire from an
// accepted offer + Direct Registration (D4).
import { lazy, Suspense, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EMPLOYEE_STATUSES, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select } from '../../../../../shared/ui/form';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { useEmployees } from '../api/employee-queries';
import { employeeColumns } from '../lib/employee-columns';
import {
  departmentsIn,
  hasPlacementFilter,
  prunePlacement,
  sectionsIn,
  type PlacementSelection,
} from '../lib/placement-filters';
import {
  useBranchOptions,
  useDepartmentReferenceOptions,
  useJobTitleReferenceOptions,
  useSectionReferenceOptions,
} from '../../../../organization/shared/references';
import { type EmployeeListParams } from '../api/employee-api';
import { useRememberedFilters } from '../../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
  'status',
  'branch',
  'dept',
  'section',
  'job',
  'size',
  'sort',
  'view',
] as const;

const DEFAULT_PAGE_SIZE = 25;
/**
 * `toSettle` (P-HR-17) is a fourth VIEW rather than a fourth screen.
 *
 * It asks the same question this page exists for — which people? — narrowed to leavers whose
 * settlement has not happened, and it is gated by the compensation key. A page of its own would
 * have needed either a new permission or `employee.viewCompensation` re-pointed away from the
 * employee file, where compensation is actually administered.
 */
type View = 'employed' | 'exited' | 'all' | 'toSettle';

// Its own chunk, like every additive surface: nobody who never opens it pays for it.
const SettlementQueueTable = lazy(() =>
  import('../../../settlement/components/SettlementQueueTable').then((m) => ({
    default: m.SettlementQueueTable,
  })),
);

export const EmployeesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const canSettle = can('employee.viewCompensation');
  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const placement: PlacementSelection = {
    branchId: sp.get('branch') ?? '',
    departmentId: sp.get('dept') ?? '',
    sectionId: sp.get('section') ?? '',
    jobTitleId: sp.get('job') ?? '',
  };
  const viewRaw = sp.get('view');
  // A caller without the compensation key falls back to the default view rather than seeing an
  // empty table they cannot be told the reason for — the server would refuse the read anyway.
  const view: View =
    viewRaw === 'exited' || viewRaw === 'all'
      ? viewRaw
      : viewRaw === 'toSettle' && canSettle
        ? 'toSettle'
        : 'employed';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'hiredAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'hiredAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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

  const params = useMemo<EmployeeListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search,
      // The view filter: employed (default) / exited / all — status narrows within the view.
      ...(view === 'employed' ? { employed: true } : view === 'exited' ? { employed: false } : {}),
      ...(status === '' ? {} : { status }),
      // The registry already filters on all four (`ListEmployeesQuery`), so narrowing is one query,
      // not a client-side pass over a page — the count under the bar stays the server's own.
      ...(placement.branchId === '' ? {} : { branchId: placement.branchId }),
      ...(placement.departmentId === '' ? {} : { departmentId: placement.departmentId }),
      ...(placement.sectionId === '' ? {} : { sectionId: placement.sectionId }),
      ...(placement.jobTitleId === '' ? {} : { jobTitleId: placement.jobTitleId }),
    }),
    [paramsKey],
  );

  // The queue is served by its own endpoint, so the employees read stands down while it is open.
  const { data, isLoading, isError, error, refetch } = useEmployees(params, view !== 'toSettle');
  const rows = data?.items ?? [];

  /** The queue takes only the filters it actually supports — search and paging, nothing invented. */
  const queueParams = useMemo(
    () => ({ page, pageSize, ...(search === '' ? {} : { search }) }),
    [paramsKey],
  );

  const columns = useMemo(() => employeeColumns(t, locale), [t, locale]);

  // "Active" means anything a reader changed from how the screen opens: the default view is not a
  // filter to them, it is the screen. Clearing puts every remembered parameter back to that.
  const hasActiveFilters =
    search !== '' || status !== '' || view !== 'employed' || hasPlacementFilter(placement);
  const clearFilters = (): void =>
    patch({ q: null, status: null, view: null, branch: null, dept: null, section: null, job: null });

  // One fetch of each catalog, narrowed in the browser. All four endpoints are authenticated but
  // NOT gated by the unit's `view` permission, so the filters populate for anybody who may read the
  // employee list — and they are paged to exhaustion server-side, so a deployment with 142 job
  // titles offers 142 of them.
  const { data: branchOptions = [] } = useBranchOptions();
  const { data: departmentOptions = [] } = useDepartmentReferenceOptions();
  const { data: sectionOptions = [] } = useSectionReferenceOptions();
  const { data: jobTitleOptions = [] } = useJobTitleReferenceOptions();

  const departments = useMemo(
    () => departmentsIn(departmentOptions, placement.branchId),
    [departmentOptions, placement.branchId],
  );
  const sections = useMemo(
    () => sectionsIn(sectionOptions, departmentOptions, placement.branchId, placement.departmentId),
    [sectionOptions, departmentOptions, placement.branchId, placement.departmentId],
  );

  /**
   * Change one placement filter and drop whatever no longer sits under it.
   *
   * Pruning happens HERE and not on render: the catalogs load asynchronously, and pruning against a
   * list that has not arrived would erase a selection restored from the URL the moment the page
   * opened.
   */
  const setPlacement = (part: Partial<PlacementSelection>): void => {
    const next = prunePlacement({ ...placement, ...part }, departmentOptions, sectionOptions);
    patch({
      branch: next.branchId || null,
      dept: next.departmentId || null,
      section: next.sectionId || null,
      job: next.jobTitleId || null,
    });
  };

  // The row count the table is standing on: the whole list when nothing is narrowed, the narrowed
  // total otherwise. It is the server's count for this exact query, so it never disagrees with
  // the pagination beneath it. The settlement queue is another endpoint with its own count, so
  // the number is withheld there rather than shown wrong.
  const rowCount =
    view !== 'toSettle' && data !== undefined ? (
      <span className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {t('employees.list.count', { count: data.meta.totalItems })}
      </span>
    ) : undefined;

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.module.title')}
        breadcrumbs={[{ label: t('employees.module.title') }]}
        actions={
          <div className="flex items-center gap-2">
            <Can permission="employee.registerDirect">
              <Button size="sm" variant="secondary" onClick={() => navigate('register')}>
                {t('employees.actions.registerDirect')}
              </Button>
            </Can>
            <Can permission="employee.create">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
                {t('employees.actions.create')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="space-y-4">
        <FilterBar onClear={clearFilters} hasActiveFilters={hasActiveFilters} trailing={rowCount}>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('employees.list.searchPlaceholder')}
          />
          <Select
            value={view}
            onChange={(e) =>
              patch({ view: e.target.value === 'employed' ? null : e.target.value, status: null })
            }
          >
            <option value="employed">{t('employees.view.employed')}</option>
            <option value="exited">{t('employees.view.exited')}</option>
            <option value="all">{t('employees.view.all')}</option>
            {/* Offered only to somebody who may read pay — it is a compensation surface. */}
            {canSettle && <option value="toSettle">{t('employees.view.toSettle')}</option>}
          </Select>
          {view !== 'exited' && view !== 'toSettle' && (
            <Select value={status} onChange={(e) => patch({ status: e.target.value || null })}>
              <option value="">{t('employees.filters.anyStatus')}</option>
              {EMPLOYEE_STATUSES.filter((s) => (view === 'employed' ? s !== 'exited' : true)).map((s) => (
                <option key={s} value={s}>
                  {t(`employees.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
          {/*
            Placement, in the order the columns read: site → department → section, then job title.
            The first three cascade; the job title is a flat catalog and narrows nothing.

            Withheld in the settlement queue, which is a different endpoint and takes none of them —
            offering a filter that would be ignored is worse than not offering it.
          */}
          {view !== 'toSettle' && (
            <>
              <Select
                aria-label={t('employees.columns.branch')}
                value={placement.branchId}
                onChange={(e) => setPlacement({ branchId: e.target.value })}
              >
                <option value="">{t('employees.filters.anyBranch')}</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name[locale]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('employees.columns.department')}
                value={placement.departmentId}
                onChange={(e) => setPlacement({ departmentId: e.target.value })}
              >
                <option value="">{t('employees.filters.anyDepartment')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name[locale]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('employees.columns.section')}
                value={placement.sectionId}
                onChange={(e) => setPlacement({ sectionId: e.target.value })}
              >
                <option value="">{t('employees.filters.anySection')}</option>
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.name[locale]}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('employees.columns.jobTitle')}
                value={placement.jobTitleId}
                onChange={(e) => setPlacement({ jobTitleId: e.target.value })}
              >
                <option value="">{t('employees.filters.anyJobTitle')}</option>
                {jobTitleOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name[locale]}
                  </option>
                ))}
              </Select>
            </>
          )}
        </FilterBar>
        {view === 'toSettle' ? (
          <Suspense fallback={<LoadingState />}>
            <SettlementQueueTable
              params={queueParams}
              // A row is a person: opening it lands on their settlement tab, which is where the
              // figures this list deliberately omits are read.
              onOpen={(employeeId) => navigate(`${employeeId}?tab=settlement`)}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          </Suspense>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(e) => e.id}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              sort={sort}
              onSortChange={changeSort}
              onRowClick={(e) => navigate(e.id)}
            />
            {data !== undefined && data.meta.totalItems > 0 && (
              <Pagination
                meta={data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
};
