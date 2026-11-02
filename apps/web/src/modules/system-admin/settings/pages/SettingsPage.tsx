// Every configurable value in ECMS, on one screen — and not one of them defined here.
//
// The settings service has always been complete: declarations in code with a Zod type and a
// default, values in Mongo, resolution `user → branch → organization → default`, an audit row and a
// cache invalidation on every write. What it never had was a surface. Twenty-nine values, seven of
// them the password and lockout policy, could only be changed by editing the database. This slice
// adds the surface and **nothing else** — no endpoint, no permission, no setting, no model.
//
// Two consequences of reusing the API exactly as it stands, both visible on screen rather than
// papered over:
//
//   • **The values are the CALLER's.** `GET /settings/me` resolves for whoever asks, and no
//     endpoint returns the raw organization value. Where the caller's own layer wins, the row says
//     so and warns that an organization write will not change the number beside it.
//   • **The definitions carry no constraints.** `type` is derived from the Zod type name, so the
//     screen knows `number` and not `.min(8).max(64)`. It parses and submits; the server refuses
//     with a 422 whose message is the only description of the rule that cannot go stale, and the
//     row prints it verbatim.
//
// «وحاول تظبط الـ UI بتاعت الصفحة دي عموماً وتقسم الحاجات طبقاً للإدارات أو General». The settings
// are grouped by DEPARTMENT — General (sign-in, audit, notifications), then each module — and by
// section inside it (`settings-catalog.ts`). The department tabs filter; «الكل» shows every one of
// them, one after another. Every row reads in the page's language.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  useMySettings,
  useSettingDefinitions,
} from '../../../../platform/settings/settings-api';
import { cn } from '../../../../shared/lib/cn';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { SettingRow, useSettingText } from '../components/SettingRow';
import { SETTING_DEPARTMENTS } from '../lib/settings-catalog';
import {
  buildSettingGroups,
  countRows,
  filterSettingGroups,
  type SettingDepartmentModel,
} from '../lib/settings-view';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'dept',
  'q',
] as const;

const tabClass = (selected: boolean): string =>
  cn(
    'inline-flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm transition-colors',
    selected
      ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
  );

export const SettingsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const canEdit = can('setting.edit');
  const textOf = useSettingText();

  // Addressable, like every other list in this module: the filters live in the URL so a screen
  // full of them can be sent to somebody else.
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const query = sp.get('q') ?? '';
  const requested = sp.get('dept') ?? '';
  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete(name);
    else next.set(name, value);
    setSp(next, { replace: true });
  };

  const definitions = useSettingDefinitions();
  const values = useMySettings();

  const groups = useMemo(
    () => buildSettingGroups(definitions.data ?? [], values.data ?? []),
    [definitions.data, values.data],
  );
  // The search runs over every department, so each tab can say how many of ITS settings match.
  const searched = useMemo(
    () =>
      filterSettingGroups(groups, query, '', (row) => {
        const text = textOf(row);
        return `${text.label} ${text.description}`;
      }),
    // `t` (inside `textOf`) is rebuilt on every locale change, which is exactly when the search
    // must be re-run.
    [groups, query, textOf],
  );
  // A department the registry has nothing for (or a stale remembered one) falls back to «all».
  const department = SETTING_DEPARTMENTS.some(
    (id) => id === requested && groups.some((group) => group.department === id),
  )
    ? requested
    : '';
  const visible: SettingDepartmentModel[] =
    department === '' ? searched : searched.filter((group) => group.department === department);

  const total = countRows(groups);
  const shown = countRows(visible);
  const matchesIn = (id: string): number =>
    countRows(searched.filter((group) => group.department === id));

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.settings.title')}
      />

      {definitions.isError ? (
        // `GET /settings/definitions` is the half of the screen that carries `setting.view`; a
        // failure here is "we could not read the registry", never "there is nothing to configure".
        <ErrorState error={definitions.error} onRetry={() => void definitions.refetch()} />
      ) : definitions.isLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : (
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label={t('systemAdmin.settings.departmentsLabel')}
            className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={department === ''}
              className={tabClass(department === '')}
              onClick={() => setParam('dept', '')}
            >
              {t('systemAdmin.settings.departments.all')}
              <span className="text-xs text-slate-400 dark:text-slate-500">{countRows(searched)}</span>
            </button>
            {groups.map((group) => (
              <button
                key={group.department}
                type="button"
                role="tab"
                aria-selected={department === group.department}
                className={tabClass(department === group.department)}
                onClick={() => setParam('dept', group.department)}
              >
                {t(`systemAdmin.settings.departments.${group.department}`)}
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {matchesIn(group.department)}
                </span>
              </button>
            ))}
          </div>

          <FilterBar
            hasActiveFilters={query !== '' || department !== ''}
            onClear={() => setSp(new URLSearchParams(), { replace: true })}
          >
            <SearchInput
              value={query}
              onChange={(value) => setParam('q', value)}
              placeholder={t('systemAdmin.settings.searchPlaceholder')}
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.settings.count', { shown, total })}
            </span>
          </FilterBar>

          {!canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {t('systemAdmin.settings.readOnly')}
            </p>
          )}

          {visible.length === 0 ? (
            <EmptyState title={t('systemAdmin.settings.empty')} />
          ) : (
            visible.map((group) => (
              <section
                key={group.department}
                data-settings-department={group.department}
                aria-label={t(`systemAdmin.settings.departments.${group.department}`)}
                className="space-y-3"
              >
                {/* Under «all», each department is introduced; under its own tab the tab says it. */}
                {department === '' && (
                  <h2 className="flex items-baseline gap-2 pt-2 text-base font-semibold text-slate-800 dark:text-slate-100">
                    {t(`systemAdmin.settings.departments.${group.department}`)}
                    <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                      {t('systemAdmin.settings.groupCount', { count: countRows([group]) })}
                    </span>
                  </h2>
                )}
                {group.sections.map((section) => (
                  <Card key={section.id}>
                    <CardHeader
                      title={t(`systemAdmin.settings.sections.${group.department}.${section.id}`)}
                      description={t('systemAdmin.settings.groupCount', {
                        count: section.rows.length,
                      })}
                    />
                    <CardBody>
                      <div data-settings-section={`${group.department}.${section.id}`}>
                        {section.rows.map((row) => (
                          <SettingRow key={row.key} row={row} canEdit={canEdit} />
                        ))}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </section>
            ))
          )}
        </div>
      )}
    </PageContainer>
  );
};
