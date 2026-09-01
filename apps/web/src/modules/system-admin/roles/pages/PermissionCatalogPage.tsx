// The permission registry, read-only — the vocabulary every role is written in.
//
// It lives beside the roles screens rather than in a feature of its own because a permission is not
// an editable record: the registry is declared in code and shipped with the deployment, so there is
// nothing here to create, edit or delete. What an administrator needs from it is the answer to
// "what does this key actually mean, and do I hold it?" before granting it — which is why every row
// carries its key verbatim, its module, its break-glass flag and whether the reader holds it.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type PermissionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  SearchInput,
  Select,
} from '../../../../shared/ui';
import { usePermissionCatalog } from '../api/role-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'held',
  'module',
  'q',
] as const;

/** Group in a stable order rather than whatever the registry happens to emit. */
const byModule = (permissions: PermissionDto[]): [string, PermissionDto[]][] => {
  const groups = new Map<string, PermissionDto[]>();
  for (const permission of permissions) {
    const rows = groups.get(permission.moduleId) ?? [];
    rows.push(permission);
    groups.set(permission.moduleId, rows);
  }
  return [...groups.entries()].map(([moduleId, rows]) => [
    moduleId,
    [...rows].sort((a, b) => a.key.localeCompare(b.key)),
  ]);
};

export const PermissionCatalogPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = (sp.get('q') ?? '').trim().toLowerCase();
  const moduleFilter = sp.get('module') ?? '';
  const heldOnly = sp.get('held') === 'true';

  const { data: catalog = [], isLoading, isError, error, refetch } = usePermissionCatalog();

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next);
  };

  const modules = useMemo(
    () => [...new Set(catalog.map((p) => p.moduleId))].sort(),
    [catalog],
  );

  // Filtering happens here rather than on the server: the registry is a fixed, deployment-sized
  // list already held in memory, so a round trip per keystroke would buy nothing.
  const groups = useMemo(() => {
    const matches = catalog.filter((permission) => {
      if (moduleFilter !== '' && permission.moduleId !== moduleFilter) return false;
      if (heldOnly && !can(permission.key)) return false;
      if (search === '') return true;
      return (
        permission.key.toLowerCase().includes(search) ||
        permission.name.ar.toLowerCase().includes(search) ||
        permission.name.en.toLowerCase().includes(search)
      );
    });
    return byModule(matches);
  }, [catalog, moduleFilter, heldOnly, search, can]);

  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.permissions.title')}
        description={t('systemAdmin.permissions.subtitle')}
        breadcrumbs={[
          { label: t('systemAdmin.module.title') },
          { label: t('systemAdmin.permissions.title') },
        ]}
        aside={
          <Badge size="sm" tone="neutral">
            {t('systemAdmin.permissions.count', { count: total })}
          </Badge>
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={sp.get('q') ?? ''}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('systemAdmin.permissions.searchPlaceholder')}
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
          <Checkbox
            label={t('systemAdmin.permissions.heldOnly')}
            checked={heldOnly}
            onChange={(e) => patch({ held: e.target.checked ? 'true' : null })}
          />
        </FilterBar>

        {isLoading && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {!isLoading && !isError && total === 0 && (
          <EmptyState title={t('systemAdmin.permissions.empty')} />
        )}

        {groups.map(([moduleId, rows]) => (
          <Card key={moduleId}>
            <CardHeader
              title={t(`systemAdmin.roles.module.${moduleId}`)}
              description={t('systemAdmin.roles.moduleCount', { count: rows.length })}
            />
            <CardBody>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((permission) => (
                  <li
                    key={permission.key}
                    className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {permission.name[locale]}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400" dir="ltr">
                      {permission.key}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {permission.breakGlass && (
                        <Badge size="sm" tone="danger">
                          {t('systemAdmin.roles.breakGlass')}
                        </Badge>
                      )}
                      {/* Two literal calls rather than one conditional key: the i18n spec scans the
                          source for `t('systemAdmin.…')`, and a key assembled inside the call is
                          invisible to it. */}
                      {can(permission.key) ? (
                        <Badge size="sm" tone="success">
                          {t('systemAdmin.permissions.held')}
                        </Badge>
                      ) : (
                        <Badge size="sm" tone="neutral">
                          {t('systemAdmin.roles.notHeld')}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
};
