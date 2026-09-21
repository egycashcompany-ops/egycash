// Every role in the company, GROUPED BY DEPARTMENT.
//
// It used to be one flat table sorted by creation date, which is readable while there are six
// roles and unreadable by the time there are thirty: «انا مش عاوز الادوار سايحه على بعض انا عاوز
// تنظيم فى الادوار على حسب الادارات». A role's department is organizational only — nothing in the
// authorization path reads it — so this changes how the list is arranged and nothing about what
// any role grants. Roles nobody filed under a department group under «عام» rather than vanishing.
//
// The page size is the shared default (ADR-019 rule 5 — a screen does not ask for a bigger page to
// avoid paging), so the list is SORTED by department on the server. That keeps a department's roles
// contiguous: a group never appears twice under the same heading on two pages.
//
// The three filters answer the three questions an administrator opens
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
  Card,
  CardBody,
  Checkbox,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  Pagination,
  SearchInput,
} from '../../../../shared/ui';
import { Input, Select } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { ManagedRoleBadge } from '../components/ManagedRoleBadge';
import { useMoveRoleToGroup, useRenameRoleGroup, useRoles } from '../api/role-queries';
import { type RoleListParams } from '../api/role-api';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'managed',
  'q',
  'unassigned',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/**
 * A heading's name, edited in place.
 *
 * Its own component so the input keeps its own draft: lifting it into the page would re-render
 * every group on each keystroke, and committing on every change would fire a rename per letter.
 * Enter commits, Escape and blur abandon — the same contract every inline field on this app has.
 */
