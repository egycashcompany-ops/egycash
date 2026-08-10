// A role's grants, against the whole registry, grouped by the module that declares them.
//
// Three things this component refuses to hide, because each one is a decision an administrator has
// to be able to see:
//
//   • **A grant the actor does not hold is DISABLED, with the reason on it.** The server refuses it
//     anyway (nobody hands out an authority they lack), so a checkbox that looked available would
//     be a promise the save breaks. Disabled-and-explained is the honest rendering.
//   • **A key the registry does not know is shown as Unknown**, still ticked, and still removable.
//     Roles keep keys a retired module used to declare; pretending they are not there would make an
//     administrator unable to clean them up, and dropping them silently on save would be worse.
//   • **A managed role is read-only throughout.** Editing a `hr-only:*` derivative is not merely
//     unwise — the next boot restores it — so the whole matrix is inert rather than lying.
//
// **Bulk selection (this slice).** Two hundred checkboxes is not a form, so there is a select-all
// and one checkbox per module. Both are shortcuts for clicking the individual boxes, and neither
// may do anything an administrator could not do that way: a locked permission is not selected by
// them, and — the half that is easy to miss — not CLEARED by them either. A role can carry a key
// its editor lacks; that key's own box is locked, and a bulk clear that stripped it would be a way
// around the lock rather than a shortcut through it. The server's S1/S2 guards remain the authority
// (ADR-026); this is only the screen refusing to promise what the save would refuse.
//
// The module checkboxes report state over EVERY row, not only the reachable ones, so a module with
// a locked unselected permission lands on indeterminate after "select all" — which is the truth,
// and the counter beside it is what makes that legible rather than puzzling.
//
// Search filters what is DRAWN and nothing else. The bulk controls deliberately keep acting on the
// module's whole set, so their state and their effect never depend on an unrelated text box; a note
// says so while a search is active.
import { useMemo, useState } from 'react';
import { type Locale, type PermissionDto, type RoleManagement } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { Badge, Button, Card, CardBody, Checkbox, SearchInput } from '../../../../shared/ui';
import { ChevronIcon } from '../../../../shared/ui/icons';
import { cn } from '../../../../shared/lib/cn';
import {
  acceptsToggle,
  applyBulk,
  bulkIntent,
  groupState,
  matchesSearch,
  rowEditability,
  selectedCount,
  type MatrixRow,
} from '../lib/permission-selection';

export { type MatrixRow } from '../lib/permission-selection';

/** The registry plus whatever the role carries that the registry has forgotten. */
export const matrixRows = (
  catalog: PermissionDto[],
  roleKeys: readonly string[],
): Map<string, MatrixRow[]> => {
  const byKey = new Map(catalog.map((p) => [p.key, p]));
  const groups = new Map<string, MatrixRow[]>();
  for (const permission of catalog) {
    const rows = groups.get(permission.moduleId) ?? [];
    rows.push({ key: permission.key, definition: permission });
    groups.set(permission.moduleId, rows);
  }
  const orphans = roleKeys.filter((key) => !byKey.has(key));
  if (orphans.length > 0) {
    groups.set(
      'unknown',
      orphans.map((key) => ({ key, definition: undefined })),
    );
  }
  return groups;
};

