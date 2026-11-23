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
// The departments sit SIDE BY SIDE, one card each, in columns that wrap onto the next row
// (2026-11-22, «بدل ما الإدارات تتحت بعض وتحت كل واحده الأدوار لأ عايز الإدارات تبقي جنب بعض»; the
// owner chose this over a board of columns that scrolls sideways, which hides every department past
// the fourth). A phone has room for one card, so there they stack as before.
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
  Select,
} from '../../../../shared/ui';
import { PlusIcon } from '../../../../shared/ui/icons';
import { ManagedRoleBadge } from '../components/ManagedRoleBadge';
import { RoleFormDialog } from '../components/RoleFormDialog';
import { useDepartmentCatalog, useRoles } from '../api/role-queries';
import { type RoleListParams } from '../api/role-api';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';
import { cn } from '../../../../shared/lib/cn';
import { BOARD_FRAME, BOARD_LIST_FILL } from '../../../../shared/ui/board-scroll';

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
 * The department cards, side by side: as many to a row as the list has room for at 20rem (320 px)
 * a card, and never more than four; the cards past the last column wrap onto the next row. On a
 * 1440 screen that is three, at 1536 four, at 768 and 1024 two, and on a phone one
 * (`min(100%, …)`: a card is never wider than the list). `items-start` keeps each card the height of
 * its own roles rather than of the tallest card in its row.
 *
 * Counted from the list's own width rather than the screen's — `VAN_GRID` in operations does the
 * same — because the navigation, pinned open, takes 240 px of it (the launchpad's panel) or 280 px
 * (the rail and its panel): four columns by the screen's width would leave a pinned 1536 screen a
 * card of 286–296 px, and a role's name about 80 px beside its two chips. 20rem rather than more
 * leaves room for a scrollbar that takes layout space (Windows, or a Mac with a mouse): the list
 * scrolls on a computer, and 15 px less must not drop a column. At most four: a card is at least a
 * quarter of the list less its three gaps, so a 2560 screen lays four wide cards rather than seven
 * narrow ones.
 */
const DEPARTMENT_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,max(20rem,calc((100%_-_3rem)/4))),1fr))] items-start gap-4';

/**
 * A role's or a department's name, written in full: it wraps between words, and a word too long for
 * its card (a Latin name with no space, `operations.supervisor.cairo`) breaks inside itself rather
 * than running under the chips or out of the card — and, on a phone, rather than widening the card
 * past the screen.
 */
const NAME_WRAP = 'min-w-0 leading-snug [overflow-wrap:anywhere]';

export const RolesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [creating, setCreating] = useState(false);

  const search = sp.get('q') ?? '';
  const managed = sp.get('managed') ?? '';
  const unassigned = sp.get('unassigned') === 'true';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'departmentCatalogId:asc').split(':');
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

  const { data: catalog = [] } = useDepartmentCatalog();
  const departmentName = (id: string | null): string =>
    id === null
      ? t('systemAdmin.roles.noDepartment')
      : (catalog.find((d) => d.id === id)?.name[locale] ?? t('systemAdmin.roles.noDepartment'));

  /**
   * The page's roles, in department order, with the unfiled ones last.
   *
   * Grouped from what the page actually returned rather than asked for per department: one read,
   * and a group can never disagree with the rows under it.
   */
  const groups = useMemo(() => {
    const by = new Map<string | null, RoleDto[]>();
    for (const role of rows) {
      const key = role.departmentCatalogId;
      by.set(key, [...(by.get(key) ?? []), role]);
    }
    return [...by.entries()]
      .sort(([a], [b]) =>
        a === null ? 1 : b === null ? -1 : departmentName(a).localeCompare(departmentName(b), locale),
      )
      .map(([id, roles]) => ({
        id,
        name: departmentName(id),
        roles: [...roles].sort((x, y) => x.name[locale].localeCompare(y.name[locale], locale)),
      }));
  }, [rows, catalog, locale]);

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-11-17 «ميبقاش الصفحات كلها بتعمل Scroll
          لكن الجداول بس»): on a computer the title and the filters keep their place, the pager keeps
          its place below, and only the department groups scroll. */}
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('systemAdmin.roles.title')}
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

        <div className={cn(BOARD_LIST_FILL, 'space-y-4')}>
          {isLoading && <LoadingState />}
          {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
          {!isLoading && !isError && groups.length === 0 && (
            <EmptyState title={t('systemAdmin.roles.empty')} />
          )}

          {groups.length > 0 && (
            <div className={DEPARTMENT_GRID}>
              {groups.map((group) => (
                <Card key={group.id ?? 'none'}>
                  <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                    <h3
                      className={cn(NAME_WRAP, 'text-sm font-semibold text-slate-800 dark:text-slate-100')}
                    >
                      {group.name}
                    </h3>
                    <span className="shrink-0 text-xs text-slate-400">
                      {t('systemAdmin.roles.groupCount', { count: group.roles.length })}
                    </span>
                  </div>
                  <CardBody padded={false}>
                    <ul>
                      {group.roles.map((role) => (
                        <li key={role.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => navigate(role.id)}
                            className="flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            {/* The whole name, wrapped rather than cut: a card can be as little as
                                a quarter of the list, and «مسؤول مراجعة السيارات» cut to «مسؤول
                                مراجعة…» reads the same as every other «مسؤول مراجعة». */}
                            <span
                              className={cn(
                                NAME_WRAP,
                                'flex-1 text-sm font-medium text-slate-800 dark:text-slate-100',
                              )}
                            >
                              {role.name[locale]}
                            </span>
                            <ManagedRoleBadge managed={role.managed} className="shrink-0" />
                            <Badge size="sm" tone="neutral" className="shrink-0">
                              {t('systemAdmin.roles.permissionCount', { count: role.permissionKeys.length })}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>

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
