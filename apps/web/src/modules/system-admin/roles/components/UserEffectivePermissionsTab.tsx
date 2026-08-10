// What this account may actually do — and, for every permission, why.
//
// The screen exists for one question, and it is almost always asked in the negative: "why can't
// they do X?" That is why nothing is hidden. A permission whose window has closed keeps its row and
// says so; a permission granted twice shows both grants and marks which one decides the reach; a
// key the registry no longer declares still appears, under Unknown, because a role can outlive the
// module that named it.
//
// Grouped by module because that is how an administrator looks for a permission — they know the
// area before they know the key. Filtered in the browser, not on the server: the row count is
// bounded by the registry that ships with the deployment (about two hundred keys at most, for an
// account that holds everything), so a round trip per keystroke would buy nothing. The filters live
// in the URL so a support conversation can link to exactly what it is talking about.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PERMISSION_STATES,
  type EffectivePermissionRowDto,
  type Locale,
  type PermissionState,
  type UserDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  SearchInput,
  Select,
} from '../../../../shared/ui';
import { ChevronIcon } from '../../../../shared/ui/icons';
import { formatDateTime } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { AssignmentScopeBadge } from './AssignmentScopeBadge';
import { EffectiveSourceList } from './EffectiveSourceList';
import { PermissionStateBadge } from './PermissionStateBadge';
import { useEffectivePermissions } from '../api/role-queries';

/** Stable grouping, and the unknown-module bucket last where it belongs. */
const byModule = (rows: EffectivePermissionRowDto[]): [string, EffectivePermissionRowDto[]][] => {
  const groups = new Map<string, EffectivePermissionRowDto[]>();
  for (const row of rows) {
    const moduleId = row.moduleId ?? 'unknown';
    groups.set(moduleId, [...(groups.get(moduleId) ?? []), row]);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b),
  );
};