export const RolePermissionMatrix = ({
  catalog,
  selected,
  managed,
  onToggle,
  onBulkChange,
}: {
  catalog: PermissionDto[];
  selected: readonly string[];
  managed: RoleManagement;
  /** Absent = read-only. */
  onToggle?: ((key: string, next: boolean) => void) | undefined;
  /** Absent = no bulk controls. Receives the whole next key list, in the API's own shape. */
  onBulkChange?: ((next: string[]) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => matrixRows(catalog, selected), [catalog, selected]);
  const readOnly = onToggle === undefined || managed !== 'none';
  const chosen = useMemo(() => new Set(selected), [selected]);
  const allRows = useMemo(() => [...groups.values()].flat(), [groups]);

  // An unknown key is not grantable, so it is never a bulk target — the same rule its own
  // checkbox already applies.
  const canGrant = (key: string): boolean => can(key);
  const bulkEnabled = !readOnly && onBulkChange !== undefined;

  const bulk = (rows: MatrixRow[]): void => {
    if (!bulkEnabled) return;
    onBulkChange(applyBulk(selected, rows, bulkIntent(rows, chosen, canGrant), canGrant));
  };

  const visible = useMemo(
    () =>
      [...groups.entries()]
        .map(([moduleId, rows]): [string, MatrixRow[], MatrixRow[]] => [
          moduleId,
          rows,
          rows.filter((row) => matchesSearch(row, search)),
        ])
        .filter(([, , shown]) => shown.length > 0),
    [groups, search],
  );

  const total = allRows.length;
  const totalSelected = selectedCount(allRows, chosen);
  const overall = groupState(allRows, chosen);
  const filtering = search.trim() !== '';

  return (
    <div className="space-y-4">
      {readOnly && managed !== 'none' ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t(`systemAdmin.roles.readOnly.${managed}`)}
        </p>
      ) : (
        !readOnly && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.roles.notHeldHint')}
          </p>
        )
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('systemAdmin.roles.matrix.searchPlaceholder')}
          className="min-w-48 flex-1"
        />
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
          {t('systemAdmin.roles.matrix.expandAll')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed(new Set(groups.keys()))}
        >
          {t('systemAdmin.roles.matrix.collapseAll')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
        {bulkEnabled ? (
          <Checkbox
            label={t('systemAdmin.roles.matrix.selectAll')}
            checked={overall === 'all'}
            indeterminate={overall === 'some'}
            onChange={() => bulk(allRows)}
          />
        ) : (
          <span className="text-sm text-slate-700 dark:text-slate-200">
            {t('systemAdmin.roles.matrix.selectAll')}
          </span>
        )}
        <Badge size="sm" tone={totalSelected === 0 ? 'neutral' : 'brand'}>
          {t('systemAdmin.roles.matrix.counter', { selected: totalSelected, total })}
        </Badge>
      </div>

      {filtering && bulkEnabled && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('systemAdmin.roles.matrix.searchScopeNote')}
        </p>
      )}

      {visible.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('systemAdmin.roles.matrix.noMatches')}
        </p>
      )}

      {visible.map(([moduleId, rows, shown]) => {
        const state = groupState(rows, chosen);
        const isCollapsed = collapsed.has(moduleId);
        const panelId = `module-${moduleId}`;
        return (
          <Card key={moduleId}>
            {/* Not `CardHeader`: its title is a heading, and a heading is the wrong place for an
                interactive control. Same styling, different semantics. */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                {bulkEnabled ? (
                  <Checkbox
                    label={t(`systemAdmin.roles.module.${moduleId}`)}
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    onChange={() => bulk(rows)}
                    className="font-semibold text-slate-800 dark:text-slate-100"
                  />
                ) : (
                  <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t(`systemAdmin.roles.module.${moduleId}`)}
                  </h3>
                )}
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('systemAdmin.roles.matrix.counter', {
                    selected: selectedCount(rows, chosen),
                    total: rows.length,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(moduleId)) next.delete(moduleId);
                    else next.add(moduleId);
                    return next;
                  })
                }
                aria-expanded={!isCollapsed}
                aria-controls={panelId}
                aria-label={t(
                  isCollapsed
                    ? 'systemAdmin.roles.matrix.expandModule'
                    : 'systemAdmin.roles.matrix.collapseModule',
                )}
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <ChevronIcon
                  className={cn('h-4 w-4 transition-transform', isCollapsed ? '' : 'rotate-180')}
                />
              </button>
            </div>
            {!isCollapsed && (
              <CardBody>
                <ul id={panelId} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((row) => {
                    const held = can(row.key);
                    const unknown = row.definition === undefined;
                    // Grantable only when the actor holds it — the same rule the server applies.
                    // An unknown key is the exception in one direction only: removable, never
                    // re-addable. `rowEditability` is where both rules live.
                    const editability = rowEditability(row, { held, readOnly });
                    const disabled = editability === 'locked';
                    return (
                      <li
                        key={row.key}
                        className={`min-w-0 rounded-md p-2 ${disabled ? 'opacity-70' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      >
                        <Checkbox
                          label={row.definition?.name[locale] ?? row.key}
                          checked={chosen.has(row.key)}
                          disabled={disabled}
                          onChange={(e) => {
                            if (!acceptsToggle(editability, e.target.checked)) return;
                            onToggle?.(row.key, e.target.checked);
                          }}
                          className="items-start"
                        />
                        <p className="ms-6 truncate font-mono text-[11px] text-slate-400" dir="ltr">
                          {row.key}
                        </p>
                        <div className="ms-6 mt-0.5 flex flex-wrap gap-1">
                          {unknown && (
                            <span title={t('systemAdmin.roles.unknownKeyHint')}>
                              <Badge size="sm" tone="warning">
                                {t('systemAdmin.roles.unknownKey')}
                              </Badge>
                            </span>
                          )}
                          {row.definition?.breakGlass === true && (
                            <Badge size="sm" tone="danger">
                              {t('systemAdmin.roles.breakGlass')}
                            </Badge>
                          )}
                          {!readOnly && !held && !unknown && (
                            <Badge size="sm" tone="neutral">
                              {t('systemAdmin.roles.notHeld')}
                            </Badge>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            )}
          </Card>
        );
      })}
    </div>
  );
};
