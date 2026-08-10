// The Module → Page → Permission tree, and the property the whole layer rests on.
//
// The selection arithmetic is unchanged from P6 — `applyBulk`, `bulkIntent`, `groupState` and
// `selectedCount` all still take a flat `MatrixRow[]`, and this slice only decides WHICH rows each
// control is handed. That is deliberate: adding a level to the tree must not add a second
// definition of what "select all" means, or the two levels would drift the first time either
// changed. So the tests here are about the SHAPE, plus one that pins the equivalence the shape
// exists to guarantee.
import { describe, expect, it } from 'vitest';
import { type PageDto, type PermissionDto } from '@ecms/contracts';
import {
  applyBulk,
  buildMatrixTree,
  bulkIntent,
  groupState,
  selectedCount,
  UNKNOWN_MODULE,
  visibleTree,
  type MatrixModule,
} from './permission-selection';

const permission = (key: string, moduleId: string, pageId: string | null): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
  pageId,
});

const page = (id: string, moduleId: string, en: string, ar: string): PageDto => ({
  id,
  moduleId,
  name: { en, ar },
  route: `/${id.replace('.', '/')}`,
  sortOrder: null,
});

const PAGES: PageDto[] = [
  page('platform.users', 'platform', 'System Users', 'مستخدمو النظام'),
  page('platform.roles', 'platform', 'Roles', 'الأدوار'),
  page('hr.employees', 'hr', 'Employees', 'الموظفون'),
];

const CATALOG: PermissionDto[] = [
  permission('user.view', 'platform', 'platform.users'),
  permission('user.create', 'platform', 'platform.users'),
  permission('user.delete', 'platform', 'platform.users'),
  permission('role.view', 'platform', 'platform.roles'),
  // Known to the registry and deliberately placed nowhere — Other / Unassigned.
  permission('setting.view', 'platform', null),
  permission('setting.edit', 'platform', null),
  permission('employee.view', 'hr', 'hr.employees'),
];

const labels = {
  module: (id: string) => ({ platform: 'Platform', hr: 'Human Resources' })[id] ?? id,
  page: (p: PageDto | null) => p?.name.en ?? 'Other / Unassigned',
};

const moduleOf = (tree: MatrixModule[], id: string): MatrixModule => {
  const found = tree.find((m) => m.moduleId === id);
  if (found === undefined) throw new Error(`module ${id} missing from the tree`);
  return found;
};

describe('buildMatrixTree — the shape', () => {
  const tree = buildMatrixTree(CATALOG, PAGES, []);

  it('groups permissions under the page their registry entry names', () => {
    const platform = moduleOf(tree, 'platform');
    expect(platform.pages.map((entry) => entry.page?.id ?? null)).toEqual([
      'platform.users',
      'platform.roles',
      null,
    ]);
    expect(platform.pages[0]?.rows.map((r) => r.key)).toEqual([
      'user.view',
      'user.create',
      'user.delete',
    ]);
  });

  // D1: `pageId: null` is an answer the registry gave, not a gap. It renders, and it renders LAST.
  it('puts the deliberately unassigned permissions in the module’s own Other bucket, last', () => {
    const platform = moduleOf(tree, 'platform');
    const unassigned = platform.pages.at(-1);
    expect(unassigned?.page).toBeNull();
    expect(unassigned?.rows.map((r) => r.key)).toEqual(['setting.view', 'setting.edit']);
  });

  it('never invents a page for them, and never moves them out of their module', () => {
    for (const entry of moduleOf(tree, 'platform').pages) {
      for (const row of entry.rows) expect(row.definition?.moduleId).toBe('platform');
    }
    expect(moduleOf(tree, 'hr').pages.map((e) => e.page?.id)).toEqual(['hr.employees']);
  });

  it('omits a page the registry declares but this role’s catalog has no permission for', () => {
    const single = buildMatrixTree([permission('user.view', 'platform', 'platform.users')], PAGES, []);
    expect(moduleOf(single, 'platform').pages).toHaveLength(1);
  });

  it('drops a pageId the registry does not resolve into Other rather than a phantom page', () => {
    const stray = buildMatrixTree([permission('user.view', 'platform', 'platform.ghost')], PAGES, []);
    expect(moduleOf(stray, 'platform').pages.map((e) => e.page)).toEqual([null]);
  });
});

