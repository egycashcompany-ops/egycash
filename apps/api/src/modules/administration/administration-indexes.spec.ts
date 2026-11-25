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
  warehouses: { ready: vi.fn(), create: vi.fn(), byNameKey: vi.fn(), byCode: vi.fn() },
  activeBranchIds: vi.fn(),
  signal: vi.fn(),
  suppliers: { ready: vi.fn(), create: vi.fn(), byNameKey: vi.fn(), highest: vi.fn() },
  counter: { ensure: vi.fn(), next: vi.fn() },
  references: { unit: vi.fn(), category: vi.fn(), subcategories: vi.fn() },
}));

vi.mock('../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
// The warehouse's branch signal: the realtime layer's own guards are not what is pinned here.
vi.mock('../../platform/realtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publishAuditedChange: mocks.signal,
}));
// The company's active branches, which a warehouse create is filed in one of.
vi.mock('./shared/branch-scope', () => ({ activeBranchIds: mocks.activeBranchIds }));
vi.mock('./warehouses/warehouses/warehouse.repository', () => ({
  administrationWarehouseRepository: {
    ensureCollection: mocks.warehouses.ready,
    create: mocks.warehouses.create,
    findLiveByBranchAndNameKey: mocks.warehouses.byNameKey,
    findLiveByCode: mocks.warehouses.byCode,
  },
}));
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
vi.mock('./procurement/suppliers/supplier.repository', () => ({
  administrationSupplierRepository: {
    ensureCollection: mocks.suppliers.ready,
    create: mocks.suppliers.create,
    findLiveByNameKey: mocks.suppliers.byNameKey,
    highestCodeNumber: mocks.suppliers.highest,
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
const { administrationWarehouseService } =
  await import('./warehouses/warehouses/warehouse.service');
const { administrationSupplierService } = await import('./procurement/suppliers/supplier.service');

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
  'AdministrationSupplier.ux_code',
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

describe('the supplier’s tax number is indexed, never unique (OD-11 (i))', () => {
  const index = (name: string) =>
    administrationModels
      .find((model) => model.modelName === 'AdministrationSupplier')
      ?.schema.indexes()
      .find(([, options]) => options?.name === name);

  it('ix_tax_number serves the warning, among live rows that hold one, and refuses nothing', () => {
    const taxNumber = index('ix_tax_number');
    expect(taxNumber?.[0]).toEqual({ taxNumber: 1 });
    expect(taxNumber?.[1]?.unique).toBeUndefined();
    expect(taxNumber?.[1]?.partialFilterExpression).toEqual({
      taxNumber: { $type: 'string' },
      isDeleted: false,
    });
  });

  it('the name is the supplier’s one uniqueness among live rows, beside its permanent code', () => {
    const uniques = administrationModels
      .find((model) => model.modelName === 'AdministrationSupplier')
      ?.schema.indexes()
      .filter(([, options]) => options?.unique === true)
      .map(([, options]) => options?.name);
    expect(uniques?.sort()).toEqual(['ux_code', 'ux_name_key']);
    expect(index('ix_category')?.[0], 'multikey over the list').toEqual({ categoryIds: 1 });
    expect(index('ix_active')?.[0]).toEqual({ isActive: 1 });
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

  it('raises the counters, then ensures the papers’ category, after the indexes and before the roles', () => {
    const sync = body.indexOf('await syncDeclaredIndexes(');
    const items = body.indexOf('await ensureItemCodeCounter();');
    const suppliers = body.indexOf('await ensureSupplierCodeCounter();');
    const category = body.indexOf('await ensureSupplierDocumentsCategory();');
    const roles = body.indexOf('rbacService.ensureManagedRole(');
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(items).toBeGreaterThan(sync);
    expect(suppliers).toBeGreaterThan(items);
    expect(category).toBeGreaterThan(suppliers);
    expect(roles).toBeGreaterThan(category);
    // Each step logs its own failure and the boot goes on: the write that needs it repeats it.
    for (const [from, to] of [
      [items, suppliers],
      [suppliers, category],
      [category, roles],
    ] as const) {
      expect(body.slice(from, to)).toMatch(/catch \(err\)[\s\S]*logger\.warn\(/);
    }
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

  /** Each service over one of the module's repositories — a read-only service (people) has none. */
  const writingServices = (): string[] =>
    files('.repository.ts').map((repository) =>
      repository.replace('.repository.ts', '.service.ts'),
    );

  it('finds the read-only services and only them outside that list', () => {
    const others = files('.service.ts').filter((service) => !writingServices().includes(service));
    expect(others).toEqual(['people/people.service.ts']);
    expect(read('people/people.service.ts')).not.toMatch(/repository|\.create\(|updateById/);
  });

  // Those services, and the papers' links, which write the supplier row outside its service.
  const writers = [...writingServices(), ...files('-files.ts')];

  it.each(writers)('%s awaits it inside every method that writes', (service) => {
    const source = read(service);
    const writes = [
      ...source.matchAll(/repository\.(create|updateById|pushAttachment|pullAttachment)\(/g),
    ];
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

  it('a supplier paper waits for its collection before a byte is stored', () => {
    const source = read(join('procurement', 'suppliers', 'supplier-files.ts'));
    const add = source.slice(source.indexOf('\n  async add('), source.indexOf('\n  async remove('));
    const guard = add.indexOf('await repository.ensureCollection();');
    expect(guard, 'the guard is in `add`').toBeGreaterThanOrEqual(0);
    expect(add.indexOf('this.upload('), 'the upload comes after it').toBeGreaterThan(guard);
  });

  const ctx = {
    userId: String(new Types.ObjectId()),
    permissions: { 'administrationCatalog.manage': 'organization' },
  } as unknown as AuthContext;
  const piece = { ar: 'قطعة', en: 'Piece' };
  const failedBuild = new Error('index build failed');

  beforeEach(() => {
    vi.resetAllMocks();
    for (const repository of [
      mocks.units,
      mocks.categories,
      mocks.items,
      mocks.warehouses,
      mocks.suppliers,
    ]) {
      repository.byNameKey.mockResolvedValue(null);
      repository.create.mockImplementation(async (row: object) => ({
        _id: new Types.ObjectId(),
        ...row,
      }));
      repository.ready.mockRejectedValueOnce(failedBuild).mockResolvedValue(undefined);
    }
    mocks.units.byCode.mockResolvedValue(null);
    mocks.categories.byCode.mockResolvedValue(null);
    mocks.warehouses.byCode.mockResolvedValue(null);
    mocks.items.highest.mockResolvedValue(0);
    mocks.suppliers.highest.mockResolvedValue(0);
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

  it('a warehouse: the same — `ux_code` and `ux_branch_name_key` before its first row', async () => {
    const branchId = String(new Types.ObjectId());
    mocks.activeBranchIds.mockResolvedValue([branchId]);
    const warehouseCtx = {
      userId: String(new Types.ObjectId()),
      permissions: { 'administrationWarehouse.create': 'organization' },
      // The fields the create reads; the rest of a session's context is not what is pinned here.
    } as unknown as AuthContext;
    const input = {
      code: 'MAIN',
      name: { ar: 'المخزن الرئيسي', en: 'Main store' },
      branchId,
      type: 'main' as const,
    };
    await expect(administrationWarehouseService.create(input, warehouseCtx)).rejects.toBe(
      failedBuild,
    );
    expect(mocks.warehouses.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();

    await administrationWarehouseService.create(input, warehouseCtx);
    expect(mocks.warehouses.ready).toHaveBeenCalledTimes(2);
    expect(mocks.warehouses.create).toHaveBeenCalledTimes(1);
    expect(mocks.signal).toHaveBeenCalledWith(expect.objectContaining({ branchId }));
  });

  describe('an item: its collection AND the counter, before the transaction', () => {
    const itemCtx = {
      userId: String(new Types.ObjectId()),
      permissions: { 'administrationItem.create': 'organization' },
    } as unknown as AuthContext;
    // The body as the route hands it over, its schema's default applied.
    const input = {
      name: { ar: 'ورق تصوير', en: 'Copy paper' },
      categoryId: String(new Types.ObjectId()),
      unitId: String(new Types.ObjectId()),
      stockTracked: true,
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

  describe('a supplier: its collection AND its own counter, before the transaction', () => {
    // Only the two fields the service reads; the rest of a request's context plays no part here.
    const supplierCtx = {
      userId: String(new Types.ObjectId()),
      permissions: { 'administrationSupplier.create': 'organization' },
    } as unknown as AuthContext;
    const input = {
      name: { ar: 'مؤسسة النور', en: 'Al Nour' },
      contacts: [],
      categoryIds: [],
    };

    it('a failed supplier build refuses the write before a number is taken; the next goes in', async () => {
      await expect(administrationSupplierService.create(input, supplierCtx)).rejects.toBe(
        failedBuild,
      );
      expect(mocks.counter.ensure, 'the counter untouched').not.toHaveBeenCalled();
      expect(mocks.counter.next).not.toHaveBeenCalled();
      expect(mocks.suppliers.create).not.toHaveBeenCalled();

      const doc = await administrationSupplierService.create(input, supplierCtx);
      expect(mocks.suppliers.ready).toHaveBeenCalledTimes(2);
      expect(mocks.suppliers.create).toHaveBeenCalledTimes(1);
      expect(doc).toMatchObject({ code: 'SUP-00001' });
    });

    it('raises `supplier:global` to the highest supplier code — never the item’s series', async () => {
      mocks.suppliers.ready.mockReset().mockResolvedValue(undefined);
      mocks.suppliers.highest.mockResolvedValue(6);
      mocks.items.highest.mockResolvedValue(900);
      mocks.counter.next.mockResolvedValue(7);
      const doc = await administrationSupplierService.create(input, supplierCtx);
      expect(mocks.counter.ensure).toHaveBeenCalledWith('supplier:global', 6);
      expect(mocks.counter.ensure).not.toHaveBeenCalledWith('item:global', expect.anything());
      expect(mocks.counter.next).toHaveBeenCalledWith('supplier:global', expect.anything());
      expect(doc).toMatchObject({ code: 'SUP-00007' });
    });
  });
});
