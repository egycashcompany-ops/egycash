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
import { type PermissionDto } from '@ecms/contracts';

export interface MatrixRow {
  key: string;
  /** Absent for a key the registry no longer knows. */
  definition: PermissionDto | undefined;
}

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
