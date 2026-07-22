// Job Positions Management — list. A reusable organization master entity owned by a Department
// (required) and optionally placed at a Section. Columns: Name, Department, Section, Status, Created,
// Updated, plus an inline Activate/Deactivate action. Department → Section filters cascade
// (server-side), and free-text search + status filter + pagination are URL-synchronized.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type JobPositionDto, type Locale } from '@ecms/contracts';
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
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatDate, localized } from '../../../../shared/lib/format';
import { useDepartmentOptions, useSectionOptions } from '../../shared/references';
import { useJobPositions, useUpdateJobPosition } from '../job-position-queries';

const DEFAULT_PAGE_SIZE = 25;

/** Inline Activate/Deactivate toggle for a single job position (version-checked). */
const StatusToggle = ({ position }: { position: JobPositionDto }): JSX.Element => {
  const t = useT();
  const update = useUpdateJobPosition(position.id);
  const next = position.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: position.version });
      toast.success(t(`organization.jobPosition.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="jobPosition.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={position.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(
          position.status === 'active'
            ? 'organization.action.deactivate'
            : 'organization.action.activate',
        )}
      </Button>
    </Can>
  );
};

export const JobPositionsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const departmentId = sp.get('departmentId') ?? '';
  const sectionId = sp.get('sectionId') ?? '';
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

  const { data: departments = [] } = useDepartmentOptions(undefined);
  const { data: allSections = [] } = useSectionOptions(undefined);
  const { data: filterSections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId);
  const departmentName = (id: string | undefined): string => {
    const d = departments.find((x) => x.id === id);
    return d === undefined ? (id ?? '—') : localized(d.name, locale);
  };
  const sectionName = (id: string | null): string => {
    if (id === null) return '—';
    const s = allSections.find((x) => x.id === id);
    return s === undefined ? id : localized(s.name, locale);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      departmentId: departmentId || undefined,
      sectionId: sectionId || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useJobPositions(params);
  const rows = data?.items ?? [];

  const columns: Column<JobPositionDto>[] = [
    {
      key: 'name',
      header: t('organization.field.name'),
      render: (p) => <span>{localized(p.name, locale)}</span>,
    },
    {
      key: 'departmentId',
      header: t('organization.field.department'),
      render: (p) => <span>{departmentName(p.departmentId)}</span>,
    },
    {
      key: 'sectionId',
      header: t('organization.field.section'),
      render: (p) => <span>{sectionName(p.sectionId)}</span>,
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (p) => (
        <StatusBadge
          tone={p.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${p.status}`)}
        />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (p) => formatDate(p.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (p) => formatDate(p.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (p) => <StatusToggle position={p} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.jobPositions')}
        description={t('organization.jobPosition.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.jobPositions') }]}
        actions={
          <Can permission="jobPosition.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.jobPosition.create')}
            </Button>
          </Can>
        }
      />

      <ListView
        total={data?.meta.totalItems}
        hasActiveFilters={search !== '' || status !== '' || departmentId !== '' || sectionId !== ''}
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
          <>
            <Select
              className="w-48"
              value={departmentId}
              onChange={(e) => patch({ departmentId: e.target.value || null, sectionId: null })}
            >
              <option value="">{t('organization.filter.allDepartments')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {localized(d.name, locale)}
                </option>
              ))}
            </Select>
            <Select className="w-48" value={sectionId} onChange={(e) => patch({ sectionId: e.target.value || null })}>
              <option value="">{t('organization.filter.allSections')}</option>
              {filterSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s.name, locale)}
                </option>
              ))}
            </Select>
            <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
              <option value="">{t('organization.filter.allStatuses')}</option>
              <option value="active">{t('organization.status.active')}</option>
              <option value="inactive">{t('organization.status.inactive')}</option>
            </Select>
          </>
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
          rowKey={(p) => p.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(p) => navigate(p.id)}
          embedded
        />
      </ListView>
    </PageContainer>
  );
};
