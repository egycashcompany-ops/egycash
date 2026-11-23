// Electronic Employee File list: free-text search + status filter, the files as folders (the same
// shelf «مستندات المتقدمين» uses — `EmployeeFolders`), pagination,
// and an assemble entry point — all permission-gated. Search/status/sort/pagination are synchronized
// with the URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EMPLOYEE_FILE_STATUSES, type EmployeeFileStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { EmptyState, ErrorState, LoadingState } from '../../../../../shared/ui';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { EmployeeFolders } from '../components/EmployeeFolders';
import { EmployeeFileFilters, type EmployeeFileFiltersState } from '../components/EmployeeFileFilters';
import { CreateEmployeeFileDialog } from '../components/CreateEmployeeFileDialog';
import { useEmployeeFiles } from '../api/employee-file-queries';
import { type EmployeeFileListParams } from '../api/employee-file-api';
import { useRememberedFilters } from '../../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
  'status',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const EmployeeFilesListPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);

  const filters: EmployeeFileFiltersState = {
    search: sp.get('q') ?? '',
    // Several statuses, ORed; a value the vocabulary does not carry (an old link) is dropped.
    status: readList(sp, 'status').filter((s): s is EmployeeFileStatus =>
      (EMPLOYEE_FILE_STATUSES as readonly string[]).includes(s),
    ),
  };
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

  const changeFilters = (nf: EmployeeFileFiltersState): void => patch({ q: nf.search || null, status: writeList(nf.status) });

  const params = useMemo<EmployeeFileListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: filters.search,
      status: filters.status,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useEmployeeFiles(params);
  const rows = data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.employeeFiles')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.employeeFiles') }]}
        actions={
          <Can permission="employeeFile.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              {t('employeeFiles.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <EmployeeFileFilters value={filters} onChange={changeFilters} />
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('employeeFiles.folder.empty')} />
        ) : (
          <EmployeeFolders files={rows} />
        )}
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateEmployeeFileDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
};
