// The arithmetic behind the permission matrix's bulk selection.
//
// Extracted from the component because the rules are small, exact, and the kind that go wrong
// silently: a bulk selector that quietly ticks a permission the administrator is not allowed to
// grant produces a role the server then refuses — or worse, one it accepts because the guard was
// somewhere else. Rendering tests would not pin any of this; these functions can be checked
// directly.
//
// **One rule governs every bulk operation: it may only do what the administrator could do by
// clicking each checkbox in turn.** A permission the actor does not hold is disabled individually
// (P3 — the server refuses to hand out an authority you lack), so "select all" must not reach it
// either, in EITHER direction. It cannot be added, and — the half that is easy to miss — it cannot
// be REMOVED: a role may carry a key its editor lacks, that key's own checkbox is locked, and a
// bulk clear that stripped it would be a way around the lock rather than a shortcut through it.
import { type PageDto, type PermissionDto } from '@ecms/contracts';

export interface MatrixRow {
  key: string;
  /** Absent for a key the registry no longer knows. */
  definition: PermissionDto | undefined;
}

/**
 * One administration surface inside a module, with the permissions that belong to it.
 *
 * `page: null` is the module's **Other / Unassigned** bucket — the permissions the registry
 * deliberately placed nowhere (P7-A, decision D1). It is a real group with real rows, not an error
 * state, and it renders last so a module reads as "its surfaces, then the leftovers".
 */
export interface MatrixPage {
  page: PageDto | null;
  rows: MatrixRow[];
}

/**
 * One module's branch of the tree.
 *
 * `rows` is **exactly** the concatenation of `pages[].rows`, and that is the whole reason this
 * shape exists rather than the component flattening on the fly. Every module-level control —
 * select-all, the tri-state, the counter — takes `rows`, and every page-level control takes that
 * page's `rows`, so "the module is the union of its pages" is true by CONSTRUCTION rather than by
 * two code paths agreeing. A test pins it anyway, because the property is the point.
 */
export interface MatrixModule {
  moduleId: string;
  pages: MatrixPage[];
  rows: MatrixRow[];
}

/** The pseudo-module holding keys the registry no longer declares (distinct from Unassigned). */
export const UNKNOWN_MODULE = 'unknown';

/**
 * Build the Module → Page → Permission tree from the registry and a role's current keys.
 *
 * Two different kinds of "has no page" meet here and must not be conflated:
 *
 *   • A permission the registry KNOWS and deliberately did not place (`pageId: null`) belongs to
 *     its own module, in that module's Other / Unassigned group. It is grantable like any other.
 *   • A key the registry does NOT know — carried by the role because some retired module declared
 *     it — belongs to no module at all. It goes under `UNKNOWN_MODULE`, is never a bulk target, and
 *     is removable but never re-addable (`rowEditability`).
 *
 * Module order follows the catalog; page order follows the registry's own ordering (the server
 * sorts by module, `sortOrder`, then id) with Unassigned last; the unknown module sorts last of all.
 */
export const buildMatrixTree = (
  catalog: readonly PermissionDto[],
  pages: readonly PageDto[],
  roleKeys: readonly string[],
): MatrixModule[] => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const modules: string[] = [];
  const byModule = new Map<string, Map<string, MatrixRow[]>>();

  for (const permission of catalog) {
    if (!byModule.has(permission.moduleId)) {
      modules.push(permission.moduleId);
      byModule.set(permission.moduleId, new Map());
    }
    // `?? ''` is the Unassigned bucket's key inside this map — no page id can be empty.
    const bucket = permission.pageId !== null && byId.has(permission.pageId) ? permission.pageId : '';
    const group = byModule.get(permission.moduleId) ?? new Map<string, MatrixRow[]>();
    group.set(bucket, [...(group.get(bucket) ?? []), { key: permission.key, definition: permission }]);
    byModule.set(permission.moduleId, group);
  }

  const tree: MatrixModule[] = modules.map((moduleId) => {
    const group = byModule.get(moduleId) ?? new Map<string, MatrixRow[]>();
    const ordered: MatrixPage[] = pages
      .filter((page) => page.moduleId === moduleId && group.has(page.id))
      .map((page) => ({ page, rows: group.get(page.id) ?? [] }));
    const unassigned = group.get('');
    if (unassigned !== undefined && unassigned.length > 0) {
      ordered.push({ page: null, rows: unassigned });
    }
    return { moduleId, pages: ordered, rows: ordered.flatMap((entry) => entry.rows) };
  });

  const orphans = roleKeys
    .filter((key) => !catalog.some((permission) => permission.key === key))
    .map((key): MatrixRow => ({ key, definition: undefined }));
  if (orphans.length > 0) {
    tree.push({
      moduleId: UNKNOWN_MODULE,
      pages: [{ page: null, rows: orphans }],
      rows: orphans,
    });
  }
  return tree;
};

/** A group's selection, as a checkbox can express it. */
export type TriState = 'none' | 'some' | 'all';

/** What one row's checkbox is allowed to do. */
export type RowEditability = 'editable' | 'removeOnly' | 'locked';

/**
 * The three answers a single permission row can give, and why there are three rather than two.
 *
 * A key the registry no longer knows is the case that needs its own answer. It is carried by the
 * role because some retired module once declared it, and the two obvious treatments are both wrong:
 * locking it makes the administrator unable to clean it up — the row is visible, marked Unknown, and
 * completely inert — while treating it as ordinary would let it be handed back out after removal,
 * granting an authority nothing in the system defines any more. So it comes OFF and never back ON.
 *
 * `held` is the actor's own grant. A permission they do not hold is locked in both directions: the
 * server refuses to hand out an authority the caller lacks, and a role may legitimately carry one
 * its editor cannot grant — stripping that from this screen would be a way around the lock rather
 * than a shortcut through it.
 */
