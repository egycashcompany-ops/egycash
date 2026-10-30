// The module tiles' icons, and the one-time correction that puts them on a live installation.
//
// «بص الأيقونات بتاعت الإدارات مش متناسقة مع مدلول الإدارة … وبعدين فى متكرر ! عايز كل أيقونة تكون
// بتعبر عن اسم الإدارة». Operations and Gold Vault both wore the shield, and the live Organization
// and ATM tiles had been set by hand (a grid, a building) — values the applications' `previousIcon`
// rule (correct only while the old default is still there) could never reach.
//
// The correction runs against stand-ins for the category and application stores that behave like
// the real repository where it matters: a write must carry the document's current version (or it
// is stale, which at boot would stop the API), and what is written stays written.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Tile {
  _id: string;
  name: { en: string; ar: string };
  icon: string | null;
  iconRevision?: number;
  __v: number;
}

const store = vi.hoisted(() => ({
  categories: [] as Tile[],
  apps: [] as { route: string; categoryId: string }[],
  iconUpdates: [] as { id: string; icon: unknown }[],
  marks: [] as { id: string; iconRevision: unknown }[],
}));

vi.mock('./platform/application-categories', () => {
  const copy = (tile: Tile | undefined): Tile | null => (tile === undefined ? null : { ...tile });
  const find = (id: string): Tile => {
    const tile = store.categories.find((c) => c._id === id);
    if (tile === undefined) throw new Error(`no tile ${id}`);
    return tile;
  };
  /** The real updateById matches on __v, and a miss is a StaleDocumentError. */
  const write = (id: string, set: Partial<Tile>, version: number): Tile => {
    const tile = find(id);
    if (tile.__v !== version)
      throw new Error(`stale write to ${id}: v${version}, stored v${tile.__v}`);
    Object.assign(tile, set, { __v: tile.__v + 1 });
    return { ...tile };
  };
  return {
    applicationCategoryRepository: {
      // Copies, as the real (lean) reads are: a write never refreshes a document already read.
      findOne: (filter: Record<string, unknown>) =>
        Promise.resolve(copy(store.categories.find((c) => c.name.en === filter['name.en']))),
      findById: (id: string) => Promise.resolve(copy(store.categories.find((c) => c._id === id))),
      updateById: (id: string, set: Partial<Tile>, meta: { version: number }) => {
        store.marks.push({ id, iconRevision: set.iconRevision });
        return Promise.resolve(write(id, set, meta.version));
      },
    },
    applicationCategoryService: {
      update: (id: string, input: { icon: string; version: number }) => {
        store.iconUpdates.push({ id, icon: input.icon });
        return Promise.resolve(write(id, { icon: input.icon }, input.version));
      },
      create: (input: { name: Tile['name']; icon: string }) => {
        const tile: Tile = {
          _id: `new-${input.name.en}`,
          name: input.name,
          icon: input.icon,
          __v: 0,
        };
        store.categories.push(tile);
        return Promise.resolve({ ...tile });
      },
    },
  };
});
vi.mock('./platform/applications', () => ({
  applicationRepository: {
    findOne: (filter: { route: string }) =>
      Promise.resolve(store.apps.find((a) => a.route === filter.route) ?? null),
  },
  applicationService: {
    create: (input: { route: string; categoryId: string }) => {
      store.apps.push({ route: input.route, categoryId: input.categoryId });
      return Promise.resolve({ _id: input.route });
    },
    update: vi.fn(),
  },
}));
vi.mock('./platform/rbac', () => ({ rbacService: { userIdsWithSystemRole: vi.fn() } }));

const { NAVIGATION_CATALOG, correctCategoryIcon, seedBootstrapNavigation } =
  await import('./seed-navigation');

const module = (en: string) => {
  const def = NAVIGATION_CATALOG.find((c) => c.en === en);
  if (def === undefined) throw new Error(`no ${en} module in the catalog`);
  return def;
};
const tile = (id: string) => store.categories.find((c) => c._id === id);

beforeEach(() => {
  store.categories = [];
  store.apps = [];
  store.iconUpdates = [];
  store.marks = [];
});