// The two kinds of "no page" are one boolean apart and mean completely different things.
describe('a key the registry has forgotten is NOT the same as an unassigned one', () => {
  const tree = buildMatrixTree(CATALOG, PAGES, ['retired.view', 'user.view']);

  it('puts the forgotten key in its own module, outside every real one', () => {
    const unknown = moduleOf(tree, UNKNOWN_MODULE);
    expect(unknown.rows.map((r) => r.key)).toEqual(['retired.view']);
    expect(unknown.rows[0]?.definition).toBeUndefined();
  });

  it('leaves the deliberately unassigned ones inside their module, fully defined', () => {
    const other = moduleOf(tree, 'platform').pages.at(-1);
    expect(other?.rows.every((r) => r.definition !== undefined)).toBe(true);
  });

  it('sorts the unknown module last, after every real one', () => {
    expect(tree.at(-1)?.moduleId).toBe(UNKNOWN_MODULE);
  });

  it('adds nothing when the role carries no forgotten key', () => {
    expect(buildMatrixTree(CATALOG, PAGES, ['user.view']).map((m) => m.moduleId)).not.toContain(
      UNKNOWN_MODULE,
    );
  });
});

// ── The property the layer exists to guarantee ──────────────────────────────

describe('a module is exactly the union of its pages', () => {
  const tree = buildMatrixTree(CATALOG, PAGES, ['retired.view']);
  const all = (): boolean => true;

  it('holds structurally — module.rows IS the concatenation of its pages', () => {
    for (const module of tree) {
      expect(module.rows).toEqual(module.pages.flatMap((entry) => entry.rows));
    }
  });

  it('selecting the module equals selecting every page in turn', () => {
    const platform = moduleOf(tree, 'platform');
    const viaModule = applyBulk([], platform.rows, true, all);
    const viaPages = platform.pages.reduce<string[]>(
      (acc, entry) => applyBulk(acc, entry.rows, true, all),
      [],
    );
    expect(viaModule.sort()).toEqual(viaPages.sort());
  });

  it('clearing the module equals clearing every page in turn', () => {
    const platform = moduleOf(tree, 'platform');
    const start = platform.rows.map((r) => r.key);
    const viaModule = applyBulk(start, platform.rows, false, all);
    const viaPages = platform.pages.reduce<string[]>(
      (acc, entry) => applyBulk(acc, entry.rows, false, all),
      start,
    );
    expect(viaModule).toEqual(viaPages);
  });

  // The equivalence must survive the lock, not just the happy path.
  it('holds when the actor cannot grant one of the permissions', () => {
    const held = (key: string): boolean => key !== 'user.delete';
    const platform = moduleOf(tree, 'platform');
    const viaModule = applyBulk([], platform.rows, true, held);
    const viaPages = platform.pages.reduce<string[]>(
      (acc, entry) => applyBulk(acc, entry.rows, true, held),
      [],
    );
    expect(viaModule.sort()).toEqual(viaPages.sort());
    expect(viaModule).not.toContain('user.delete');
  });

  it('counts the same at both levels', () => {
    const platform = moduleOf(tree, 'platform');
    const chosen = new Set(['user.view', 'setting.edit']);
    const perPage = platform.pages.reduce(
      (total, entry) => total + selectedCount(entry.rows, chosen),
      0,
    );
    expect(selectedCount(platform.rows, chosen)).toBe(perPage);
  });
});

