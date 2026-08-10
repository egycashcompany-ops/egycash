// A role's grants, against the whole registry, as a tree: module → page → permission.
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
// **The page layer (P7-B).** Two hundred checkboxes under four module headings was a list with
// section breaks, not a structure: an administrator looking for "what can they do on the employees
// screen" had to know which permission keys that screen uses. The middle level is the registry's
// own `pageId` (P7-A), declared in code beside the permissions themselves — never inferred from the
// navigation catalogue, which is runtime data an administrator edits.
//
// **A page is organizational and never authorizational.** Nothing here checks a page, no request is
// refused because of one, and the page checkbox is a shortcut for clicking that page's boxes in
// turn — exactly what the module checkbox already was. `route` renders as a link because knowing
// which screen a page means is useful; nothing resolves it and no decision reads it.
//
// **Bulk selection.** Both levels are shortcuts for clicking the individual boxes, and neither may
// do anything an administrator could not do that way: a locked permission is not selected by them,
// and — the half that is easy to miss — not CLEARED by them either. A role can carry a key its
// editor lacks; that key's own box is locked, and a bulk clear that stripped it would be a way
// around the lock rather than a shortcut through it. The server's S1/S2 guards remain the authority
// (ADR-026); this is only the screen refusing to promise what the save would refuse.
//
// Every group's checkbox reports state over EVERY row it owns, not only the reachable ones, so a
// page with a locked unselected permission lands on indeterminate after "select all" — which is the
// truth, and the counter beside it is what makes that legible rather than puzzling. The same holds
// one level up: a module whose every page is full reads `all`; a module with one page full and
// another empty reads `some`, which a flat matrix could not express.
//
// Search filters what is DRAWN and nothing else, at every level. The bulk controls deliberately
// keep acting on the group's whole set, so their state and their effect never depend on an
// unrelated text box; a note says so while a search is active.
import { useMemo, useState } from 'react';
import {
  type Locale,
  type PageDto,
  type PermissionDto,
  type RoleManagement,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { Badge, Button, Card, CardBody, Checkbox, SearchInput } from '../../../../shared/ui';
import { ChevronIcon } from '../../../../shared/ui/icons';
import { cn } from '../../../../shared/lib/cn';
import {
  acceptsToggle,
  applyBulk,
  buildMatrixTree,
  bulkIntent,
  groupState,
  rowEditability,
  selectedCount,
  UNKNOWN_MODULE,
  visibleTree,
  type MatrixRow,
} from '../lib/permission-selection';

export { type MatrixRow } from '../lib/permission-selection';

export const RolePermissionMatrix = ({
  catalog,
  pages = [],
  selected,
  managed,
  onToggle,
  onBulkChange,
}: {
  catalog: PermissionDto[];
  /** The registry's administration surfaces (P7-A). Absent = every permission renders under Other. */
  pages?: PageDto[];
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

  const tree = useMemo(() => buildMatrixTree(catalog, pages, selected), [catalog, pages, selected]);
  const readOnly = onToggle === undefined || managed !== 'none';
  const chosen = useMemo(() => new Set(selected), [selected]);
  const allRows = useMemo(() => tree.flatMap((module) => module.rows), [tree]);

  const moduleLabel = (moduleId: string): string => t(`systemAdmin.roles.module.${moduleId}`);
  /** The Other bucket and the unknown module share one label — both mean "no surface owns this". */
  const pageLabel = (page: PageDto | null): string =>
    page === null ? t('systemAdmin.roles.matrix.unassigned') : page.name[locale];

  // An unknown key is not grantable, so it is never a bulk target — the same rule its own
  // checkbox already applies.
  const canGrant = (key: string): boolean => can(key);
  const bulkEnabled = !readOnly && onBulkChange !== undefined;

  const bulk = (rows: MatrixRow[]): void => {
    if (!bulkEnabled) return;
    onBulkChange(applyBulk(selected, rows, bulkIntent(rows, chosen, canGrant), canGrant));
  };

  const visible = useMemo(
    () => visibleTree(tree, search, { module: moduleLabel, page: pageLabel }),
    [tree, search, locale],
  );

  const toggleCollapsed = (id: string): void =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const total = allRows.length;
  const totalSelected = selectedCount(allRows, chosen);
  const overall = groupState(allRows, chosen);
  const filtering = search.trim() !== '';
  const collapsibleIds = tree.flatMap((module) => [
    module.moduleId,
    ...module.pages.map((entry) => `${module.moduleId}:${entry.page?.id ?? ''}`),
  ]);

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
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(collapsibleIds))}>
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

      {visible.map(({ module, pages: visiblePages }) => {
        const state = groupState(module.rows, chosen);
        const moduleCollapsed = collapsed.has(module.moduleId);
        const panelId = `module-${module.moduleId}`;
        return (
          <Card key={module.moduleId}>
            {/* Not `CardHeader`: its title is a heading, and a heading is the wrong place for an
                interactive control. Same styling, different semantics. */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                {bulkEnabled ? (
                  <Checkbox
                    label={moduleLabel(module.moduleId)}
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    onChange={() => bulk(module.rows)}
                    className="font-semibold text-slate-800 dark:text-slate-100"
                  />
                ) : (
                  <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {moduleLabel(module.moduleId)}
                  </h3>
                )}
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('systemAdmin.roles.matrix.counter', {
                    selected: selectedCount(module.rows, chosen),
                    total: module.rows.length,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleCollapsed(module.moduleId)}
                aria-expanded={!moduleCollapsed}
                aria-controls={panelId}
                aria-label={t(
                  moduleCollapsed
                    ? 'systemAdmin.roles.matrix.expandModule'
                    : 'systemAdmin.roles.matrix.collapseModule',
                )}
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <ChevronIcon
                  className={cn(
                    'h-4 w-4 transition-transform',
                    moduleCollapsed ? '' : 'rotate-180',
                  )}
                />
              </button>
            </div>

            {!moduleCollapsed && (
              <div id={panelId}>
                {visiblePages.map(({ entry, shown }) => {
                  const pageId = `${module.moduleId}:${entry.page?.id ?? ''}`;
                  const pageState = groupState(entry.rows, chosen);
                  const pageCollapsed = collapsed.has(pageId);
                  const pagePanelId = `page-${pageId.replace(/[.:]/g, '-')}`;
                  return (
                    <div
                      key={pageId}
                      className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-3 bg-slate-50/60 px-5 py-2.5 dark:bg-slate-900/40">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {bulkEnabled ? (
                              <Checkbox
                                label={pageLabel(entry.page)}
                                checked={pageState === 'all'}
                                indeterminate={pageState === 'some'}
                                onChange={() => bulk(entry.rows)}
                                className="text-slate-700 dark:text-slate-200"
                              />
                            ) : (
                              <h4 className="truncate text-sm text-slate-700 dark:text-slate-200">
                                {pageLabel(entry.page)}
                              </h4>
                            )}
                            {/* Documentation, not navigation policy: knowing which screen a page
                                means is useful, and nothing authorizes on it. */}
                            {entry.page?.route != null && (
                              <a
                                href={entry.page.route}
                                className="truncate font-mono text-[11px] text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300"
                                dir="ltr"
                              >
                                {entry.page.route}
                              </a>
                            )}
                            {entry.page === null && (
                              <Badge size="sm" tone="neutral">
                                {t('systemAdmin.roles.matrix.unassignedHint')}
                              </Badge>
                            )}
                          </div>
                          <p className="ms-6 mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                            {t('systemAdmin.roles.matrix.counter', {
                              selected: selectedCount(entry.rows, chosen),
                              total: entry.rows.length,
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(pageId)}
                          aria-expanded={!pageCollapsed}
                          aria-controls={pagePanelId}
                          aria-label={t(
                            pageCollapsed
                              ? 'systemAdmin.roles.matrix.expandPage'
                              : 'systemAdmin.roles.matrix.collapsePage',
                          )}
                          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                          <ChevronIcon
                            className={cn(
                              'h-4 w-4 transition-transform',
                              pageCollapsed ? '' : 'rotate-180',
                            )}
                          />
                        </button>
                      </div>

                      {!pageCollapsed && (
                        <CardBody>
                          <ul
                            id={pagePanelId}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                          >
                            {shown.map((row) => {
                              const held = can(row.key);
                              const unknown = row.definition === undefined;
                              // Grantable only when the actor holds it — the same rule the server
                              // applies. An unknown key is the exception in one direction only:
                              // removable, never re-addable. `rowEditability` is where both live.
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
                                  <p
                                    className="ms-6 truncate font-mono text-[11px] text-slate-400"
                                    dir="ltr"
                                  >
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
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};

/** The pseudo-module id for keys the registry has forgotten — re-exported for the tests. */
export { UNKNOWN_MODULE };