describe('the module tiles', () => {
  it('each say what the module is', () => {
    const icons = Object.fromEntries(NAVIGATION_CATALOG.map((c) => [c.en, c.icon]));
    expect(icons).toEqual({
      HR: 'users',
      Fleet: 'truck',
      Operations: 'cash',
      // The owner's own choice for this tile (e1166473), free again now that ATM has its machine.
      Organization: 'building',
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
  it('replaces a hand-set icon once, audited, records the revision — and the next boot does nothing', async () => {
    // The live ATM tile drew a building: no default this seed ever shipped for it.
    store.categories = [
      { _id: 'c-atm', name: { en: 'ATM', ar: 'الصراف الآلى' }, icon: 'building', __v: 4 },
    ];
    await correctCategoryIcon(module('ATM'), 'admin');
    await correctCategoryIcon(module('ATM'), 'admin');
    expect(store.iconUpdates).toEqual([{ id: 'c-atm', icon: 'atm' }]);
    expect(store.marks).toEqual([{ id: 'c-atm', iconRevision: 1 }]);
    // Two writes, each on the version the one before left — the stand-in throws on a stale one.
    expect(tile('c-atm')).toMatchObject({ icon: 'atm', iconRevision: 1, __v: 6 });
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
    expect(store.iconUpdates).toEqual([]);
    expect(store.marks).toEqual([]);
    expect(tile('c-ops')?.icon).toBe('truck');
  });

  it('only records the revision when the tile already wears the icon', async () => {
    store.categories = [
      { _id: 'c-gold', name: { en: 'Gold Vault', ar: 'خزائن الذهب' }, icon: 'gold', __v: 1 },
    ];
    await correctCategoryIcon(module('Gold Vault'), 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(tile('c-gold')).toMatchObject({ icon: 'gold', iconRevision: 1, __v: 2 });
  });

  it('finds a renamed tile by where most of its pages live', async () => {
    const atm = module('ATM');
    store.categories = [
      { _id: 'c-x', name: { en: 'Cash Machines', ar: 'الصراف' }, icon: null, __v: 0 },
    ];
    store.apps = atm.apps.slice(0, 3).map((app) => ({ route: app.route, categoryId: 'c-x' }));
    await correctCategoryIcon(atm, 'admin');
    expect(tile('c-x')).toMatchObject({ icon: 'atm', iconRevision: 1 });
  });

  it('does not take a group a page or two were moved into for the module', async () => {
    // A renamed ATM tile holding most of its pages, and an administrator's own group holding one.
    const atm = module('ATM');
    store.categories = [
      { _id: 'c-x', name: { en: 'Cash Machines', ar: 'الصراف' }, icon: 'building', __v: 0 },
      { _id: 'c-dash', name: { en: 'Dashboards', ar: 'لوحات' }, icon: 'chart', __v: 0 },
    ];
    store.apps = [
      { route: atm.apps[0]?.route ?? '', categoryId: 'c-dash' },
      ...atm.apps.slice(1, 4).map((app) => ({ route: app.route, categoryId: 'c-x' })),
    ];
    await correctCategoryIcon(atm, 'admin');
    expect(tile('c-dash')?.icon).toBe('chart');
    expect(tile('c-x')?.icon).toBe('atm');
  });

  it('corrects nothing when no group clearly holds the module’s pages', async () => {
    const atm = module('ATM');
    store.categories = [
      { _id: 'c-a', name: { en: 'A', ar: 'أ' }, icon: 'tag', __v: 0 },
      { _id: 'c-b', name: { en: 'B', ar: 'ب' }, icon: 'tag', __v: 0 },
    ];
    store.apps = [
      { route: atm.apps[0]?.route ?? '', categoryId: 'c-a' },
      { route: atm.apps[1]?.route ?? '', categoryId: 'c-b' },
    ];
    await correctCategoryIcon(atm, 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('never hands one module’s icon to another module its pages were moved into', async () => {
    const atm = module('ATM');
    store.categories = [
      { _id: 'c-ops', name: { en: 'Operations', ar: 'العمليات' }, icon: 'shield', __v: 0 },
    ];
    store.apps = atm.apps.slice(0, 3).map((app) => ({ route: app.route, categoryId: 'c-ops' }));
    await correctCategoryIcon(atm, 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('touches no tile whose icon the catalog did not revise', async () => {
    store.categories = [
      { _id: 'c-hr', name: { en: 'HR', ar: 'الموارد البشرية' }, icon: 'tag', __v: 0 },
    ];
    await correctCategoryIcon(module('HR'), 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(store.marks).toEqual([]);
  });

  it('does nothing on an installation without the module', async () => {
    await correctCategoryIcon(module('Operations'), 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(store.marks).toEqual([]);
  });
});

describe('a fresh installation', () => {
  it('creates each revised tile already at its revision, so an early choice of an administrator stands', async () => {
    await seedBootstrapNavigation('admin');
    for (const def of NAVIGATION_CATALOG) {
      const created = store.categories.find((c) => c.name.en === def.en);
      expect(created?.icon, def.en).toBe(def.icon);
      expect(created?.iconRevision, def.en).toBe(def.iconRevision);
    }
    // An administrator re-picks a tile before the next boot; that boot must leave it.
    const ops = store.categories.find((c) => c.name.en === 'Operations');
    if (ops !== undefined) ops.icon = 'truck';
    store.iconUpdates = [];
    await correctCategoryIcon(module('Operations'), 'admin');
    expect(store.iconUpdates).toEqual([]);
    expect(ops?.icon).toBe('truck');
  });
});
