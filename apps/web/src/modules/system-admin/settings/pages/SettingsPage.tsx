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
// Grouping is by the key's first segment, which IS the owner by the convention every declaration
// follows. A key whose owner this screen does not know still appears, under Other.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  useMySettings,
  useSettingDefinitions,
} from '../../../../platform/settings/settings-api';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Select } from '../../../../shared/ui/form';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { SettingRow } from '../components/SettingRow';
import {
  KNOWN_OWNERS,
  OTHER_OWNER,
  buildSettingGroups,
  filterSettingGroups,
  settingLabelKey,
} from '../lib/settings-view';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'owner',
  'q',
] as const;

export const SettingsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const canEdit = can('setting.edit');

  // Addressable, like every other list in this module: the filters live in the URL so a screen
  // full of them can be sent to somebody else.
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const query = sp.get('q') ?? '';
  const owner = sp.get('owner') ?? '';
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
  const visible = useMemo(
    () => filterSettingGroups(groups, query, owner, (key) => t(settingLabelKey(key))),
    // `t` is rebuilt on every locale change, which is exactly when the search must be re-run.
    [groups, query, owner, t],
  );

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const shown = visible.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.settings.title')}
        description={t('systemAdmin.settings.subtitle')}
      />

      {definitions.isError ? (
        // `GET /settings/definitions` is the half of the screen that carries `setting.view`; a
        // failure here is "we could not read the registry", never "there is nothing to configure".
        <ErrorState error={definitions.error} onRetry={() => void definitions.refetch()} />
      ) : definitions.isLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : (
        <div className="space-y-4">
          <FilterBar
            hasActiveFilters={query !== '' || owner !== ''}
            onClear={() => setSp(new URLSearchParams(), { replace: true })}
          >
            <SearchInput
              value={query}
              onChange={(value) => setParam('q', value)}
              placeholder={t('systemAdmin.settings.searchPlaceholder')}
            />
            <Select
              aria-label={t('systemAdmin.settings.ownerFilter')}
              value={owner}
              onChange={(event) => setParam('owner', event.target.value)}
              className="w-auto"
            >
              <option value="">{t('systemAdmin.settings.allOwners')}</option>
              {[...KNOWN_OWNERS, OTHER_OWNER].map((id) => (
                <option key={id} value={id}>
                  {t(`systemAdmin.settings.owners.${id}`)}
                </option>
              ))}
            </Select>
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
              <Card key={group.owner}>
                <CardHeader
                  title={t(`systemAdmin.settings.owners.${group.owner}`)}
                  description={t('systemAdmin.settings.groupCount', { count: group.rows.length })}
                />
                <CardBody>
                  {group.rows.map((row) => (
                    <SettingRow key={row.key} row={row} canEdit={canEdit} />
                  ))}
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}
    </PageContainer>
  );
};
