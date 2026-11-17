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
// Filters are search, lifecycle status, branch, department, job title and role. The branch
// filter has its own reference surface in this module (`/platform/branches/options`); the
// department and job-title choices come from the organization module's shared reference options,
// which the Employees list's filters read too.
//
// It NARROWS, it never widens. The rows are already scoped server-side, so picking a branch a
// department-scoped administrator cannot see returns nothing rather than something new — the filter
// is a reading aid over the caller's own slice, not a second authorization path. The field itself
// disappears for an administrator whose account cannot read the branch catalog, because a dropdown
// with nothing in it is a worse answer than no dropdown.
//
// «زود أدوار كل واحد + الإدارة بتاعته + مسماه الوظيفي .. وطبعاً هتزودهم فى الفلتر». Each row names
// its department and job title (resolved by the server, retired units included) and the roles it
// holds right now. Roles — column and filter — are shown only to an administrator who may see
// roles (`role.view`); the server sends `roles: null` to anyone else and refuses a role filter
// from them. The role filter SEARCHES the roles on the server and names the chosen ones by id
// (ADR-019); the department filter lists each COMPANY department once (`user-list-filters.ts`),
// and never lets a choice that resolves to nothing turn into "no filter".
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  USER_STATUSES,
  joinNameList,
  splitNameList,
  type Locale,
  type UserListItemDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Can, useCan } from '../../../../platform/rbac/Can';
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
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { readList, writeList } from '../../../../shared/lib/list-param';
import { formatDate, fullName } from '../../../../shared/lib/format';
import { PlusIcon } from '../../../../shared/ui/icons';
import {
  useDepartmentReferenceOptions,
  useJobTitleReferenceOptions,
} from '../../../organization/shared/references';
import { useRoleSearch, useRolesById } from '../../roles/api/role-queries';
import {
  NO_DEPARTMENT_MATCH,
  departmentChoices,
  departmentIdsFor,
  departmentKeyName,
  keysOfferedIn,
} from '../lib/user-list-filters';
import { AccountStatusBadge, UserStatusBadge } from '../components/UserStatusBadges';
import { UserFormDialog } from '../components/UserFormDialog';
import { useBranchOptions, useSystemUsers } from '../api/user-queries';
import { type SystemUserListParams } from '../api/user-api';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'dept',
  'job',
  'role',
  'q',
  'status',
  'size',
  'sort',
] as const;

/** Roles shown in a row before the rest fold into «+n» (all of them are in its tooltip). */
const ROLES_SHOWN = 3;

const DEFAULT_PAGE_SIZE = 25;