export const UserEffectivePermissionsTab = ({ user }: { user: UserDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The endpoint needs both; without either it answers 403, and an error panel is a worse way to
  // say "you may not read this" than saying it.
  const mayRead = can('user.view') && can('role.view');
  const { data, isLoading, isError, error, refetch } = useEffectivePermissions(user.id, mayRead);

  const search = (sp.get('q') ?? '').trim().toLowerCase();
  const moduleFilter = sp.get('module') ?? '';
  const stateParam = sp.get('state') ?? '';
  const stateFilter: PermissionState | '' = PERMISSION_STATES.includes(
    stateParam as PermissionState,
  )
    ? (stateParam as PermissionState)
    : '';

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  const rows = data?.rows ?? [];
  const modules = useMemo(
    () => [...new Set(rows.map((row) => row.moduleId ?? 'unknown'))].sort(),
    [rows],
  );

  const groups = useMemo(() => {
    const matches = rows.filter((row) => {
      if (moduleFilter !== '' && (row.moduleId ?? 'unknown') !== moduleFilter) return false;
      if (stateFilter !== '' && row.state !== stateFilter) return false;
      if (search === '') return true;
      return (
        row.key.toLowerCase().includes(search) ||
        (row.name?.ar.toLowerCase().includes(search) ?? false) ||
        (row.name?.en.toLowerCase().includes(search) ?? false) ||
        row.sources.some((source) =>
          `${source.roleName.ar} ${source.roleName.en}`.toLowerCase().includes(search),
        )
      );
    });
    return byModule(matches);
  }, [rows, moduleFilter, stateFilter, search]);

  const shown = groups.reduce((sum, [, group]) => sum + group.length, 0);

  if (!mayRead) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('systemAdmin.effective.noAccess')}
          </p>
        </CardBody>
      </Card>
    );
  }
  if (isLoading) return <LoadingState />;
  if (isError || data === undefined) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const toggle = (key: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('systemAdmin.effective.title')}
          description={t('systemAdmin.effective.hint')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {data.isPrivileged && (
                <Badge size="sm" tone="warning">
                  {t('systemAdmin.effective.privileged')}
                </Badge>
              )}
              <Badge size="sm" tone="neutral">
                {t('systemAdmin.effective.count', { count: rows.length })}
              </Badge>
            </div>
          }
        />
        <CardBody>
          {/* Not decoration: the enforcement path reads a cached snapshot whose TTL is capped at
              the next validity boundary, so this projection and what the account can do right this
              second can differ for a bounded moment. Saying which moment is described is the
              difference between a report and a claim. */}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.effective.evaluatedAt', {
              at: formatDateTime(data.evaluatedAt, locale),
            })}
          </p>
          {data.isPrivileged && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t('systemAdmin.effective.privilegedBecause', {
                roles:
                  data.privilegedBecause.systemRoles.join('، ') ||
                  t('systemAdmin.effective.none'),
                keys:
                  data.privilegedBecause.breakGlassKeys.join('، ') ||
                  t('systemAdmin.effective.none'),
              })}
            </p>
          )}
        </CardBody>
      </Card>

      <FilterBar>
        <SearchInput
          value={sp.get('q') ?? ''}
          onChange={(value) => patch({ q: value || null })}
          placeholder={t('systemAdmin.effective.searchPlaceholder')}
        />
        <Select
          value={moduleFilter}
          onChange={(e) => patch({ module: e.target.value || null })}
          aria-label={t('systemAdmin.permissions.module')}
        >
          <option value="">{t('systemAdmin.permissions.anyModule')}</option>
          {modules.map((moduleId) => (
            <option key={moduleId} value={moduleId}>
              {t(`systemAdmin.roles.module.${moduleId}`)}
            </option>
          ))}
        </Select>
        <Select
          value={stateFilter}
          onChange={(e) => patch({ state: e.target.value || null })}
          aria-label={t('systemAdmin.effective.stateFilter')}
        >
          <option value="">{t('systemAdmin.effective.anyState')}</option>
          {PERMISSION_STATES.map((value) => (
            <option key={value} value={value}>
              {t(`systemAdmin.effective.state.${value}`)}
            </option>
          ))}
        </Select>
      </FilterBar>

      {shown === 0 && <EmptyState title={t('systemAdmin.effective.empty')} />}

      {groups.map(([moduleId, group]) => (
        <Card key={moduleId}>
          <CardHeader
            title={t(`systemAdmin.roles.module.${moduleId}`)}
            description={t('systemAdmin.roles.moduleCount', { count: group.length })}
          />
          <CardBody>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.map((row) => {
                const open = expanded.has(row.key);
                const panelId = `sources-${row.key.replace(/\W/g, '-')}`;
                return (
                  <li key={row.key} className="py-2">
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-expanded={open}
                      aria-controls={panelId}
                      className="flex w-full items-start justify-between gap-3 rounded-md p-1 text-start hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {row.name?.[locale] ?? row.key}
                        </span>
                        <span
                          className="block truncate font-mono text-[11px] text-slate-400"
                          dir="ltr"
                        >
                          {row.key}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        {row.breakGlass && (
                          <Badge size="sm" tone="danger">
                            {t('systemAdmin.roles.breakGlass')}
                          </Badge>
                        )}
                        {row.moduleId === null && (
                          <Badge size="sm" tone="warning">
                            {t('systemAdmin.roles.unknownKey')}
                          </Badge>
                        )}
                        {row.scope !== null && <AssignmentScopeBadge scope={row.scope} />}
                        <PermissionStateBadge state={row.state} />
                        <Badge size="sm" tone="neutral">
                          {t('systemAdmin.effective.sourceCount', { count: row.sources.length })}
                        </Badge>
                        <ChevronIcon
                          className={cn(
                            'h-4 w-4 text-slate-400 transition-transform',
                            open ? 'rotate-180' : '',
                          )}
                        />
                      </span>
                    </button>
                    {open && (
                      <div className="ms-1 mt-2">
                        <EffectiveSourceList sources={row.sources} id={panelId} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
};
