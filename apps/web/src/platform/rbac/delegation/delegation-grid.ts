// The arithmetic behind one site's «screen × actions» table.
//
// Pure, because the rules are small and the kind that go wrong silently. The ONE rule: a tick may
// only do what the manager could do by hand — a key outside their ceiling in this site is locked in
// both directions. It cannot be added, and it cannot be removed by a page-level clear either: a
// key somebody else granted stays until somebody entitled removes it.
//
// Two conveniences the owner asked for by name:
//   • ticking a screen ticks every action the manager may grant on it; clearing it clears them;
//   • clearing a screen's «view» clears the screen — an action on a screen one cannot open is not
//     a grant anybody meant.
import { type DelegationCatalogDto, type PageDto, type PermissionDto } from '@ecms/contracts';

export interface GridRow {
  /** `null` for keys the registry places on no page — they group last, under «other». */
  page: PageDto | null;
  keys: PermissionDto[];
}

export type Selection = ReadonlySet<string>;

const VIEW_ACTION = 'view';

/** A registry entry for a key the catalog does not carry — granted by somebody with more than us. */
const unknownEntry = (key: string): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? '',
  moduleId: 'unknown',
  name: { ar: key, en: key },
  breakGlass: false,
  pageId: null,
});

/**
 * The rows of one site's table: every page that has at least one key the manager may grant here
 * OR that the account already holds here, with those keys — the registry's own grouping (P7-A).
 */
export const buildRows = (
  catalog: DelegationCatalogDto,
  ceiling: Selection,
  granted: Selection,
): GridRow[] => {
  const relevant = new Set([...ceiling, ...granted]);
  const known = new Map(catalog.permissions.map((p) => [p.key, p]));
  const entries = [...relevant].map((key) => known.get(key) ?? unknownEntry(key));
  const pages = new Map(catalog.pages.map((p) => [p.id, p]));
  const byPage = new Map<string | null, PermissionDto[]>();
  for (const entry of entries) {
    const id = entry.pageId !== null && pages.has(entry.pageId) ? entry.pageId : null;
    byPage.set(id, [...(byPage.get(id) ?? []), entry]);
  }
  const order = (a: PermissionDto, b: PermissionDto): number =>
    a.action === VIEW_ACTION ? -1 : b.action === VIEW_ACTION ? 1 : a.key.localeCompare(b.key);
  const rows: GridRow[] = [];
  for (const page of catalog.pages) {
    const keys = byPage.get(page.id);
    if (keys !== undefined) rows.push({ page, keys: [...keys].sort(order) });
  }
  const other = byPage.get(null);
  if (other !== undefined) rows.push({ page: null, keys: [...other].sort(order) });
  return rows;
};

/** What a site starts with when the manager adds it: everything they may grant there. */
export const defaultSelection = (ceiling: Selection): Set<string> => new Set(ceiling);

/** Tick or clear one action. Locked keys are inert; clearing «view» clears the screen. */
export const toggleKey = (
  selected: Selection,
  key: string,
  row: GridRow,
  ceiling: Selection,
): Set<string> => {
  const next = new Set(selected);
  if (!ceiling.has(key)) return next;
  if (!next.has(key)) {
    next.add(key);
    return next;
  }
  next.delete(key);
  // «An action on a screen one cannot open» is only a statement about a SCREEN. The page-less row
  // is not one: the registry puts unrelated keys there on purpose, so a `view` among them says
  // nothing about the rest and clearing it must not take them with it.
  if (row.page === null) return next;
  const entry = row.keys.find((k) => k.key === key);
  if (entry?.action === VIEW_ACTION) {
    for (const k of row.keys) if (ceiling.has(k.key)) next.delete(k.key);
  }
  return next;
};

/** The screen's checkbox: clears the screen when anything on it is ticked, else ticks all of it. */
export const togglePage = (selected: Selection, row: GridRow, ceiling: Selection): Set<string> => {
  const next = new Set(selected);
  const grantable = row.keys.filter((k) => ceiling.has(k.key)).map((k) => k.key);
  const anyOn = row.keys.some((k) => selected.has(k.key));
  for (const key of grantable) {
    if (anyOn) next.delete(key);
    else next.add(key);
  }
  return next;
};

/** Over EVERY key of the row, locked ones included — the truth, not the reachable part of it. */
export const pageState = (selected: Selection, row: GridRow): 'all' | 'some' | 'none' => {
  const on = row.keys.filter((k) => selected.has(k.key)).length;
  if (on === 0) return 'none';
  return on === row.keys.length ? 'all' : 'some';
};

/** The footer's line for one site. */
export const summarize = (
  rows: GridRow[],
  selected: Selection,
): { screens: number; actions: number; everything: boolean } => {
  const screens = rows.filter((r) => r.keys.some((k) => selected.has(k.key))).length;
  const actions = rows.reduce((n, r) => n + r.keys.filter((k) => selected.has(k.key)).length, 0);
  const total = rows.reduce((n, r) => n + r.keys.length, 0);
  return { screens, actions, everything: total > 0 && actions === total };
};

export const sameSelection = (a: Selection, b: Selection): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k));
