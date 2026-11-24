// The module's index step, at the level that needs no database (design §15.3.2; the
// `fleet-indexes.spec.ts` shape), and the per-collection guard behind it (RK-03).
//
// Three things can be wrong without any query being wrong: a model left off the list the seed
// syncs (its indexes would never be built where `autoIndex` is off), a seed that stops building
// first, and a write that does not wait for its collection's unique indexes — the one guard two
// simultaneous creates of «قطعه» and «قطعة» cannot both pass. All three are silent; this file is
// what says so.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../shared/types';
import { administrationModels } from './administration-indexes';
import { administrationModule } from './administration.module';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  units: { ready: vi.fn(), create: vi.fn(), byNameKey: vi.fn(), byCode: vi.fn() },
  categories: { ready: vi.fn(), create: vi.fn(), byNameKey: vi.fn(), byCode: vi.fn() },
  items: { ready: vi.fn(), create: vi.fn(), byNameKey: vi.fn(), highest: vi.fn() },
  counter: { ensure: vi.fn(), next: vi.fn() },
  references: { unit: vi.fn(), category: vi.fn(), subcategories: vi.fn() },
}));

vi.mock('../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
// The item create's transaction, run once with a stand-in session: what is pinned here is the
// order of the guards before it, not the database's transaction.
vi.mock('../../platform/kernel/unit-of-work', () => ({
  unitOfWork: async (fn: (session: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('./catalog/items/item.repository', () => ({
  administrationItemRepository: {
    ensureCollection: mocks.items.ready,
    create: mocks.items.create,
    findLiveByNameKey: mocks.items.byNameKey,
    highestCodeNumber: mocks.items.highest,
  },
}));
// Partial mocks: the manifest and the model list still need the real routers and models.
vi.mock('./shared/counter.model', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureCounter: mocks.counter.ensure,
  nextNumber: mocks.counter.next,
}));
vi.mock('./catalog/catalog-items/index', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  administrationCatalogItemService: { findUnit: mocks.references.unit },
  unitActiveFor: () => true,
}));
vi.mock('./catalog/item-categories/index', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  administrationItemCategoryService: {
    findCategory: mocks.references.category,
    hasActiveSubcategories: mocks.references.subcategories,
  },
  categoryActiveFor: () => true,
}));

vi.mock('./catalog/catalog-items/catalog-item.repository', () => ({
  administrationCatalogItemRepository: {
    ensureCollection: mocks.units.ready,
    create: mocks.units.create,
    findLiveByNameKey: mocks.units.byNameKey,
    findLiveByCode: mocks.units.byCode,
  },
}));
vi.mock('./catalog/item-categories/item-category.repository', () => ({
  administrationItemCategoryRepository: {
    ensureCollection: mocks.categories.ready,
    create: mocks.categories.create,
    findLiveByParentAndNameKey: mocks.categories.byNameKey,
    findLiveByCode: mocks.categories.byCode,
  },
}));

const { administrationCatalogItemService } =
  await import('./catalog/catalog-items/catalog-item.service');
const { administrationItemCategoryService } =
  await import('./catalog/item-categories/item-category.service');
const { administrationItemService } = await import('./catalog/items/item.service');

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const files = (suffix: string, dir = HERE, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files(suffix, full, out);
    else if (entry.name.endsWith(suffix)) out.push(relative(HERE, full));
  }
  return out;
};

/**
 * The collections the module's model files declare — read from the FILES, not from the list: a
 * Mongoose `model<…>(name, schema, collection)`, or the shared counter factory's
 * `defineCounter(name, collection)`.
 */