export const rowEditability = (
  row: MatrixRow,
  { held, readOnly }: { held: boolean; readOnly: boolean },
): RowEditability => {
  if (readOnly) return 'locked';
  if (row.definition === undefined) return 'removeOnly';
  return held ? 'editable' : 'locked';
};

/** Does this row accept being toggled to `next`? The one call the checkbox makes before reporting. */
export const acceptsToggle = (editability: RowEditability, next: boolean): boolean =>
  editability === 'editable' || (editability === 'removeOnly' && !next);

/**
 * The rows a bulk control may act on: known to the registry, and held by the actor.
 *
 * `canGrant` is the caller's own permission check — the component passes `useCan()`, tests pass a
 * set — so this file never decides WHO holds what, only what follows from it.
 */
export const grantableKeys = (rows: readonly MatrixRow[], canGrant: (key: string) => boolean): string[] =>
  rows.filter((row) => row.definition !== undefined && canGrant(row.key)).map((row) => row.key);

/**
 * What the group's checkbox should show — computed over EVERY row, not only the grantable ones.
 *
 * A module holding one locked, unselected permission is genuinely not fully selected, and a
 * checkbox claiming otherwise would be the lie this whole screen avoids. The consequence is real
 * and intended: pressing "select all" on such a module lands on `some`, not `all`. The counter
 * beside it (`selectedCount` / `rows.length`) is what turns that from a puzzle into a fact.
 */
export const groupState = (rows: readonly MatrixRow[], selected: ReadonlySet<string>): TriState => {
  if (rows.length === 0) return 'none';
  const chosen = rows.filter((row) => selected.has(row.key)).length;
  if (chosen === 0) return 'none';
  return chosen === rows.length ? 'all' : 'some';
};

export const selectedCount = (rows: readonly MatrixRow[], selected: ReadonlySet<string>): number =>
  rows.filter((row) => selected.has(row.key)).length;

/**
 * Apply a bulk selection to `current`, returning the new key list.
 *
 * Selecting adds every grantable key in `rows`; clearing removes them. Everything else in `current`
 * survives untouched — keys from other modules, and the locked ones this control may not reach.
 * Order is preserved and duplicates cannot arise, so the payload stays a plain `permissionKeys[]`
 * exactly as the API has always received it.
 */
export const applyBulk = (
  current: readonly string[],
  rows: readonly MatrixRow[],
  next: boolean,
  canGrant: (key: string) => boolean,
): string[] => {
  const targets = new Set(grantableKeys(rows, canGrant));
  if (!next) return current.filter((key) => !targets.has(key));
  const kept = new Set(current);
  return [...current, ...[...targets].filter((key) => !kept.has(key))];
};

/**
 * Does pressing this control mean "select" or "clear"?
 *
 * Anything short of every grantable key selected means there is still something to add, so the
 * press selects. Only when the reachable set is already complete does it clear — which keeps a
 * half-filled module one press from full, the direction an administrator is nearly always heading.
 */
export const bulkIntent = (
  rows: readonly MatrixRow[],
  selected: ReadonlySet<string>,
  canGrant: (key: string) => boolean,
): boolean => grantableKeys(rows, canGrant).some((key) => !selected.has(key));

/** Case-insensitive match on the key and on either language's name. */
export const matchesSearch = (row: MatrixRow, search: string): boolean => {
  const term = search.trim().toLowerCase();
  if (term === '') return true;
  return (
    row.key.toLowerCase().includes(term) ||
    (row.definition?.name.ar.toLowerCase().includes(term) ?? false) ||
    (row.definition?.name.en.toLowerCase().includes(term) ?? false)
  );
};

/** What a search leaves on screen. `entry`/`module` keep their FULL rows; `shown` is the drawing. */
export interface VisiblePage {
  entry: MatrixPage;
  shown: MatrixRow[];
}
export interface VisibleModule {
  module: MatrixModule;
  pages: VisiblePage[];
}

/**
 * Filter the tree for display, **without ever losing a level's context**.
 *
 * Searching "employees" should show the Employees page with its permissions under the HR module,
 * not a flat list of matching keys — a permission shown outside the surface that administers it is
 * harder to judge, not easier. So a match at a HIGHER level keeps everything below it: a module
 * whose name matches shows all its pages, and a page whose name matches shows all its permissions.
 *
 * Names are resolved by the caller, because a module's label is an i18n key in the web app while a
 * page's travels with the registry. This function is given strings and decides nothing about where
 * they came from.
 *
 * Crucially the returned `entry` and `module` still carry their COMPLETE row sets. Every checkbox,
 * counter and tri-state reads those, so search changes what is drawn and never what a control does
 * or reports — the P6 rule, now at two levels instead of one.
 */
export const visibleTree = (
  tree: readonly MatrixModule[],
  search: string,
  label: { module: (moduleId: string) => string; page: (page: PageDto | null) => string },
): VisibleModule[] => {
  const term = search.trim().toLowerCase();
  if (term === '') {
    return tree.map((module) => ({
      module,
      pages: module.pages.map((entry) => ({ entry, shown: entry.rows })),
    }));
  }
  return tree.flatMap((module): VisibleModule[] => {
    const moduleHit = label.module(module.moduleId).toLowerCase().includes(term);
    const pages = module.pages.flatMap((entry): VisiblePage[] => {
      const pageHit = label.page(entry.page).toLowerCase().includes(term);
      // A hit on the module or the page keeps every row beneath it; otherwise the rows filter.
      const shown =
        moduleHit || pageHit ? entry.rows : entry.rows.filter((row) => matchesSearch(row, search));
      return shown.length === 0 ? [] : [{ entry, shown }];
    });
    return pages.length === 0 ? [] : [{ module, pages }];
  });
};