describe('tri-state at both levels', () => {
  const tree = buildMatrixTree(CATALOG, PAGES, []);
  const platform = moduleOf(tree, 'platform');
  const usersPage = platform.pages[0];

  it('a page is `some` when part of it is selected', () => {
    expect(groupState(usersPage?.rows ?? [], new Set(['user.view']))).toBe('some');
  });

  it('a page is `all` only when every one of its rows is selected', () => {
    expect(groupState(usersPage?.rows ?? [], new Set(['user.view', 'user.create']))).toBe('some');
    expect(
      groupState(usersPage?.rows ?? [], new Set(['user.view', 'user.create', 'user.delete'])),
    ).toBe('all');
  });

  // The case a one-level matrix could not express: one page complete, the module still partial.
  it('a module is `some` while one of its pages is full and another is empty', () => {
    const selection = new Set(['user.view', 'user.create', 'user.delete']);
    expect(groupState(usersPage?.rows ?? [], selection)).toBe('all');
    expect(groupState(platform.rows, selection)).toBe('some');
  });

  it('a module is `all` only when every page under it is', () => {
    expect(groupState(platform.rows, new Set(platform.rows.map((r) => r.key)))).toBe('all');
  });

  it('both levels read `none` on an untouched role', () => {
    expect(groupState(platform.rows, new Set())).toBe('none');
    expect(groupState(usersPage?.rows ?? [], new Set())).toBe('none');
  });

  it('a press on a page that is already complete clears it', () => {
    const full = new Set(['user.view', 'user.create', 'user.delete']);
    expect(bulkIntent(usersPage?.rows ?? [], full, () => true)).toBe(false);
  });
});

describe('visibleTree — search narrows the drawing, never the meaning', () => {
  const tree = buildMatrixTree(CATALOG, PAGES, []);

  it('shows everything when the term is empty', () => {
    const visible = visibleTree(tree, '   ', labels);
    expect(visible).toHaveLength(tree.length);
    expect(visible[0]?.pages[0]?.shown).toEqual(visible[0]?.pages[0]?.entry.rows);
  });

  it('keeps a matching permission inside its page and module', () => {
    const visible = visibleTree(tree, 'user.create', labels);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.module.moduleId).toBe('platform');
    expect(visible[0]?.pages).toHaveLength(1);
    expect(visible[0]?.pages[0]?.entry.page?.id).toBe('platform.users');
    expect(visible[0]?.pages[0]?.shown.map((r) => r.key)).toEqual(['user.create']);
  });

  it('a page name matching shows the whole page', () => {
    const visible = visibleTree(tree, 'System Users', labels);
    expect(visible[0]?.pages[0]?.shown).toHaveLength(3);
  });

  it('a module name matching shows every page under it', () => {
    const visible = visibleTree(tree, 'Human Resources', labels);
    expect(visible.map((v) => v.module.moduleId)).toEqual(['hr']);
    expect(visible[0]?.pages[0]?.shown.map((r) => r.key)).toEqual(['employee.view']);
  });

  it('finds the Other bucket by its label', () => {
    const visible = visibleTree(tree, 'Unassigned', labels);
    expect(visible[0]?.pages.map((p) => p.entry.page)).toEqual([null]);
  });

  it('drops a page, and then a module, once nothing under it matches', () => {
    expect(visibleTree(tree, 'employee', labels).map((v) => v.module.moduleId)).toEqual(['hr']);
    expect(visibleTree(tree, 'nothing-matches-this', labels)).toEqual([]);
  });

  // The rule P6 established, now at two levels: what a control DOES never depends on the search.
  it('leaves every control acting on the full row set while filtering', () => {
    const visible = visibleTree(tree, 'user.create', labels);
    const entry = visible[0]?.pages[0]?.entry;
    expect(entry?.rows).toHaveLength(3);
    expect(visible[0]?.pages[0]?.shown).toHaveLength(1);
    // Selecting from a filtered view still selects the page, not the one visible row.
    expect(applyBulk([], entry?.rows ?? [], true, () => true)).toEqual([
      'user.view',
      'user.create',
      'user.delete',
    ]);
    expect(visible[0]?.module.rows).toHaveLength(6);
  });
});