const declaredCollections = (): Set<string> => {
  const declared = new Set<string>();
  for (const file of files('.model.ts')) {
    const source = read(file);
    for (const match of source.matchAll(/model<[^>]+>\(\s*'[^']+',\s*\w+,\s*'([^']+)'/g)) {
      declared.add(match[1] as string);
    }
    for (const match of source.matchAll(/defineCounter\(\s*'[^']+',\s*'([^']+)'/g)) {
      declared.add(match[1] as string);
    }
  }
  return declared;
};

/**
 * The unique indexes that are NOT partial: a generated code is never reused, so not even a deleted
 * row frees it (§2.1), and the counter's key is bookkeeping, never soft-deleted.
 */
const WHOLE_COLLECTION_UNIQUES = new Set([
  'AdministrationItem.ux_code',
  'AdministrationCounter.ux_counter_key',
]);

describe('the model list the seed syncs covers the whole module', () => {
  const covered = administrationModels.map((model) => model.collection.collectionName);

  it('covers every collection a `*.model.ts` here declares', () => {
    // A list that checked itself would pass the day somebody adds a model and forgets it here.
    const declared = declaredCollections();
    expect(declared.size, 'the scan found collections at all').toBeGreaterThan(0);
    expect(declared.has('administration_counters'), 'the scan reads the counter factory').toBe(
      true,
    );
    expect([...declared].filter((name) => !covered.includes(name))).toEqual([]);
  });

  it('covers only this module, and is the manifest’s collection list', () => {
    for (const name of covered) expect(name).toMatch(/^administration_/);
    expect([...covered].sort()).toEqual([...administrationModule.collections].sort());
  });

  it('every model declares indexes, named ux_ when unique and ix_ when not', () => {
    for (const model of administrationModels) {
      const indexes = model.schema.indexes();
      expect(indexes.length, model.modelName).toBeGreaterThan(0);
      for (const [, options] of indexes) {
        const name = String(options?.name ?? '');
        expect(name, `${model.modelName} ${name}`).toMatch(
          options?.unique === true ? /^ux_/ : /^ix_/,
        );
      }
    }
  });

  it('every unique index is partial on live rows — a retired row keeps its name and code', () => {
    for (const model of administrationModels) {
      for (const [, options] of model.schema.indexes()) {
        if (options?.unique !== true) continue;
        if (WHOLE_COLLECTION_UNIQUES.has(`${model.modelName}.${String(options.name)}`)) continue;
        expect(options.partialFilterExpression, String(options.name)).toMatchObject({
          isDeleted: false,
        });
      }
    }
  });

  it('…but a generated code and the counter’s key are unique across every row ever written', () => {
    const found: string[] = [];
    for (const model of administrationModels) {
      for (const [, options] of model.schema.indexes()) {
        const id = `${model.modelName}.${String(options?.name)}`;
        if (!WHOLE_COLLECTION_UNIQUES.has(id)) continue;
        found.push(id);
        expect(options?.unique, id).toBe(true);
        expect(options?.partialFilterExpression, id).toBeUndefined();
      }
    }
    expect(found.sort()).toEqual([...WHOLE_COLLECTION_UNIQUES].sort());
  });

  it('the item’s barcode is unique only where one is set, among live rows (OD-05 (i))', () => {
    const barcode = administrationModels
      .find((model) => model.modelName === 'AdministrationItem')
      ?.schema.indexes()
      .find(([, options]) => options?.name === 'ux_barcode');
    expect(barcode?.[0]).toEqual({ barcode: 1 });
    expect(barcode?.[1]?.partialFilterExpression).toEqual({
      barcode: { $type: 'string' },
      isDeleted: false,
    });
  });
});

describe('the seed builds the indexes first, and holds no state', () => {
  const seed = read('administration.seed.ts');
  const body = seed.slice(seed.indexOf('export const seedAdministration'));

  it('its first step is the shared sync, in apply mode, over the module’s list', () => {
    const firstAwait = body.indexOf('await ');
    expect(body.slice(firstAwait)).toMatch(
      /^await syncDeclaredIndexes\('apply', administrationModels\)/,
    );
    expect(seed).toContain("from '../../shared/base/index-sync'");
  });

  it('logs the report the sync returns, through the shared lines', () => {
    expect(body).toContain('reportLines(report)');
    expect(body).toContain('reportSummary(report)');
  });

  it('copies no builder and refuses nothing', () => {
    expect(seed).not.toMatch(/createIndex|duplicateGroups|indexBuildPlan/);
    expect(body).not.toMatch(/throw |process\.exit/);
  });

  it('raises the item counter after the indexes and before the roles, and logs a failure', () => {
    const sync = body.indexOf('await syncDeclaredIndexes(');
    const counter = body.indexOf('await ensureItemCodeCounter();');
    const roles = body.indexOf('rbacService.ensureManagedRole(');
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(counter).toBeGreaterThan(sync);
    expect(roles).toBeGreaterThan(counter);
    expect(body.slice(counter, roles)).toMatch(/catch \(err\)[\s\S]*logger\.warn\(/);
  });
});

describe('a repository’s first write waits for its collection (RK-03)', () => {
  /** Which repository holds each model — every one with a ux_ index must hold a guard. */
  const guarded = (): { repository: string; model: string }[] =>
    files('.repository.ts').map((repository) => ({
      repository,
      model: /super\((\w+),/.exec(read(repository))?.[1] ?? '',
    }));

  it.each(guarded())('$repository holds `collectionReady($model)`', ({ repository, model }) => {
    expect(read(repository)).toContain(`readonly ensureCollection = collectionReady(${model});`);
  });

  it.each(files('.service.ts'))('%s awaits it inside every method that writes', (service) => {
    const source = read(service);
    const writes = [...source.matchAll(/repository\.(create|updateById)\(/g)];
    expect(writes.length, 'the scan found writes at all').toBeGreaterThan(0);
    for (const write of writes) {
      const before = source.slice(0, write.index);
      const methodStart = before.lastIndexOf('\n  async ');
      expect(
        before.slice(methodStart).includes('await repository.ensureCollection();'),
        `${service}: ${write[0]}`,
      ).toBe(true);
    }
  });

  const ctx = {
    userId: String(new Types.ObjectId()),
    permissions: { 'administrationCatalog.manage': 'organization' },
  } as unknown as AuthContext;
  const piece = { ar: 'قطعة', en: 'Piece' };
  const failedBuild = new Error('index build failed');

  beforeEach(() => {
    vi.resetAllMocks();
    for (const repository of [mocks.units, mocks.categories, mocks.items]) {
      repository.byNameKey.mockResolvedValue(null);
      repository.create.mockImplementation(async (row: object) => ({
        _id: new Types.ObjectId(),
        ...row,
      }));
      repository.ready.mockRejectedValueOnce(failedBuild).mockResolvedValue(undefined);
    }
    mocks.units.byCode.mockResolvedValue(null);
    mocks.categories.byCode.mockResolvedValue(null);
    mocks.items.highest.mockResolvedValue(0);
    mocks.counter.ensure.mockResolvedValue(undefined);
    mocks.counter.next.mockResolvedValue(1);
    mocks.references.unit.mockResolvedValue({ isActive: true, kind: 'unit' });
    mocks.references.category.mockResolvedValue({ isActive: true, parentId: null });
    mocks.references.subcategories.mockResolvedValue(false);
    mocks.audit.mockResolvedValue(undefined);
  });

  it('a unit: a failed build refuses the write, and the next write builds and goes in', async () => {
    const input = { kind: 'unit' as const, name: piece, sortOrder: 0 };
    await expect(administrationCatalogItemService.create(input, ctx)).rejects.toBe(failedBuild);
    expect(mocks.units.create, 'nothing written without the index').not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();

    await administrationCatalogItemService.create(input, ctx);
    expect(mocks.units.ready).toHaveBeenCalledTimes(2);
    expect(mocks.units.create).toHaveBeenCalledTimes(1);
  });

  it('a category: the same', async () => {
    const input = { name: { ar: 'أدوات', en: 'Tools' }, sortOrder: 0 };
    await expect(administrationItemCategoryService.create(input, ctx)).rejects.toBe(failedBuild);
    expect(mocks.categories.create).not.toHaveBeenCalled();

    await administrationItemCategoryService.create(input, ctx);
    expect(mocks.categories.ready).toHaveBeenCalledTimes(2);
    expect(mocks.categories.create).toHaveBeenCalledTimes(1);
  });

  describe('an item: its collection AND the counter, before the transaction', () => {
    const itemCtx = {
      userId: String(new Types.ObjectId()),
      permissions: { 'administrationItem.create': 'organization' },
    } as unknown as AuthContext;
    const input = {
      name: { ar: 'ورق تصوير', en: 'Copy paper' },
      categoryId: String(new Types.ObjectId()),
      unitId: String(new Types.ObjectId()),
    };

    it('a failed item build refuses the write before a number is taken; the next goes in', async () => {
      await expect(administrationItemService.create(input, itemCtx)).rejects.toBe(failedBuild);
      expect(mocks.counter.ensure, 'the counter untouched').not.toHaveBeenCalled();
      expect(mocks.counter.next).not.toHaveBeenCalled();
      expect(mocks.items.create).not.toHaveBeenCalled();

      const doc = await administrationItemService.create(input, itemCtx);
      expect(mocks.items.ready).toHaveBeenCalledTimes(2);
      expect(mocks.items.create).toHaveBeenCalledTimes(1);
      expect(doc).toMatchObject({ code: 'ITM-00001' });
    });

    it('a counter that could not be readied refuses the write too; the next goes in', async () => {
      mocks.items.ready.mockReset().mockResolvedValue(undefined);
      const counterDown = new Error('counter index build failed');
      mocks.counter.ensure
        .mockReset()
        .mockRejectedValueOnce(counterDown)
        .mockResolvedValue(undefined);
      await expect(administrationItemService.create(input, itemCtx)).rejects.toBe(counterDown);
      expect(mocks.counter.next).not.toHaveBeenCalled();
      expect(mocks.items.create).not.toHaveBeenCalled();

      await administrationItemService.create(input, itemCtx);
      expect(mocks.counter.ensure).toHaveBeenCalledTimes(2);
      expect(mocks.counter.ensure).toHaveBeenLastCalledWith('item:global', 0);
      expect(mocks.items.create).toHaveBeenCalledTimes(1);
    });

    it('raises the counter to the highest code already given, every create', async () => {
      mocks.items.ready.mockReset().mockResolvedValue(undefined);
      mocks.items.highest.mockResolvedValue(41);
      mocks.counter.next.mockResolvedValue(42);
      const doc = await administrationItemService.create(input, itemCtx);
      expect(mocks.counter.ensure).toHaveBeenCalledWith('item:global', 41);
      expect(doc).toMatchObject({ code: 'ITM-00042' });
    });
  });
});
