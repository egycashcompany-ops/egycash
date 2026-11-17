// «المعينون» — A28, under «جاهزون للتعيين»'s bar: «المعينون دي لما باجي عليها هتجبلي كل اللي موجودين
// من موظفين فالشركه و بردو checkbox عشان لو هطبع لناس كتير فنفس الوقت».
//
// Everybody employed at the company now — hired through recruitment or registered directly; not an
// external person, who is on somebody else's books and has no papers of ours, and not somebody whose
// service ended. Tick people and «طباعة لكل المحدد» opens the same popup as for candidates: each on
// a line of their own with their job's papers (their contract first), one document for all of them.
// A row's «طباعة العقد والمستندات» opens that employee's own tab.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EMPLOYEE_ORIGINS, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { useRememberedFilters } from '../../../../../shared/lib/useRememberedFilters';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useDepartmentReferenceOptions } from '../../../../organization/shared/references';
import { BulkPrintDialog } from '../../../contracts/components/BulkPrintDialog';
import { departmentIdsOf } from '../../../recruitment/job-offers/components/OfferFilters';
import { useEmployees } from '../api/employee-queries';
import { type EmployeeListParams } from '../api/employee-api';
import { employeeColumns } from '../lib/employee-columns';
import { HiredEmployeesFilters, type HiredFiltersState } from '../components/HiredEmployeesFilters';
import { ReadyHeaderActions } from '../components/ReadyHeaderActions';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['branch', 'department', 'job', 'q', 'size'] as const;

const DEFAULT_PAGE_SIZE = 25;

/** Everybody the company itself hired — the external people left out. */
export const HIRED_ORIGINS = EMPLOYEE_ORIGINS.filter((origin) => origin !== 'external');

/** The registry's columns this list shows, in their order. */
export const HIRED_COLUMNS = ['code', 'name', 'branch', 'department', 'jobTitle', 'hiredAt'] as const;

/** A department chosen while its branch copies are still loading matches nothing, never everybody. */
const NO_MATCH = '000000000000000000000000';

export const HiredEmployeesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const filters: HiredFiltersState = {
    search: sp.get('q') ?? '',
    branch: readList(sp, 'branch'),
    department: readList(sp, 'department'),
    job: readList(sp, 'job'),
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  const patch = (updates: Record<string, string | null>, resetPage = false): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const changeFilters = (nf: HiredFiltersState): void =>
    patch(
      {
        q: nf.search,
        branch: writeList(nf.branch),
        department: writeList(nf.department),
        job: writeList(nf.job),
      },
      true,
    );

  const { data: departments = [] } = useDepartmentReferenceOptions();
  const departmentIds = departmentIdsOf(filters.department, departments, filters.branch);
  const paramsKey = sp.toString();
  const params = useMemo<EmployeeListParams>(
    () => ({
      page,
      pageSize,
      employed: true,
      origin: HIRED_ORIGINS.join(','),
      ...(filters.search === '' ? {} : { search: filters.search }),
      ...(filters.branch.length === 0 ? {} : { branchId: filters.branch }),
      ...(filters.department.length === 0
        ? {}
        : { departmentId: departmentIds.length > 0 ? departmentIds : [NO_MATCH] }),
      ...(filters.job.length === 0 ? {} : { jobTitleId: filters.job }),
    }),
    [paramsKey, departmentIds.join(',')],
  );

  const { data, isLoading, isError, error, refetch } = useEmployees(params);
  const rows = data?.items ?? [];
  const selection = useTableSelection(rows.map((e) => e.id));
  const [printing, setPrinting] = useState(false);

  const columns = useMemo<Column<EmployeeDto>[]>(() => {
    const all = employeeColumns(t, locale);
    const shown = HIRED_COLUMNS.flatMap((key) => all.filter((column) => column.key === key));
    return [
      ...shown.map((column) => ({ ...column, sortable: false })),
      {
        key: 'actions',
        header: '',
        render: (e) => (
          <Can permission="contract.print">
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/employees/${e.id}?tab=papers`);
              }}
              data-print-employee={e.id}
            >
              {t('employees.ready.printPapers')}
            </Button>
          </Can>
        ),
      },
    ];
  }, [t, locale]);

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.hired.title')}
        breadcrumbs={[
          { label: t('employees.title'), to: '/employees' },
          { label: t('employees.ready.title'), to: '/employees/ready' },
          { label: t('employees.hired.title') },
        ]}
        actions={<ReadyHeaderActions />}
      />

      <div className="space-y-4">
        <HiredEmployeesFilters value={filters} onChange={changeFilters} />

        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Can permission="contract.print">
            <Button size="sm" onClick={() => setPrinting(true)} data-bulk-print>
              {t('employees.ready.printSelected')}
            </Button>
          </Can>
        </BulkActionBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          {...(can('contract.print') ? { selection } : {})}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('employees.hired.empty')}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) })}
            onPageSizeChange={(size) => patch({ size: String(size) }, true)}
          />
        )}
      </div>

      <BulkPrintDialog
        ids={selection.ids}
        source="employees"
        open={printing}
        onClose={() => setPrinting(false)}
        onPrinted={selection.clear}
      />
    </PageContainer>
  );
};
