// Job Titles list: free-text search + status filter, a sortable table showing grade + salary band,
// and a permission-gated create entry point. Filters/sort/pagination are URL-synchronized.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type JobTitleDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Select } from '../../../../shared/ui/form';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { PlusIcon } from '../../../../shared/ui/icons';
import { formatMoney, localized } from '../../../../shared/lib/format';
import { useJobTitles } from '../job-title-queries';

const DEFAULT_PAGE_SIZE = 25;

const salaryBand = (jt: JobTitleDto, locale: Locale, dash: string): string => {
  if (jt.salaryMin === null && jt.salaryMax === null) return dash;
  const lo = jt.salaryMin === null ? '' : formatMoney(jt.salaryMin, 'EGP', locale);
  const hi = jt.salaryMax === null ? '' : formatMoney(jt.salaryMax, 'EGP', locale);
  if (lo !== '' && hi !== '') return `${lo} – ${hi}`;
  return lo || hi;
};

export const JobTitlesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

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

  const { data, isLoading, isError, error, refetch } = useJobTitles(params);
  const rows = data?.items ?? [];
  const dash = '—';

  const columns: Column<JobTitleDto>[] = [
    {
      key: 'code',
      header: t('organization.field.code'),
      sortable: true,
      render: (jt) => (
        <span className="font-mono text-xs" dir="ltr">
          {jt.code}
        </span>
      ),
    },
    { key: 'name', header: t('organization.field.name'), render: (jt) => localized(jt.name, locale) },
    { key: 'grade', header: t('organization.jobTitle.grade'), render: (jt) => jt.jobGrade },
    {
      key: 'salary',
      header: t('organization.jobTitle.salary'),
      align: 'end',
      render: (jt) => salaryBand(jt, locale, dash),
    },
    {
      key: 'experience',
      header: t('organization.jobTitle.experience'),
      align: 'end',
      render: (jt) =>
        jt.requiredExperienceYears === null
          ? dash
          : t('organization.jobTitle.years', { n: jt.requiredExperienceYears }),
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (jt) => (
        <StatusBadge
          tone={jt.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${jt.status}`)}
        />
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.jobTitles')}
        description={t('organization.jobTitle.subtitle')}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.jobTitles') },
        ]}
        actions={
          <Can permission="jobTitle.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.jobTitle.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar hasActiveFilters={search !== '' || status !== ''} onClear={() => setSp(new URLSearchParams())}>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.filter.search')}
          />
          <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(jt) => jt.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(jt) => navigate(jt.id)}
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