export const UsersListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [creating, setCreating] = useState(false);

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branch') ?? '';
  // `dept` holds COMPANY department keys (each standing for its branch copies), not ids.
  const departmentKeys = splitNameList(sp.get('dept') ?? '');
  const jobTitleIds = readList(sp, 'job');
  const roleIds = readList(sp, 'role');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
  const paramsKey = sp.toString();

  const can = useCan();
  const seesRoles = can('role.view');
  const departmentsQuery = useDepartmentReferenceOptions();
  const departmentOptions = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);
  // Settled either way: an answer, or a refusal/failure. Until then a chosen department cannot be
  // turned into ids, and the list waits rather than showing every account for a moment.
  const departmentsSettled = departmentsQuery.isSuccess || departmentsQuery.isError;
  const { data: jobTitleOptions = [] } = useJobTitleReferenceOptions();
  const branch = branchId === '' ? null : branchId;
  const departments = useMemo(
    () => departmentChoices(departmentOptions, branch),
    [departmentOptions, branch],
  );
  const departmentIds = useMemo(
    () => departmentIdsFor(departmentOptions, branch, departmentKeys),
    [departmentOptions, branch, departmentKeys.join(',')],
  );
  // A chosen department that resolves to nothing — closed since, or the options could not be read —
  // filters to NOBODY. Dropping it would answer "everybody" under a filter that still looks set.
  const departmentFilter =
    departmentKeys.length === 0
      ? []
      : departmentIds.length > 0
        ? departmentIds
        : departmentsSettled
          ? [NO_DEPARTMENT_MATCH]
          : [];

  const [roleTerm, setRoleTerm] = useState('');
  const roleSearch = useRoleSearch(roleTerm, seesRoles);
  const chosenRoles = useRolesById(roleIds, seesRoles);
  const roleOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const q of chosenRoles) if (q.data !== undefined) byId.set(q.data.id, q.data.name[locale]);
    for (const r of roleSearch.data?.items ?? []) byId.set(r.id, r.name[locale]);
    // A chosen role whose read failed is still listed, by id, so it can be un-ticked.
    for (const id of roleIds) if (!byId.has(id)) byId.set(id, id);
    return [...byId].map(([value, label]) => ({ value, label }));
  }, [chosenRoles, roleSearch.data, roleIds.join(','), locale]);

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
      ...(departmentFilter.length === 0 ? {} : { departmentId: departmentFilter }),
      ...(jobTitleIds.length === 0 ? {} : { jobTitleId: jobTitleIds }),
      ...(roleIds.length === 0 || !seesRoles ? {} : { roleId: roleIds }),
    }),
    [paramsKey, departmentFilter.join(','), seesRoles],
  );

  const { data, isLoading, isError, error, refetch } = useSystemUsers(
    params,
    departmentKeys.length === 0 || departmentsSettled,
  );
  const rows = data?.items ?? [];
  // `retry: false` on the query — the expected failure is a refusal, and the field's answer to that
  // is to not be there. `?? []` covers both "failed" and "still loading" with the same absence.
  const { data: branches = [] } = useBranchOptions();

  const columns: Column<UserListItemDto>[] = [
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
      key: 'department',
      header: t('systemAdmin.users.columns.department'),
      render: (u) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {u.department?.name[locale] ?? '—'}
        </span>
      ),
    },
    {
      key: 'jobTitle',
      header: t('systemAdmin.users.columns.jobTitle'),
      render: (u) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {u.jobTitle?.name[locale] ?? '—'}
        </span>
      ),
    },
    ...(seesRoles
      ? [
          {
            key: 'roles',
            header: t('systemAdmin.users.columns.roles'),
            render: (u: UserListItemDto) => {
              const roles = [...(u.roles ?? [])].sort((a, b) =>
                a.name[locale].localeCompare(b.name[locale], locale),
              );
              if (roles.length === 0) return <span className="text-xs text-slate-400">—</span>;
              const shown = roles.slice(0, ROLES_SHOWN);
              const rest = roles.length - shown.length;
              return (
                <div
                  className="flex max-w-xs flex-wrap gap-1"
                  title={roles.map((r) => r.name[locale]).join('، ')}
                >
                  {shown.map((r) => (
                    <Badge key={r.id} size="sm" tone="neutral">
                      {r.name[locale]}
                    </Badge>
                  ))}
                  {rest > 0 && (
                    <Badge size="sm" tone="neutral">
                      {t('systemAdmin.users.rolesMore', { count: rest })}
                    </Badge>
                  )}
                </div>
              );
            },
          } satisfies Column<UserListItemDto>,
        ]
      : []),
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
              onChange={(e) => {
                const next = e.target.value === '' ? null : e.target.value;
                // A department the new branch does not have goes with the change, rather than
                // lingering in the address and resolving to nothing.
                const kept = departmentsQuery.isSuccess
                  ? keysOfferedIn(departmentOptions, next, departmentKeys)
                  : departmentKeys;
                patch({ branch: next, dept: kept.length === 0 ? null : joinNameList(kept) });
              }}
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
          {(departments.length > 0 || departmentKeys.length > 0) && (
            <MultiSelect
              label={t('systemAdmin.users.columns.department')}
              value={departmentKeys}
              onChange={(next) => patch({ dept: next.length === 0 ? null : joinNameList(next) })}
              options={[
                ...departments.map((d) => ({ value: d.key, label: d.name[locale] })),
                // A chosen department not offered here is still listed, named, so it can be removed.
                ...departmentKeys
                  .filter((key) => !departments.some((d) => d.key === key))
                  .map((key) => ({
                    value: key,
                    label: departmentKeyName(departmentOptions, key)?.[locale] ?? key,
                  })),
              ]}
            />
          )}
          {jobTitleOptions.length > 0 && (
            <MultiSelect
              label={t('systemAdmin.users.columns.jobTitle')}
              value={jobTitleIds}
              onChange={(next) => patch({ job: writeList(next) })}
              options={jobTitleOptions.map((j) => ({ value: j.id, label: j.name[locale] }))}
            />
          )}
          {seesRoles && (
            <MultiSelect
              label={t('systemAdmin.users.columns.roles')}
              value={roleIds}
              onChange={(next) => patch({ role: writeList(next) })}
              options={roleOptions}
              onSearch={setRoleTerm}
              searching={roleSearch.isFetching}
            />
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