const GroupNameInput = ({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}): JSX.Element => {
  const [value, setValue] = useState(initial);
  const commit = (): void => {
    const next = value.trim();
    if (next === '') onCancel();
    else onSubmit(next);
  };
  return (
    <Input
      autoFocus
      value={value}
      disabled={busy}
      aria-label={initial}
      className="w-auto max-w-56 font-semibold"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
};

export const RolesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  const managed = sp.get('managed') ?? '';
  const unassigned = sp.get('unassigned') === 'true';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'group:asc').split(':');
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

  const rename = useRenameRoleGroup();
  const move = useMoveRoleToGroup();
  const [renaming, setRenaming] = useState<string | null>(null);
  /**
   * Headings the administrator has just made, before any role sits under one.
   *
   * A group is not a record — it exists because roles name it (see `RenameRoleGroupSchema`) — so a
   * brand-new one has nowhere to be stored until it has a member. Keeping it here rather than
   * pretending it saved is the honest rendering: the heading appears, says it is empty, and the
   * first role moved into it is what commits it.
   */
  const [pending, setPending] = useState<string[]>([]);

  /** A fresh heading, named so it is unique on sight and editable on the spot. */
  const addGroup = (): void => {
    const taken = new Set([...rows.map((r) => r.group), ...pending]);
    let n = 1;
    let name = t('systemAdmin.roles.newGroupName', { n });
    while (taken.has(name)) {
      n += 1;
      name = t('systemAdmin.roles.newGroupName', { n });
    }
    setPending((p) => [...p, name]);
    setRenaming(name);
  };

  /**
   * The page's roles under their headings, unfiled ones last.
   *
   * Grouped from what the page actually returned rather than asked for per heading: one read, and
   * a heading can never disagree with the rows under it.
   */
  const groups = useMemo(() => {
    const by = new Map<string | null, RoleDto[]>();
    for (const name of pending) by.set(name, []);
    for (const role of rows) {
      const key = role.group;
      by.set(key, [...(by.get(key) ?? []), role]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, locale)))
      .map(([name, roles]) => ({
        name,
        label: name ?? t('systemAdmin.roles.noGroup'),
        roles: [...roles].sort((x, y) => x.name[locale].localeCompare(y.name[locale], locale)),
      }));
  }, [rows, pending, locale, t]);

  /** Every heading a role may be moved to — «عام» included, which is how a role leaves one. */
  const groupNames = useMemo(
    () => groups.map((g) => g.name).filter((n): n is string => n !== null),
    [groups],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.roles.title')}
        breadcrumbs={[{ label: t('systemAdmin.module.title') }, { label: t('systemAdmin.roles.title') }]}
        actions={
          <Can permission="role.create">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={addGroup}>
                {t('systemAdmin.roles.actions.newGroup')}
              </Button>
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => navigate('new')}
              >
                {t('systemAdmin.roles.actions.create')}
              </Button>
            </div>
          </Can>
        }
      />


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

        {isLoading && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {!isLoading && !isError && groups.length === 0 && (
          <EmptyState title={t('systemAdmin.roles.empty')} />
        )}

        {groups.map((group) => (
          <Card key={group.name ?? 'none'}>
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              {renaming === group.name && group.name !== null ? (
                <GroupNameInput
                  initial={group.name}
                  busy={rename.isPending}
                  onCancel={() => setRenaming(null)}
                  onSubmit={(next) => {
                    setRenaming(null);
                    if (next === group.name) return;
                    // A heading nobody has filed a role under yet lives only in this component,
                    // so renaming it is renaming the draft — there is nothing on the server yet.
                    if (group.roles.length === 0) {
                      setPending((p) => p.map((n) => (n === group.name ? next : n)));
                      return;
                    }
                    rename.mutate(
                      { from: group.name, to: next },
                      { onSuccess: () => setPending((p) => p.filter((n) => n !== group.name)) },
                    );
                  }}
                />
              ) : (
                <>
                  <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {group.label}
                  </h3>
                  {group.name !== null && (
                    <Can permission="role.edit">
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(group.name)}>
                        {t('systemAdmin.roles.actions.renameGroup')}
                      </Button>
                    </Can>
                  )}
                </>
              )}
              <span className="text-xs text-slate-400">
                {t('systemAdmin.roles.groupCount', { count: group.roles.length })}
              </span>
              {group.roles.length === 0 && (
                <Badge size="sm" tone="warning">
                  {t('systemAdmin.roles.groupUnsaved')}
                </Badge>
              )}
            </div>
            <CardBody padded={false}>
              {group.roles.length === 0 ? (
                <p className="px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {t('systemAdmin.roles.groupEmptyHint')}
                </p>
              ) : (
                <ul>
                  {group.roles.map((role) => (
                    <li
                      key={role.id}
                      className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(role.id)}
                        className="min-w-0 flex-1 truncate text-start text-sm font-medium text-slate-800 dark:text-slate-100"
                      >
                        {role.name[locale]}
                      </button>
                      <ManagedRoleBadge managed={role.managed} />
                      {/* The one fact that tells «الموارد البشرية» from «الموارد البشرية Test». */}
                      <Badge size="sm" tone={role.holderCount === 0 ? 'warning' : 'neutral'}>
                        {role.holderCount === 0
                          ? t('systemAdmin.roles.heldByNobody')
                          : t('systemAdmin.roles.heldBy', { count: role.holderCount })}
                      </Badge>
                      <Badge size="sm" tone="neutral">
                        {t('systemAdmin.roles.permissionCount', { count: role.permissionKeys.length })}
                      </Badge>
                      <Can permission="role.edit">
                        <Select
                          value={role.group ?? ''}
                          aria-label={t('systemAdmin.roles.moveToGroup')}
                          className="w-auto"
                          disabled={move.isPending}
                          onChange={(e) => {
                            const next = e.target.value === '' ? null : e.target.value;
                            move.mutate(
                              { id: role.id, group: next, version: role.version },
                              {
                                onSuccess: () =>
                                  setPending((p) => p.filter((n) => n !== next)),
                              },
                            );
                          }}
                        >
                          <option value="">{t('systemAdmin.roles.noGroup')}</option>
                          {groupNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      </Can>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}

        {data !== undefined && data.meta.totalPages > 1 && (
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
