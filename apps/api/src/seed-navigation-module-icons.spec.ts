// The module tiles' icons, and the one-time correction that puts them on a live installation.
//
// «بص الأيقونات بتاعت الإدارات مش متناسقة مع مدلول الإدارة … وبعدين فى متكرر ! عايز كل أيقونة تكون
// بتعبر عن اسم الإدارة». Operations and Gold Vault both wore the shield; the live tiles had been set by
// hand and matched no default the seed shipped, so correcting "only while it still holds the old
// default" (the applications' `previousIcon`) would have changed nothing anybody can see.
//
// The correction runs against stand-ins for the category and application stores — the same calls
// the boot sync makes, without a mongod.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  categories: [] as {
    _id: string;
    name: { en: string; ar: string };
    icon: string | null;
    iconRevision?: number;
    __v: number;
  }[],
  apps: [] as { route: string; categoryId: string }[],
  updates: [] as { id: string; icon: unknown }[],
  marks: [] as { id: string; set: Record<string, unknown> }[],
}));

vi.mock('./platform/application-categories', () => ({
  applicationCategoryRepository: {
    findOne: (filter: Record<string, unknown>) =>
      Promise.resolve(store.categories.find((c) => c.name.en === filter['name.en']) ?? null),
    findById: (id: string) => Promise.resolve(store.categories.find((c) => c._id === id) ?? null),
    updateById: (id: string, set: Record<string, unknown>) => {
      store.marks.push({ id, set });
      return Promise.resolve({ ...store.categories.find((c) => c._id === id), ...set });
    },
  },
  applicationCategoryService: {
    update: (id: string, input: { icon: unknown; version: number }) => {
      store.updates.push({ id, icon: input.icon });
      const before = store.categories.find((c) => c._id === id);
      return Promise.resolve({ ...before, icon: input.icon, __v: input.version + 1 });
    },
    create: vi.fn(),
  },
}));
vi.mock('./platform/applications', () => ({
  applicationRepository: {
    findOne: (filter: { route: string }) =>
      Promise.resolve(store.apps.find((a) => a.route === filter.route) ?? null),
  },
  applicationService: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('./platform/rbac', () => ({ rbacService: { userIdsWithSystemRole: vi.fn() } }));

const { NAVIGATION_CATALOG, correctCategoryIcon } = await import('./seed-navigation');

const module = (en: string) => {
  const def = NAVIGATION_CATALOG.find((c) => c.en === en);
  if (def === undefined) throw new Error(`no ${en} module in the catalog`);
  return def;
};

beforeEach(() => {
  store.categories = [];
  store.apps = [];
  store.updates = [];
  store.marks = [];
});

describe('the module tiles', () => {
  it('each say what the module is', () => {
    const icons = Object.fromEntries(NAVIGATION_CATALOG.map((c) => [c.en, c.icon]));
    expect(icons).toEqual({
      HR: 'users',
      Fleet: 'truck',
      Operations: 'cash',
      Organization: 'sitemap',
      IT: 'monitor',
      'Gold Vault': 'gold',
      ATM: 'atm',
      Administration: 'briefcase',
    });
  });

  it('and no two share a glyph', () => {
    const icons = NAVIGATION_CATALOG.map((c) => c.icon);
    expect(icons.length - new Set(icons).size).toBe(0);
  });

  it('carry a revision exactly where the icon was changed on purpose', () => {
    const revised = NAVIGATION_CATALOG.filter((c) => c.iconRevision !== undefined).map((c) => c.en);
    expect(revised.sort()).toEqual(['ATM', 'Gold Vault', 'Operations', 'Organization']);
  });
});

describe('putting the icons on a live installation', () => {
  it('replaces a hand-set icon once, audited, and records the revision', async () => {
    // The live ATM tile drew a building and Organization a grid: neither a default this seed shipped.
    store.categories = [
      { _id: 'c-atm', name: { en: 'ATM', ar: 'الصراف الآلى' }, icon: 'building', __v: 4 },
    ];
    await correctCategoryIcon(module('ATM'), 'admin');
    expect(store.updates).toEqual([{ id: 'c-atm', icon: 'atm' }]);
    expect(store.marks).toEqual([{ id: 'c-atm', set: { iconRevision: 1 } }]);
  });

  it('leaves a tile that already took the revision — an administrator’s later choice stands', async () => {
    store.categories = [
      {
        _id: 'c-ops',
        name: { en: 'Operations', ar: 'العمليات' },
        icon: 'truck',
        iconRevision: 1,
        __v: 9,
      },
    ];
    await correctCategoryIcon(module('Operations'), 'admin');
    expect(store.updates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('only records the revision when the tile already wears the icon', async () => {
    store.categories = [
      { _id: 'c-gold', name: { en: 'Gold Vault', ar: 'خزائن الذهب' }, icon: 'gold', __v: 1 },
    ];
    await correctCategoryIcon(module('Gold Vault'), 'admin');
    expect(store.updates).toEqual([]);
    expect(store.marks).toEqual([{ id: 'c-gold', set: { iconRevision: 1 } }]);
  });

  it('finds a renamed tile by where its pages live', async () => {
    const atm = module('ATM');
    const firstRoute = atm.apps[0]?.route ?? '';
    store.categories = [
      { _id: 'c-x', name: { en: 'Cash Machines', ar: 'الصراف' }, icon: null, __v: 0 },
    ];
    store.apps = [{ route: firstRoute, categoryId: 'c-x' }];
    await correctCategoryIcon(atm, 'admin');
    expect(store.updates).toEqual([{ id: 'c-x', icon: 'atm' }]);
  });

  it('never hands one module’s icon to another module its pages were moved into', async () => {
    const atm = module('ATM');
    store.categories = [
      { _id: 'c-ops', name: { en: 'Operations', ar: 'العمليات' }, icon: 'shield', __v: 0 },
    ];
    store.apps = [{ route: atm.apps[0]?.route ?? '', categoryId: 'c-ops' }];
    await correctCategoryIcon(atm, 'admin');
    expect(store.updates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('touches no tile whose icon the catalog did not revise', async () => {
    store.categories = [
      { _id: 'c-hr', name: { en: 'HR', ar: 'الموارد البشرية' }, icon: 'tag', __v: 0 },
    ];
    await correctCategoryIcon(module('HR'), 'admin');
    expect(store.updates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('does nothing on an installation without the module', async () => {
    await correctCategoryIcon(module('Operations'), 'admin');
    expect(store.updates).toEqual([]);
  });
});
