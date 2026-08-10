// Every role in the system. The three filters answer the three questions an administrator opens
// this screen with: "which role grants X" (search covers permission keys, not just names), "which
// of these may I edit" (managed), and "which are effectively off" (unassigned).
//
// There is no status column because there is no status field. Disabling a role IS revoking its
// assignments — adding a flag would put a second switch inside the authorization path, where the
// one that is already there decides everything. `unassigned` is computed from the assignments, so
// it cannot drift from the truth.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ROLE_MANAGEMENT, type Locale, type RoleDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  type Column,
} from '../../../../shared/ui';
import { PlusIcon } from '../../../../shared/ui/icons';
import { formatDate } from '../../../../shared/lib/format';
import { ManagedRoleBadge } from '../components/ManagedRoleBadge';
import { RoleFormDialog } from '../components/RoleFormDialog';
import { useRoles } from '../api/role-queries';
import { type RoleListParams } from '../api/role-api';

const DEFAULT_PAGE_SIZE = 25;

export const RolesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const search = sp.get('q') ?? '';
  const managed = sp.get('managed') ?? '';
  const unassigned = sp.get('unassigned') === 'true';
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

  const params = useMemo<RoleListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search,
      ...(managed === '' ? {} : { managed }),
      ...(unassigned ? { unassigned: true } : {}),
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useRoles(params);
  const rows = data?.items ?? [];

  const columns: Column<RoleDto>[] = [
    {
      key: 'name.en',
      header: t('systemAdmin.roles.columns.name'),
      sortable: true,
      render: (role) => (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">
            {role.name[locale]}
          </span>
          <ManagedRoleBadge managed={role.managed} />
        </div>
      ),
    },
    {
      key: 'permissionKeys',
      header: t('systemAdmin.roles.columns.permissions'),
      render: (role) => (
        <Badge size="sm" tone="neutral">
          {t('systemAdmin.roles.permissionCount', { count: role.permissionKeys.length })}
        </Badge>
      ),
    },
    {
      key: 'key',
      header: t('systemAdmin.roles.columns.key'),
      render: (role) => (
        <span className="font-mono text-xs text-slate-400" dir="ltr">
          {role.key ?? '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('systemAdmin.roles.columns.created'),
      sortable: true,
      render: (role) => formatDate(role.createdAt, locale),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.roles.title')}
        description={t('systemAdmin.roles.subtitle')}
        breadcrumbs={[{ label: t('systemAdmin.module.title') }, { label: t('systemAdmin.roles.title') }]}
        actions={
          <Can permission="role.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('systemAdmin.roles.actions.create')}
            </Button>
          </Can>
        }
      />

      {creating && (
        <RoleFormDialog
          open
          role={null}
          onClose={() => setCreating(false)}
          onCreated={(created) => navigate(created.id)}
        />
      )}

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('systemAdmin.roles.searchPlaceholder')}
          />
          <Select
            value={managed}
            onChange={(e) => patch({ managed: e.target.value || null })}
            aria-label={t('systemAdmin.roles.columns.managed')}
          >
            <option value="">{t('systemAdmin.roles.filters.anyManaged')}</option>
            {ROLE_MANAGEMENT.map((value) => (
              <option key={value} value={value}>
                {t(`systemAdmin.roles.managed.${value}`)}
              </option>
            ))}
          </Select>
          <Checkbox
            label={t('systemAdmin.roles.filters.unassigned')}
            checked={unassigned}
            onChange={(e) => patch({ unassigned: e.target.checked ? 'true' : null })}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(role) => role.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(role) => navigate(role.id)}
          empty={<EmptyState title={t('systemAdmin.roles.empty')} />}
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
