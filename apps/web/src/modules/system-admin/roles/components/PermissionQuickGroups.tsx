// Quick selection by TYPE, beside the role's permission tree (`../lib/action-groups`): one checkbox
// per type — read only, add, edit, delete, … — over every module or one chosen module.
//
// A checkbox here is exactly the tree's module and page checkboxes, cut the other way: the same
// tri-state over EVERY row it owns, the same press-to-fill-then-clear (`bulkIntent`), and the same
// `applyBulk`, which reaches only the keys this administrator may grant and never clears one he
// could not have given. Nothing new is decided here; the payload is still `permissionKeys[]`.
//
// The rows are the tree's own: `reachableCatalog` is the one definition of what an editor is
// shown, so a type never counts or ticks a permission the tree does not draw.
import { useMemo, useState } from 'react';
import { type PermissionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { Badge, Checkbox, Select } from '../../../../shared/ui';
import {
  applyBulk,
  bulkIntent,
  groupState,
  reachableCatalog,
  selectedCount,
  type MatrixRow,
} from '../lib/permission-selection';
import { ACTION_GROUPS, rowsOfGroup, type ActionGroupId } from '../lib/action-groups';

/** The types whose name alone does not say what they hold — each carries a line saying it. */
const HINTED: ReadonlySet<ActionGroupId> = new Set(['manage', 'other', 'sensitive', 'breakGlass']);

export const PermissionQuickGroups = ({
  catalog,
  selected,
  onBulkChange,
}: {
  catalog: PermissionDto[];
  selected: readonly string[];
  /** Receives the whole next key list, in the API's own shape — the matrix's `onBulkChange`. */
  onBulkChange: (next: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  /** `''` = every module. */
  const [scope, setScope] = useState('');

  const rows = useMemo(
    (): MatrixRow[] =>
      reachableCatalog(catalog, selected, can).map((permission) => ({
        key: permission.key,
        definition: permission,
      })),
    [catalog, selected],
  );
  const modules = useMemo(
    () => [...new Set(rows.map((row) => row.definition?.moduleId ?? ''))].filter((id) => id !== ''),
    [rows],
  );
  const chosen = useMemo(() => new Set(selected), [selected]);
  // A scope the catalogue no longer offers (it reloaded) reads as every module, never as nothing.
  const moduleId = scope !== '' && modules.includes(scope) ? scope : null;

  const groups = ACTION_GROUPS.map((group) => ({
    group,
    rows: rowsOfGroup(rows, group, moduleId),
  })).filter((entry) => entry.rows.length > 0);

  const press = (groupRows: MatrixRow[]): void =>
    onBulkChange(applyBulk(selected, groupRows, bulkIntent(groupRows, chosen, can), can));

  return (
    <section
      aria-labelledby="permission-quick-groups"
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
    >
      <div>
        <h3
          id="permission-quick-groups"
          className="text-sm font-semibold text-slate-800 dark:text-slate-100"
        >
          {t('systemAdmin.roles.quick.title')}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {t('systemAdmin.roles.quick.hint')}
        </p>
      </div>

      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        {t('systemAdmin.roles.quick.scope')}
        <Select className="mt-1" value={moduleId ?? ''} onChange={(e) => setScope(e.target.value)}>
          <option value="">{t('systemAdmin.roles.quick.allModules')}</option>
          {modules.map((id) => (
            <option key={id} value={id}>
              {t(`systemAdmin.roles.module.${id}`)}
            </option>
          ))}
        </Select>
      </label>

      {groups.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('systemAdmin.roles.quick.empty')}
        </p>
      ) : (
        <ul className="space-y-1">
          {groups.map(({ group, rows: groupRows }) => {
            const state = groupState(groupRows, chosen);
            return (
              <li
                key={group}
                className="rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <Checkbox
                    label={t(`systemAdmin.roles.quick.group.${group}`)}
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    onChange={() => press(groupRows)}
                    className="text-slate-700 dark:text-slate-200"
                  />
                  <span className="shrink-0 whitespace-nowrap">
                    <Badge size="sm" tone={state === 'none' ? 'neutral' : 'brand'}>
                      {t('systemAdmin.roles.quick.counter', {
                        selected: selectedCount(groupRows, chosen),
                        total: groupRows.length,
                      })}
                    </Badge>
                  </span>
                </div>
                {HINTED.has(group) && (
                  <p className="ms-6 mt-0.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                    {t(`systemAdmin.roles.quick.groupHint.${group}`)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
