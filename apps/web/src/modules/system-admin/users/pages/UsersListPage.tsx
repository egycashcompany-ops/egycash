// Every login account in the system, in one place. The list is the administrator's entry point:
// find the account, then act on it from its detail screen.
//
// Two things about this screen are decided by the server and only reflected here:
//
//   • The ROWS. `GET /platform/users` is scoped by the caller's `user.view` grant through the
//     repository's hierarchy fields (`user.repository.ts` — branch ⊃ department ⊃ section), so a
//     branch-scoped administrator sees their branch and nothing else. There is no client filter
//     doing that, and there must not be one.
//   • The SORT. The API declares exactly three sortable fields (`email`, `status`, `createdAt`);
//     anything else silently falls back to `createdAt`, so only those three columns are sortable.
//     Offering a sortable "last login" header would produce a column that looks interactive and
//     changes nothing.
//
// Filters are search, lifecycle status and branch — the three `ListUsersQuery` accepts. The branch
// filter waited until SA-2, when this module gained its own branch reference surface
// (`/platform/branches/options`): the only one that existed before lived inside the organization
// module, which this module may not import.
//
// It NARROWS, it never widens. The rows are already scoped server-side, so picking a branch a
// department-scoped administrator cannot see returns nothing rather than something new — the filter
// is a reading aid over the caller's own slice, not a second authorization path. The field itself
// disappears for an administrator whose account cannot read the branch catalog, because a dropdown
// with nothing in it is a worse answer than no dropdown.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { USER_STATUSES, type Locale, type UserDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Can } from '../../../../platform/rbac/Can';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  type Column,
} from '../../../../shared/ui';
import { formatDate, fullName } from '../../../../shared/lib/format';
import { PlusIcon } from '../../../../shared/ui/icons';
import { AccountStatusBadge, UserStatusBadge } from '../components/UserStatusBadges';
import { UserFormDialog } from '../components/UserFormDialog';
import { useBranchOptions, useSystemUsers } from '../api/user-queries';
import { type SystemUserListParams } from '../api/user-api';

const DEFAULT_PAGE_SIZE = 25;

export const UsersListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branch') ?? '';
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

  const params = useMemo<SystemUserListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search,
      ...(status === '' ? {} : { status }),
      ...(branchId === '' ? {} : { branchId }),
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useSystemUsers(params);
  const rows = data?.items ?? [];
  // `retry: false` on the query — the expected failure is a refusal, and the field's answer to that
  // is to not be there. `?? []` covers both "failed" and "still loading" with the same absence.
  const { data: branches = [] } = useBranchOptions();

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      header: t('systemAdmin.users.columns.name'),
      render: (u) => (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">
            {fullName(u, locale)}
          </span>
          {/* The one thing that distinguishes the two populations this screen serves. */}
          <Badge size="sm" tone={u.employeeId === null ? 'neutral' : 'brand'}>
            {t(u.employeeId === null ? 'systemAdmin.users.kind.system' : 'systemAdmin.users.kind.employee')}
          </Badge>
        </div>
      ),
    },
    {
      key: 'email',
      header: t('systemAdmin.users.columns.identifier'),
      sortable: true,
      render: (u) => (
        <div className="min-w-0" dir="ltr">
          <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
            {u.username ?? u.email ?? '—'}
          </p>
          {u.username !== null && u.email !== null && (
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{u.email}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('systemAdmin.users.columns.status'),
      sortable: true,
      render: (u) => <UserStatusBadge status={u.status} />,
    },
    {
      key: 'accountStatus',
      header: t('systemAdmin.users.columns.account'),
      render: (u) => <AccountStatusBadge status={u.accountStatus} />,
    },
    {
      key: 'lastLoginAt',
      header: t('systemAdmin.users.columns.lastLogin'),
      render: (u) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {u.lastLoginAt === null ? t('systemAdmin.users.never') : formatDate(u.lastLoginAt, locale)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('systemAdmin.users.columns.created'),
      sortable: true,
      render: (u) => formatDate(u.createdAt, locale),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.users.title')}
        description={t('systemAdmin.users.subtitle')}
        breadcrumbs={[{ label: t('systemAdmin.module.title') }, { label: t('systemAdmin.users.title') }]}
        actions={
          <Can permission="user.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('systemAdmin.users.actions.create')}
            </Button>
          </Can>
        }
      />

      {creating && (
        <UserFormDialog
          open
          user={null}
          onClose={() => setCreating(false)}
          onCreated={(created) => navigate(created.id)}
        />
      )}

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('systemAdmin.users.searchPlaceholder')}
          />
          <Select
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            aria-label={t('systemAdmin.users.columns.status')}
          >
            <option value="">{t('systemAdmin.users.filters.anyStatus')}</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`systemAdmin.users.status.${s}`)}
              </option>
            ))}
          </Select>
          {branches.length > 0 && (
            <Select
              value={branchId}
              onChange={(e) => patch({ branch: e.target.value || null })}
              aria-label={t('systemAdmin.users.filters.branch')}
            >
              <option value="">{t('systemAdmin.users.filters.anyBranch')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name[locale]}
                </option>
              ))}
            </Select>
          )}
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(u) => navigate(u.id)}
          empty={<EmptyState title={t('systemAdmin.users.empty')} />}
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
