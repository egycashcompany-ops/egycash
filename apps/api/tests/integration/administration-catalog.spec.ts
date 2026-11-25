// Administrative Affairs' catalog over real HTTP, real RBAC and a real database (design §19.7):
// units of measure and item categories (P1a.1), and the items that name them (P1a.2).
//
// What a mocked spec cannot see: the folded name stored and indexed, so «قطعه» typed after «قطعة»
// is the same unit or item — even when the two are typed at the same moment, where only the
// unique index can refuse the second; the two-level rule judged against real parents and
// children; the item code taken inside a real transaction, so concurrent creates get consecutive
// numbers and a create a unique index refuses gives its number back; every refusal answered with
// its own code (§5.15); the writes held to organization scope (OD-04 A) while the reads are not;
// the trail's verbs; the seed's indexes, its counter and its ready-made roles; and the item's
// kind (P2.1, OD-14 C), read as a stock item on a stored row older than the field.
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  foldName,
  parseAdministrationMasterCode,
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { RoleModel } from '../../src/platform/rbac/role.model';
import { AdministrationCatalogItemModel } from '../../src/modules/administration/catalog/catalog-items/catalog-item.model';
import { administrationCatalogItemRepository } from '../../src/modules/administration/catalog/catalog-items/catalog-item.repository';
import { AdministrationItemCategoryModel } from '../../src/modules/administration/catalog/item-categories/item-category.model';
import { administrationItemCategoryRepository } from '../../src/modules/administration/catalog/item-categories/item-category.repository';
import { AdministrationItemModel } from '../../src/modules/administration/catalog/items/item.model';
import { administrationItemRepository } from '../../src/modules/administration/catalog/items/item.repository';
import { AdministrationCounterModel } from '../../src/modules/administration/shared/counter.model';
import { seedAdministration } from '../../src/modules/administration/administration.seed';
import {
  administrationApi,
  bootAdministration,
  data,
  refusal,
  stopAdministration,
  type AdministrationWorld,
} from './helpers/administration-fixtures';

let world: AdministrationWorld;
let api: ReturnType<typeof administrationApi>;

beforeAll(async () => {
  world = await bootAdministration('catalog');
  api = administrationApi(world.app, world.managerToken);
}, 240_000);

afterAll(async () => {
  await stopAdministration();
});

// Every case its own names: two cases never share a unit or a category.
let serial = 0;
const fresh = (ar: string, en: string) => {
  serial += 1;
  return { ar: `${ar} ${String(serial)}`, en: `${en} ${String(serial)}` };
};

const unit = async (body: Record<string, unknown> = {}): Promise<AdministrationCatalogItemDto> => {
  const res = await api.post('/catalog-items', {
    kind: 'unit',
    name: fresh('وحدة', 'Unit'),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationCatalogItemDto>(res);
};

const category = async (
  body: Record<string, unknown> = {},
): Promise<AdministrationItemCategoryDto> => {
  const res = await api.post('/item-categories', { name: fresh('تصنيف', 'Category'), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationItemCategoryDto>(res);
};

/** The number an «ITM-…» code carries. */
const seqOf = (code: string): number => {
  const parsed = parseAdministrationMasterCode(code);
  expect(parsed, code).not.toBeNull();
  return parsed?.seq ?? Number.NaN;
};

const trail = (entityType: string, entityId: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'administration',
    'entityRef.entityType': entityType,
    'entityRef.entityId': entityId,
  })
    .sort({ _id: 1 })
    .lean()
    .exec();

describe('the seed', () => {
  it('builds the unique indexes the folded names stand on', async () => {
    // Tests boot with `autoIndex` on, so the indexes are there whatever the seed does (§15.3.2).
    // Once Mongoose's own build is done they are dropped, and nothing has written here yet, so no
    // repository's `collectionReady` has run: only the seed's `syncDeclaredIndexes` brings them
    // back. (The counter's guard ran at boot and is remembered, so it builds nothing either.)
    const names = async (model: { collection: { indexes(): Promise<{ name?: string }[]> } }) =>
      (await model.collection.indexes()).map((index) => index.name);
    for (const model of [
      AdministrationCatalogItemModel,
      AdministrationItemCategoryModel,
      AdministrationItemModel,
      AdministrationCounterModel,
    ] as const) {
      await model.init();
      await model.collection.dropIndexes();
      expect(await names(model)).toEqual(['_id_']);
    }
    await seedAdministration();

    expect(await names(AdministrationCatalogItemModel)).toEqual(
      expect.arrayContaining(['ux_kind_name_key', 'ux_kind_code', 'ix_kind_active_sort']),
    );
    expect(await names(AdministrationItemCategoryModel)).toEqual(
      expect.arrayContaining(['ux_parent_name_key', 'ux_code', 'ix_parent_active_sort']),
    );
    expect(await names(AdministrationItemModel)).toEqual(
      expect.arrayContaining([
        'ux_code',
        'ux_name_key',
        'ux_barcode',
        'ix_category_active',
        'ix_unit_active',
      ]),
    );
    expect(await names(AdministrationCounterModel)).toEqual(
      expect.arrayContaining(['ux_counter_key']),
    );
  });

  it('raises a lost item counter above every code already given, at any width (§2.8)', async () => {
    // Two codes either side of five digits: read newest-first as strings, «ITM-99999» would win.
    // And one typed into the database by hand, wider than both and in no spelling the formatter
    // writes: grouped with them, it would be the greatest of the longest and floor the counter at 0.
    const planted = (code: string, ar: string) => ({
      code,
      name: { ar, en: code },
      nameKey: foldName(ar),
      categoryId: new Types.ObjectId(),
      unitId: new Types.ObjectId(),
    });
    await AdministrationItemModel.create([
      planted('ITM-99999', 'صنف مزروع أول'),
      planted('ITM-100000', 'صنف مزروع ثان'),
      planted('ITM-0000100', 'صنف مكتوب باليد'),
    ]);
    await AdministrationCounterModel.deleteMany({ key: 'item:global' }).exec();
    await seedAdministration();
    const counter = await AdministrationCounterModel.findOne({ key: 'item:global' }).lean().exec();
    expect(counter?.seq).toBe(100_000);
  });

  it('seeds the ready-made roles as managed roles, each with the keys it holds so far (OD-78 A)', async () => {
    const roles = await RoleModel.find({ key: /^administration-/ })
      .lean()
      .exec();
    expect(roles.every((role) => !role.isSystem)).toBe(true);
    expect(
      Object.fromEntries(roles.map((role) => [role.key, [...role.permissionKeys].sort()])),
    ).toEqual({
      'administration-storekeeper': [
        'administrationItem.view',
        'administrationSupplier.view',
        'administrationWarehouse.view',
      ],
      // P2.2: a department's focal point (OD-16 A), and the request keys four others gain (§9.3).
      'administration-department-requester': [
        'administrationPurchaseRequest.create',
        'administrationPurchaseRequest.edit',
        'administrationPurchaseRequest.view',
      ],
      'administration-procurement-officer': [
        'administrationItem.view',
        'administrationPurchaseRequest.view',
        'administrationSupplier.view',
        'administrationWarehouse.view',
      ],
      'administration-procurement-manager': [
        'administrationItem.view',
        'administrationPurchaseRequest.view',
        'administrationSupplier.view',
        'administrationWarehouse.view',
      ],
      'administration-affairs-manager': [
        'administrationItem.view',
        'administrationPurchaseRequest.approve',
        'administrationPurchaseRequest.view',
        'administrationSupplier.view',
        'administrationWarehouse.view',
      ],
      'administration-master-data': [
        'administrationCatalog.manage',
        'administrationItem.create',
        'administrationItem.edit',
        'administrationItem.view',
        'administrationSupplier.create',
        'administrationSupplier.edit',
        'administrationSupplier.view',
        'administrationWarehouse.create',
        'administrationWarehouse.edit',
        'administrationWarehouse.view',
      ],
      'administration-auditor': [
        'administrationItem.view',
        'administrationPurchaseRequest.view',
        'administrationSupplier.view',
        'administrationWarehouse.view',
      ],
    });
    const master = roles.find((role) => role.key === 'administration-master-data');
    expect(master?.name).toEqual({
      en: 'Master-data administrator',
      ar: 'مسؤول البيانات الأساسية',
    });
    const storekeeper = roles.find((role) => role.key === 'administration-storekeeper');
    expect(storekeeper?.name).toEqual({ en: 'Storekeeper', ar: 'أمين المخزن' });
    const requester = roles.find((role) => role.key === 'administration-department-requester');
    expect(requester?.name).toEqual({ en: 'Department requester', ar: 'منسق طلبات الإدارة' });
  });
});

describe('units of measure', () => {
  it('creates a unit, stores its folded name, and lists it under its kind', async () => {
    const res = await api.post('/catalog-items', {
      kind: 'unit',
      code: 'box',
      name: { ar: 'علبة', en: 'Box' },
      sortOrder: 5,
    });
    expect(res.status).toBe(201);
    const created = data<AdministrationCatalogItemDto>(res);
    expect(created).toMatchObject({
      kind: 'unit',
      code: 'box',
      name: { ar: 'علبة', en: 'Box' },
      description: null,
      sortOrder: 5,
      isActive: true,
      version: 0,
    });
    expect(created, 'the folded key never leaves the server').not.toHaveProperty('nameKey');
    const stored = await AdministrationCatalogItemModel.findById(created.id).lean().exec();
    expect(stored?.nameKey).toBe(foldName('علبة'));

    const listed = data<AdministrationCatalogItemDto[]>(await api.get('/catalog-items?kind=unit'));
    expect(listed.map((row) => row.id)).toContain(created.id);

    const [row] = await trail('catalogItem', created.id);
    expect(row?.action).toBe('create');
  });

  it('finds a unit by another spelling of its name, and by its code', async () => {
    const piece = await unit({ code: 'pcs', name: { ar: 'قطعة غيار', en: 'Spare part' } });
    const bySpelling = data<AdministrationCatalogItemDto[]>(
      await api.get(`/catalog-items?kind=unit&search=${encodeURIComponent('قطعه غيار')}`),
    );
    expect(bySpelling.map((row) => row.id)).toEqual([piece.id]);
    const byCode = data<AdministrationCatalogItemDto[]>(
      await api.get('/catalog-items?kind=unit&search=PCS'),
    );
    expect(byCode.map((row) => row.id)).toEqual([piece.id]);
  });

  it('edits a unit with its version; a stale version is 409 STALE_DOCUMENT', async () => {
    const meter = await unit();
    const edited = await api.patch(`/catalog-items/${meter.id}`, {
      name: { ar: 'متر طولي', en: 'Linear meter' },
      version: meter.version,
    });
    expect(edited.status).toBe(200);
    expect(data<AdministrationCatalogItemDto>(edited)).toMatchObject({ version: 1 });
    const stored = await AdministrationCatalogItemModel.findById(meter.id).lean().exec();
    expect(stored?.nameKey, 'a rename folds the new name').toBe(foldName('متر طولي'));

    const stale = await api.patch(`/catalog-items/${meter.id}`, {
      sortOrder: 3,
      version: meter.version,
    });
    expect(stale.status).toBe(409);
    expect(refusal(stale).code).toBe('STALE_DOCUMENT');

    const rows = await trail('catalogItem', meter.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update']);
  });

  it('deactivates freely and comes back: `deactivate`, then `activate` (§5.3)', async () => {
    const roll = await unit();
    const off = await api.patch(`/catalog-items/${roll.id}`, { isActive: false, version: 0 });
    expect(off.status).toBe(200);
    expect(data<AdministrationCatalogItemDto>(off).isActive).toBe(false);
    const on = await api.patch(`/catalog-items/${roll.id}`, { isActive: true, version: 1 });
    expect(on.status).toBe(200);

    const rows = await trail('catalogItem', roll.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'deactivate', 'activate']);
    expect(rows[1]?.changes).toEqual([
      expect.objectContaining({ field: 'isActive', old: true, new: false }),
    ]);

    const retired = data<AdministrationCatalogItemDto[]>(
      await api.get('/catalog-items?kind=unit&isActive=false'),
    );
    expect(
      retired.map((row) => row.id),
      'back among the active',
    ).not.toContain(roll.id);
  });

  it('refuses a second spelling of a live unit’s name: 409 ADMINISTRATION_DUPLICATE, field name', async () => {
    await unit({ name: { ar: 'قطعة', en: 'Piece' } });
    const again = await api.post('/catalog-items', {
      kind: 'unit',
      name: { ar: 'قطعه', en: 'Piece (again)' },
    });
    expect(again.status).toBe(409);
    expect(refusal(again)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name', code: 'duplicate' }],
    });
  });

  it('refuses a live unit’s code, on a create and on a rename', async () => {
    await unit({ code: 'kg' });
    const create = await api.post('/catalog-items', {
      kind: 'unit',
      code: 'kg',
      name: fresh('كيلو', 'Kilo'),
    });
    expect(create.status).toBe(409);
    expect(refusal(create).code).toBe('ADMINISTRATION_DUPLICATE');
    expect(refusal(create).details).toEqual([expect.objectContaining({ field: 'code' })]);

    const other = await unit();
    const rename = await api.patch(`/catalog-items/${other.id}`, { code: 'kg', version: 0 });
    expect(rename.status).toBe(409);
    expect(refusal(rename)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'code' }],
    });
  });

  it('a retired unit keeps its name — reactivate it, never type it again', async () => {
    const retired = await unit({ name: { ar: 'لفة', en: 'Roll' } });
    await api.patch(`/catalog-items/${retired.id}`, { isActive: false, version: 0 });
    const again = await api.post('/catalog-items', {
      kind: 'unit',
      name: { ar: 'لفه', en: 'Roll' },
    });
    expect(again.status).toBe(409);
    expect(refusal(again).code).toBe('ADMINISTRATION_DUPLICATE');
    expect(refusal(again).details).toEqual([expect.objectContaining({ field: 'name' })]);
  });

  it('when a racing write passes the early check, the index refuses it with the same answer', async () => {
    // The early check is told "free" once, as it would be for the second of two simultaneous
    // creates: what refuses the write then is `ux_kind_name_key`.
    await unit({ name: { ar: 'جالون', en: 'Gallon' } });
    const spy = vi
      .spyOn(administrationCatalogItemRepository, 'findLiveByNameKey')
      .mockResolvedValueOnce(null);
    const raced = await api.post('/catalog-items', {
      kind: 'unit',
      name: { ar: 'جالون', en: 'Gal' },
    });
    spy.mockRestore();
    expect(raced.status).toBe(409);
    expect(refusal(raced)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
  });

  it('a racing rename meets the index too: the raw refusal of an update gets the same answer', async () => {
    // An update's duplicate arrives raw from `findOneAndUpdate`, not as BaseRepository's
    // `ConflictError` as a create's does: the other half of `isDuplicateWrite`.
    await unit({ name: { ar: 'برميل', en: 'Barrel' } });
    const other = await unit();
    const spy = vi
      .spyOn(administrationCatalogItemRepository, 'findLiveByNameKey')
      .mockResolvedValueOnce(null);
    const raced = await api.patch(`/catalog-items/${other.id}`, {
      name: { ar: 'بَرميل', en: 'Drum' },
      version: 0,
    });
    spy.mockRestore();
    expect(raced.status).toBe(409);
    expect(refusal(raced)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
  });

  it.each([
    ['no English name', { kind: 'unit', name: { ar: 'طن' } }],
    ['a client-sent nameKey', { kind: 'unit', name: { ar: 'طن', en: 'Ton' }, nameKey: 'طن' }],
    ['an unknown kind', { kind: 'brand', name: { ar: 'طن', en: 'Ton' } }],
    ['an Arabic name of tatweel alone', { kind: 'unit', name: { ar: 'ـ', en: 'Ton' } }],
    ['an Arabic name of harakat alone', { kind: 'unit', name: { ar: 'ًٌ', en: 'Ton' } }],
  ])('400 VALIDATION_FAILED for %s', async (_label, body) => {
    const res = await api.post('/catalog-items', body);
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['no version', { sortOrder: 2 }],
    ['an Arabic name of harakat alone', { name: { ar: 'ً', en: 'Ton' }, version: 0 }],
    ['a moved kind', { kind: 'unit', version: 0 }],
  ])('400 VALIDATION_FAILED for an edit with %s', async (_label, body) => {
    const res = await api.patch(`/catalog-items/${(await unit()).id}`, body);
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED for a list without its kind', async () => {
    const res = await api.get('/catalog-items');
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
  });
});

describe('item categories (two levels, OD-06 A)', () => {
  it('creates a top-level category and a subcategory that names its parent', async () => {
    const tools = await category({ code: 'TL', name: { ar: 'أدوات', en: 'Tools' } });
    expect(tools).toMatchObject({ parentId: null, parentName: null, code: 'TL', version: 0 });
    const hand = await category({
      name: { ar: 'عدد يدوية', en: 'Hand tools' },
      parentId: tools.id,
    });
    expect(hand).toMatchObject({ parentId: tools.id, parentName: { ar: 'أدوات', en: 'Tools' } });

    const children = data<AdministrationItemCategoryDto[]>(
      await api.get(`/item-categories?parentId=${tools.id}`),
    );
    expect(children.map((row) => row.id)).toEqual([hand.id]);
    expect(children[0]?.parentName).toEqual({ ar: 'أدوات', en: 'Tools' });

    const [row] = await trail('itemCategory', hand.id);
    expect(row?.action).toBe('create');
    expect(row?.changes).toContainEqual({ field: 'parentId', old: null, new: tools.id });
  });

  it('lists the top level — where a parent is picked from — or every subcategory', async () => {
    const top = await category();
    const sub = await category({ parentId: top.id });

    const level = data<AdministrationItemCategoryDto[]>(
      await api.get('/item-categories?topLevel=true&pageSize=100'),
    );
    expect(level.map((row) => row.id)).toContain(top.id);
    expect(level.every((row) => row.parentId === null)).toBe(true);

    const subs = data<AdministrationItemCategoryDto[]>(
      await api.get('/item-categories?topLevel=false&pageSize=100'),
    );
    expect(subs.map((row) => row.id)).toContain(sub.id);
    expect(subs.every((row) => row.parentId !== null)).toBe(true);

    const both = await api.get(`/item-categories?topLevel=true&parentId=${top.id}`);
    expect(both.status).toBe(400);
    expect(refusal(both).code).toBe('VALIDATION_FAILED');
  });

  it('one name per parent: two parents may each hold it, one parent only once', async () => {
    const paper = await category();
    const ink = await category();
    await category({ name: { ar: 'متنوعات', en: 'Misc' }, parentId: paper.id });
    await category({ name: { ar: 'متنوعات', en: 'Misc' }, parentId: ink.id });

    const twice = await api.post('/item-categories', {
      name: { ar: 'منوعات', en: 'Misc' },
      parentId: paper.id,
    });
    expect(twice.status, 'a different word is a different name').toBe(201);
    const again = await api.post('/item-categories', {
      name: { ar: 'مُتنوِّعات', en: 'Misc' },
      parentId: paper.id,
    });
    expect(again.status).toBe(409);
    expect(refusal(again)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
  });

  it('top-level names are unique among themselves', async () => {
    await category({ name: { ar: 'الأثاث', en: 'Furniture' } });
    const again = await api.post('/item-categories', { name: { ar: 'الاثاث', en: 'Furniture' } });
    expect(again.status).toBe(409);
    expect(refusal(again).code).toBe('ADMINISTRATION_DUPLICATE');
    expect(refusal(again).details).toEqual([expect.objectContaining({ field: 'name' })]);
  });

  describe('a move is judged by the name under its new parent', () => {
    const nameRefused = (res: request.Response) => {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(refusal(res)).toMatchObject({
        code: 'ADMINISTRATION_DUPLICATE',
        details: [{ field: 'name' }],
      });
    };

    it('under a parent that already holds the name in another spelling', async () => {
      const paper = await category();
      const ink = await category();
      const misc = await category({ name: { ar: 'مُتنوِّعات', en: 'Misc' }, parentId: paper.id });
      await category({ name: { ar: 'متنوعات', en: 'Misc' }, parentId: ink.id });
      nameRefused(await api.patch(`/item-categories/${misc.id}`, { parentId: ink.id, version: 0 }));
    });

    it('to a top level that already holds the name', async () => {
      await category({ name: { ar: 'قرطاسية', en: 'Stationery' } });
      const office = await category();
      const sub = await category({
        name: { ar: 'قرطاسيه', en: 'Stationery' },
        parentId: office.id,
      });
      nameRefused(await api.patch(`/item-categories/${sub.id}`, { parentId: null, version: 0 }));
    });

    it('a racing rename meets the index: the raw refusal of an update gets the same answer', async () => {
      await category({ name: { ar: 'نظافة', en: 'Cleaning' } });
      const other = await category();
      const spy = vi
        .spyOn(administrationItemCategoryRepository, 'findLiveByParentAndNameKey')
        .mockResolvedValueOnce(null);
      const raced = await api.patch(`/item-categories/${other.id}`, {
        name: { ar: 'نظافه', en: 'Hygiene' },
        version: 0,
      });
      spy.mockRestore();
      nameRefused(raced);
    });
  });

  describe('a refused parent: 422 ADMINISTRATION_CATEGORY_PARENT_INVALID', () => {
    const parentRefused = (res: request.Response, problem: string) => {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(refusal(res)).toMatchObject({
        code: 'ADMINISTRATION_CATEGORY_PARENT_INVALID',
        details: [{ field: 'parentId', code: problem }],
      });
    };

    it('self — a category under itself', async () => {
      const top = await category();
      parentRefused(
        await api.patch(`/item-categories/${top.id}`, { parentId: top.id, version: 0 }),
        'self',
      );
    });

    // The contract takes A-F as well as a-f; the database spells an id in lower case only.
    it.each([
      ['the route id', (id: string) => [id.toUpperCase(), id]],
      ['the parent id', (id: string) => [id, id.toUpperCase()]],
      ['both', (id: string) => [id.toUpperCase(), id.toUpperCase()]],
    ])('self — whatever the case of %s', async (_label, spell) => {
      const top = await category();
      const [route, parentId] = spell(top.id);
      parentRefused(
        await api.patch(`/item-categories/${String(route)}`, { parentId, version: 0 }),
        'self',
      );
      const stored = await AdministrationItemCategoryModel.findById(top.id).lean().exec();
      expect(stored?.parentId, 'never its own parent').toBeNull();
    });

    it('cycle — a category under its own subcategory', async () => {
      const top = await category();
      const sub = await category({ parentId: top.id });
      parentRefused(
        await api.patch(`/item-categories/${top.id.toUpperCase()}`, {
          parentId: sub.id,
          version: 0,
        }),
        'cycle',
      );
    });

    it('tooDeep — a third level, on a create and on a move', async () => {
      const top = await category();
      const sub = await category({ parentId: top.id });
      parentRefused(
        await api.post('/item-categories', { name: fresh('ج', 'C'), parentId: sub.id }),
        'tooDeep',
      );
      const other = await category();
      parentRefused(
        await api.patch(`/item-categories/${other.id}`, { parentId: sub.id, version: 0 }),
        'tooDeep',
      );
    });

    it('inactive — a retired parent', async () => {
      const top = await category();
      await api.patch(`/item-categories/${top.id}`, { isActive: false, version: 0 });
      parentRefused(
        await api.post('/item-categories', { name: fresh('ج', 'C'), parentId: top.id }),
        'inactive',
      );
    });

    it('hasChildren — a category with subcategories never moves under another', async () => {
      const top = await category();
      await category({ parentId: top.id });
      const elsewhere = await category();
      parentRefused(
        await api.patch(`/item-categories/${top.id}`, { parentId: elsewhere.id, version: 0 }),
        'hasChildren',
      );
    });
  });

  it('a parent that does not exist is 404', async () => {
    const res = await api.post('/item-categories', {
      name: fresh('ج', 'C'),
      parentId: '64a0000000000000000000ff',
    });
    expect(res.status).toBe(404);
    expect(refusal(res).code).toBe('NOT_FOUND');
  });

  it('moves a childless subcategory to another parent, and a subcategory to the top level', async () => {
    const from = await category();
    const to = await category();
    const sub = await category({ parentId: from.id });
    const moved = await api.patch(`/item-categories/${sub.id}`, { parentId: to.id, version: 0 });
    expect(moved.status).toBe(200);
    expect(data<AdministrationItemCategoryDto>(moved)).toMatchObject({
      parentId: to.id,
      parentName: to.name,
    });
    const lifted = await api.patch(`/item-categories/${sub.id}`, { parentId: null, version: 1 });
    expect(data<AdministrationItemCategoryDto>(lifted)).toMatchObject({
      parentId: null,
      parentName: null,
    });

    const rows = await trail('itemCategory', sub.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update']);
  });

  it('deactivates freely, and a subcategory under a retired parent is still edited in place', async () => {
    const top = await category();
    const sub = await category({ parentId: top.id });
    const off = await api.patch(`/item-categories/${top.id}`, { isActive: false, version: 0 });
    expect(off.status).toBe(200);
    const edited = await api.patch(`/item-categories/${sub.id}`, { sortOrder: 4, version: 0 });
    expect(edited.status).toBe(200);
    expect(data<AdministrationItemCategoryDto>(edited).parentName).toEqual(top.name);

    const rows = await trail('itemCategory', top.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'deactivate']);
  });

  it('the parent it already has, typed in upper case, is no move', async () => {
    const top = await category();
    const sub = await category({ parentId: top.id });
    await api.patch(`/item-categories/${top.id}`, { isActive: false, version: 0 });
    const edited = await api.patch(`/item-categories/${sub.id}`, {
      parentId: top.id.toUpperCase(),
      sortOrder: 2,
      version: 0,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<AdministrationItemCategoryDto>(edited)).toMatchObject({
      parentId: top.id,
      sortOrder: 2,
    });
    const [, row] = await trail('itemCategory', sub.id);
    expect(row?.changes?.map((change) => change.field)).toEqual(['sortOrder']);
  });

  it('edits with its version; a stale version is 409 STALE_DOCUMENT', async () => {
    const top = await category();
    const first = await api.patch(`/item-categories/${top.id}`, { sortOrder: 7, version: 0 });
    expect(first.status).toBe(200);
    const stale = await api.patch(`/item-categories/${top.id}`, { sortOrder: 8, version: 0 });
    expect(stale.status).toBe(409);
    expect(refusal(stale).code).toBe('STALE_DOCUMENT');

    // A stale move is answered as stale before the parent is judged (§19.3), not 422 `inactive`.
    const retired = await category();
    await api.patch(`/item-categories/${retired.id}`, { isActive: false, version: 0 });
    const staleMove = await api.patch(`/item-categories/${top.id}`, {
      parentId: retired.id,
      version: 0,
    });
    expect(staleMove.status, JSON.stringify(staleMove.body)).toBe(409);
    expect(refusal(staleMove).code).toBe('STALE_DOCUMENT');
  });

  it.each([
    ['no English name', { name: { ar: 'أدوات' } }],
    ['a parent that is not an id', { name: { ar: 'أدوات', en: 'Tools' }, parentId: 'tools' }],
    ['a client-sent nameKey', { name: { ar: 'أدوات', en: 'Tools' }, nameKey: 'x' }],
    ['an Arabic name of tatweel alone', { name: { ar: 'ـ', en: 'Tools' } }],
  ])('400 VALIDATION_FAILED for %s', async (_label, body) => {
    const res = await api.post('/item-categories', body);
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['no version', { sortOrder: 2 }],
    ['a parent that is not an id', { parentId: 'tools', version: 0 }],
    ['an Arabic name of harakat alone', { name: { ar: 'ًٌ', en: 'Tools' }, version: 0 }],
  ])('400 VALIDATION_FAILED for an edit with %s', async (_label, body) => {
    const res = await api.patch(`/item-categories/${(await category()).id}`, body);
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
  });

  it('when a racing write passes the early check, the index refuses it with the same answer', async () => {
    await category({ name: { ar: 'كهرباء', en: 'Electrical' } });
    const spy = vi
      .spyOn(administrationItemCategoryRepository, 'findLiveByParentAndNameKey')
      .mockResolvedValueOnce(null);
    const raced = await api.post('/item-categories', { name: { ar: 'كَهرباء', en: 'Power' } });
    spy.mockRestore();
    expect(raced.status).toBe(409);
    expect(refusal(raced)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
  });
});

describe('items (§2.3.4; OD-05 A codes)', () => {
  // Each item its own name; these two references hold every item that does not test them.
  let leaf: AdministrationItemCategoryDto;
  let piece: AdministrationCatalogItemDto;

  beforeAll(async () => {
    leaf = await category({ name: { ar: 'أدوات مكتبية', en: 'Office supplies' } });
    piece = await unit({ name: { ar: 'عدد', en: 'Count' } });
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    name: fresh('صنف', 'Item'),
    categoryId: leaf.id,
    unitId: piece.id,
    ...extra,
  });

  const item = async (extra: Record<string, unknown> = {}): Promise<AdministrationItemDto> => {
    const res = await api.post('/items', body(extra));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<AdministrationItemDto>(res);
  };

  const refused = (res: request.Response, status: number, code: string, fields: string[]) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(refusal(res).code).toBe(code);
    expect(refusal(res).details?.map((detail) => detail.field)).toEqual(fields);
  };

  it('creates an item with a generated code and its labels; the folded name stays on the server', async () => {
    const office = await category({ name: { ar: 'قرطاسية مكتب', en: 'Office stationery' } });
    const paper = await category({ name: { ar: 'ورق', en: 'Paper' }, parentId: office.id });
    const ream = await unit({ name: { ar: 'رزمة', en: 'Ream' } });
    const res = await api.post('/items', {
      name: { ar: 'ورق تصوير A4', en: 'Copy paper A4' },
      categoryId: paper.id,
      unitId: ream.id,
      barcode: '6221000000017',
      minQty: 5,
      reorderPointQty: 10,
      maxQty: 40,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = data<AdministrationItemDto>(res);
    expect(created.code).toMatch(/^ITM-\d{5,}$/);
    expect(created).toMatchObject({
      barcode: '6221000000017',
      categoryId: paper.id,
      categoryName: { ar: 'ورق', en: 'Paper' },
      categoryParentId: office.id,
      categoryParentName: { ar: 'قرطاسية مكتب', en: 'Office stationery' },
      unitId: ream.id,
      unitName: { ar: 'رزمة', en: 'Ream' },
      minQty: 5,
      reorderPointQty: 10,
      maxQty: 40,
      description: null,
      notes: null,
      isActive: true,
      version: 0,
    });
    expect(created, 'the folded key never leaves the server').not.toHaveProperty('nameKey');
    const stored = await AdministrationItemModel.findById(created.id).lean().exec();
    expect(stored?.nameKey).toBe(foldName('ورق تصوير A4'));

    const byId = data<AdministrationItemDto>(await api.get(`/items/${created.id}`));
    expect(byId).toEqual(created);

    const [row] = await trail('item', created.id);
    expect(row?.action).toBe('create');
    expect(row?.changes).toContainEqual({ field: 'code', old: null, new: created.code });
  });

  it('an item under a top-level category carries no parent label', async () => {
    const created = await item();
    expect(created).toMatchObject({
      categoryName: leaf.name,
      categoryParentId: null,
      categoryParentName: null,
      unitName: piece.name,
    });
  });

  it('finds an item by its code, by another spelling of its name, and by its barcode', async () => {
    const tape = await item({
      name: { ar: 'شريط لاصق شفاف', en: 'Clear tape' },
      barcode: 'TP-77031',
    });
    for (const search of [tape.code.toLowerCase(), 'شريط لاصق شفاف', 'شَريط لاصِق', 'TP-77031']) {
      const found = data<AdministrationItemDto[]>(
        await api.get(`/items?search=${encodeURIComponent(search)}`),
      );
      expect(
        found.map((row) => row.id),
        search,
      ).toContain(tape.id);
    }
    const scan = data<AdministrationItemDto[]>(await api.get('/items?search=TP-77031'));
    expect(
      scan.map((row) => row.id),
      'a scan resolves to one row',
    ).toEqual([tape.id]);
  });

  it('filters by category — a top-level category holds its subcategories’ items — by unit and by status', async () => {
    const top = await category();
    const sub = await category({ parentId: top.id });
    const other = await unit();
    const underSub = await item({ categoryId: sub.id });
    const underTopUnit = await item({ unitId: other.id });

    const byTop = data<AdministrationItemDto[]>(await api.get(`/items?categoryId=${top.id}`));
    expect(byTop.map((row) => row.id)).toEqual([underSub.id]);
    const bySub = data<AdministrationItemDto[]>(await api.get(`/items?categoryId=${sub.id}`));
    expect(bySub.map((row) => row.id)).toEqual([underSub.id]);
    const byUnit = data<AdministrationItemDto[]>(await api.get(`/items?unitId=${other.id}`));
    expect(byUnit.map((row) => row.id)).toEqual([underTopUnit.id]);

    await api.patch(`/items/${underTopUnit.id}`, { isActive: false, version: 0 });
    const retired = data<AdministrationItemDto[]>(
      await api.get(`/items?unitId=${other.id}&isActive=false`),
    );
    expect(retired.map((row) => row.id)).toEqual([underTopUnit.id]);
    const active = data<AdministrationItemDto[]>(
      await api.get(`/items?unitId=${other.id}&isActive=true`),
    );
    expect(active).toEqual([]);
  });

  it('sorts by code, and pages at most 100 rows', async () => {
    const res = await api.get('/items?sortBy=code&sortDir=asc&pageSize=100');
    expect(res.status).toBe(200);
    const codes = data<AdministrationItemDto[]>(res).map((row) => row.code);
    expect(codes).toEqual([...codes].sort());
    expect((await api.get('/items?pageSize=101')).status).toBe(400);
  });

  it('edits with its version; a stale version is 409 STALE_DOCUMENT; the code never moves', async () => {
    const created = await item();
    const edited = await api.patch(`/items/${created.id}`, {
      name: { ar: 'قلم جاف أزرق', en: 'Blue ballpoint' },
      notes: 'box of 50',
      version: 0,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<AdministrationItemDto>(edited)).toMatchObject({
      code: created.code,
      notes: 'box of 50',
      version: 1,
    });
    const stored = await AdministrationItemModel.findById(created.id).lean().exec();
    expect(stored?.nameKey, 'a rename folds the new name').toBe(foldName('قلم جاف أزرق'));

    const stale = await api.patch(`/items/${created.id}`, { notes: 'x', version: 0 });
    expect(stale.status).toBe(409);
    expect(refusal(stale).code).toBe('STALE_DOCUMENT');

    const moved = await api.patch(`/items/${created.id}`, { code: 'ITM-00001', version: 1 });
    expect(moved.status, 'no client code').toBe(400);
  });

  it('deactivates freely (OD-70 A) and comes back; a retired item still resolves by id', async () => {
    const created = await item();
    const off = await api.patch(`/items/${created.id}`, { isActive: false, version: 0 });
    expect(off.status).toBe(200);
    const byId = data<AdministrationItemDto>(await api.get(`/items/${created.id}`));
    expect(byId.isActive).toBe(false);
    const on = await api.patch(`/items/${created.id}`, { isActive: true, version: 1 });
    expect(on.status).toBe(200);

    const rows = await trail('item', created.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'deactivate', 'activate']);
  });

  it('a GET of an id no item has is 404', async () => {
    const res = await api.get(`/items/${String(new Types.ObjectId())}`);
    expect(res.status).toBe(404);
    expect(refusal(res).code).toBe('NOT_FOUND');
  });

  describe('the item’s kind: stock or non-stock (OD-14 C)', () => {
    it('makes a stock item unless the create says otherwise, and keeps what it says', async () => {
      const stock = await item();
      expect(stock.stockTracked).toBe(true);
      const service = await item({ stockTracked: false });
      expect(service.stockTracked).toBe(false);
      const stored = await AdministrationItemModel.findById(service.id).lean().exec();
      expect(stored?.stockTracked).toBe(false);
      expect(data<AdministrationItemDto>(await api.get(`/items/${service.id}`))).toEqual(service);

      const [row] = await trail('item', service.id);
      expect(row?.changes).toContainEqual({ field: 'stockTracked', old: null, new: false });

      const refused = await api.post('/items', body({ stockTracked: 'no' }));
      expect(refused.status).toBe(400);
      expect(refusal(refused).code).toBe('VALIDATION_FAILED');
    });

    it('changes on an edit with its version, audited as an `update`; never to null', async () => {
      const created = await item();
      const edited = await api.patch(`/items/${created.id}`, { stockTracked: false, version: 0 });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(data<AdministrationItemDto>(edited)).toMatchObject({
        stockTracked: false,
        version: 1,
      });
      const rows = await trail('item', created.id);
      expect(rows.map((row) => row.action)).toEqual(['create', 'update']);
      expect(rows[1]?.changes).toEqual([{ field: 'stockTracked', old: true, new: false }]);

      const cleared = await api.patch(`/items/${created.id}`, { stockTracked: null, version: 1 });
      expect(cleared.status).toBe(400);
    });

    it('reads a row written before the kind existed as a stock item, and never rewrites it', async () => {
      const created = await item();
      // A row as P1a.2 wrote it: no `stockTracked` at all.
      await AdministrationItemModel.collection.updateOne(
        { _id: new Types.ObjectId(created.id) },
        { $unset: { stockTracked: '' } },
      );
      const older = await AdministrationItemModel.findById(created.id).lean().exec();
      expect(older).not.toHaveProperty('stockTracked');

      expect(data<AdministrationItemDto>(await api.get(`/items/${created.id}`)).stockTracked).toBe(
        true,
      );
      const listed = data<AdministrationItemDto[]>(
        await api.get(`/items?search=${encodeURIComponent(created.code)}`),
      );
      expect(listed.find((row) => row.id === created.id)?.stockTracked).toBe(true);

      // An edit of anything else leaves the row without the field, and the trail without it.
      const noted = await api.patch(`/items/${created.id}`, { notes: 'kept', version: 0 });
      expect(noted.status, JSON.stringify(noted.body)).toBe(200);
      expect(data<AdministrationItemDto>(noted).stockTracked).toBe(true);
      const after = await AdministrationItemModel.findById(created.id).lean().exec();
      expect(after, 'no row is rewritten').not.toHaveProperty('stockTracked');

      // Told what it already was, the trail records nothing new; told otherwise, a change from true.
      const same = await api.patch(`/items/${created.id}`, { stockTracked: true, version: 1 });
      expect(same.status).toBe(200);
      const off = await api.patch(`/items/${created.id}`, { stockTracked: false, version: 2 });
      expect(off.status).toBe(200);
      const rows = await trail('item', created.id);
      expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update']);
      expect(rows[1]?.changes).toEqual([{ field: 'notes', old: null, new: 'kept' }]);
      expect(rows[2]?.changes).toEqual([{ field: 'stockTracked', old: true, new: false }]);
    });
  });

  describe('the stock levels: 422 ADMINISTRATION_STOCK_LEVELS_ORDER (OD-09)', () => {
    it('refuses a create whose levels are out of order, naming both ends', async () => {
      refused(
        await api.post('/items', body({ minQty: 10, reorderPointQty: 5 })),
        422,
        'ADMINISTRATION_STOCK_LEVELS_ORDER',
        ['minQty', 'reorderPointQty'],
      );
      refused(
        await api.post('/items', body({ minQty: 2, reorderPointQty: 9, maxQty: 4 })),
        422,
        'ADMINISTRATION_STOCK_LEVELS_ORDER',
        ['reorderPointQty', 'maxQty'],
      );
    });

    it('judges an edit on the row it leaves — a new max below the stored minimum', async () => {
      const created = await item({ minQty: 8, reorderPointQty: 12 });
      refused(
        await api.patch(`/items/${created.id}`, { maxQty: 6, version: 0 }),
        422,
        'ADMINISTRATION_STOCK_LEVELS_ORDER',
        ['minQty', 'reorderPointQty', 'maxQty'],
      );
      const cleared = await api.patch(`/items/${created.id}`, {
        minQty: null,
        reorderPointQty: null,
        maxQty: 6,
        version: 0,
      });
      expect(cleared.status, 'a cleared level compares with nothing').toBe(200);
    });

    it('answers a stale edit 409 STALE_DOCUMENT before judging it on levels its sender never saw', async () => {
      const created = await item({ minQty: 8 });
      const first = await api.patch(`/items/${created.id}`, { reorderPointQty: 12, version: 0 });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      // Still on version 0, this sender sees no reorder point: a 422 naming one would be
      // unanswerable, and a retry with its own version could never pass.
      const stale = await api.patch(`/items/${created.id}`, { maxQty: 10, version: 0 });
      expect(stale.status, JSON.stringify(stale.body)).toBe(409);
      expect(refusal(stale).code).toBe('STALE_DOCUMENT');
    });

    it.each([
      ['a fractional level (OD-08)', { minQty: 1.5 }],
      ['a negative level', { maxQty: -1 }],
      ['a client-sent code', { code: 'ITM-00001' }],
      ['an on-hand figure', { onHandQty: 4 }],
      ['a barcode with a space', { barcode: '622 100' }],
      ['an Arabic name of tatweel alone', { name: { ar: 'ـ', en: 'Item' } }],
    ])('400 VALIDATION_FAILED for %s', async (_label, extra) => {
      const res = await api.post('/items', body(extra));
      expect(res.status).toBe(400);
      expect(refusal(res).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('what an item names: 422 ADMINISTRATION_REFERENCE_INACTIVE', () => {
    it('refuses a retired unit, a retired category, or both, each with its field', async () => {
      const oldUnit = await unit();
      await api.patch(`/catalog-items/${oldUnit.id}`, { isActive: false, version: 0 });
      const oldCategory = await category();
      await api.patch(`/item-categories/${oldCategory.id}`, { isActive: false, version: 0 });

      refused(
        await api.post('/items', body({ unitId: oldUnit.id })),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['unitId'],
      );
      refused(
        await api.post('/items', body({ categoryId: oldCategory.id })),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['categoryId'],
      );
      refused(
        await api.post('/items', body({ unitId: oldUnit.id, categoryId: oldCategory.id })),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['unitId', 'categoryId'],
      );
    });

    it('an item keeps a unit that retired after it was filed, and cannot be moved onto one', async () => {
      const box = await unit();
      const created = await item({ unitId: box.id });
      await api.patch(`/catalog-items/${box.id}`, { isActive: false, version: 0 });

      const kept = await api.patch(`/items/${created.id}`, {
        unitId: box.id.toUpperCase(),
        notes: 'still in boxes',
        version: 0,
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect(data<AdministrationItemDto>(kept)).toMatchObject({
        unitId: box.id,
        unitName: box.name,
      });

      const other = await item();
      refused(
        await api.patch(`/items/${other.id}`, { unitId: box.id, version: 0 }),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['unitId'],
      );
    });

    it('a unit or a category that does not exist is 404', async () => {
      for (const extra of [
        { unitId: String(new Types.ObjectId()) },
        { categoryId: String(new Types.ObjectId()) },
        { unitId: leaf.id },
      ]) {
        const res = await api.post('/items', body(extra));
        expect(res.status, JSON.stringify(extra)).toBe(404);
        expect(refusal(res).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('the category’s level: 422 ADMINISTRATION_SUBCATEGORY_REQUIRED (OD-06 (i))', () => {
    it('refuses a category that has active subcategories, on a create and on a move', async () => {
      const top = await category();
      await category({ parentId: top.id });
      refused(
        await api.post('/items', body({ categoryId: top.id })),
        422,
        'ADMINISTRATION_SUBCATEGORY_REQUIRED',
        ['categoryId'],
      );
      const created = await item();
      refused(
        await api.patch(`/items/${created.id}`, { categoryId: top.id, version: 0 }),
        422,
        'ADMINISTRATION_SUBCATEGORY_REQUIRED',
        ['categoryId'],
      );
    });

    it('an item filed before its category gained a subcategory keeps it until it is next edited', async () => {
      const top = await category();
      const created = await item({ categoryId: top.id });
      const sub = await category({ parentId: top.id });
      const kept = data<AdministrationItemDto>(await api.get(`/items/${created.id}`));
      expect(kept.categoryId, 'adding a level invalidates no item').toBe(top.id);

      // Retiring it, or bringing it back, and nothing else, is not that edit: a new level never
      // stops an item from being retired.
      const retired = await api.patch(`/items/${created.id}`, { isActive: false, version: 0 });
      expect(retired.status, JSON.stringify(retired.body)).toBe(200);
      expect(data<AdministrationItemDto>(retired)).toMatchObject({
        categoryId: top.id,
        isActive: false,
      });
      const back = await api.patch(`/items/${created.id}`, { isActive: true, version: 1 });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(data<AdministrationItemDto>(back)).toMatchObject({
        categoryId: top.id,
        isActive: true,
      });

      // Any other edit re-files it, whatever else it changes, a status change alongside included.
      for (const edit of [
        { notes: 'reclassify later' },
        { categoryId: top.id, notes: 'reclassify later' },
        { isActive: false, notes: 'retired' },
      ]) {
        refused(
          await api.patch(`/items/${created.id}`, { ...edit, version: 2 }),
          422,
          'ADMINISTRATION_SUBCATEGORY_REQUIRED',
          ['categoryId'],
        );
      }
      const refiled = await api.patch(`/items/${created.id}`, {
        categoryId: sub.id,
        notes: 'reclassified',
        version: 2,
      });
      expect(refiled.status, JSON.stringify(refiled.body)).toBe(200);
      expect(data<AdministrationItemDto>(refiled)).toMatchObject({
        categoryId: sub.id,
        categoryParentId: top.id,
      });
    });

    it('a category whose subcategories all retired takes items again', async () => {
      const top = await category();
      const sub = await category({ parentId: top.id });
      await api.patch(`/item-categories/${sub.id}`, { isActive: false, version: 0 });
      const created = await item({ categoryId: top.id });
      expect(created.categoryId).toBe(top.id);
    });
  });

  describe('duplicates: 409 ADMINISTRATION_DUPLICATE', () => {
    it('refuses a second spelling of a live item’s name, and a retired item keeps its name', async () => {
      const ink = await item({ name: { ar: 'حبر طابعة أسود', en: 'Black ink' } });
      refused(
        await api.post('/items', body({ name: { ar: 'حِبر طابعه اسود', en: 'Ink' } })),
        409,
        'ADMINISTRATION_DUPLICATE',
        ['name'],
      );
      await api.patch(`/items/${ink.id}`, { isActive: false, version: 0 });
      refused(
        await api.post('/items', body({ name: { ar: 'حبر طابعة أسود', en: 'Ink' } })),
        409,
        'ADMINISTRATION_DUPLICATE',
        ['name'],
      );
    });

    it('a live barcode fails on ux_barcode inside the create, and the next create takes the same number', async () => {
      const first = await item({ barcode: 'BC-200100' });
      const clash = await api.post('/items', body({ barcode: 'BC-200100' }));
      refused(clash, 409, 'ADMINISTRATION_DUPLICATE', ['barcode']);
      const next = await item();
      expect(seqOf(next.code), 'the refused create gave its number back').toBe(
        seqOf(first.code) + 1,
      );
    });

    it('an edit onto a live barcode meets the index too, raw from the update', async () => {
      await item({ barcode: 'BC-200200' });
      const other = await item({ barcode: 'BC-200201' });
      refused(
        await api.patch(`/items/${other.id}`, { barcode: 'BC-200200', version: 0 }),
        409,
        'ADMINISTRATION_DUPLICATE',
        ['barcode'],
      );
      const cleared = await api.patch(`/items/${other.id}`, { barcode: null, version: 0 });
      expect(cleared.status, 'no barcode is no clash').toBe(200);
      expect(await item({ barcode: 'BC-200201' })).toMatchObject({ barcode: 'BC-200201' });
    });

    it('when a racing create passes the early check, ux_name_key refuses it inside the transaction', async () => {
      await item({ name: { ar: 'دبوس ورق', en: 'Paper clip' } });
      const spy = vi
        .spyOn(administrationItemRepository, 'findLiveByNameKey')
        .mockResolvedValueOnce(null);
      const before = await AdministrationCounterModel.findOne({ key: 'item:global' }).lean().exec();
      const raced = await api.post('/items', body({ name: { ar: 'دَبوس ورق', en: 'Clip' } }));
      spy.mockRestore();
      refused(raced, 409, 'ADMINISTRATION_DUPLICATE', ['name']);
      const after = await AdministrationCounterModel.findOne({ key: 'item:global' }).lean().exec();
      expect(after?.seq, 'the number went back with the transaction').toBe(before?.seq);
    });
  });
});

describe('item codes under concurrency (OD-05 A, §19.10.5)', () => {
  it('simultaneous creates all answer 201, with consecutive, distinct codes', async () => {
    const leafCategory = await category();
    const each = await unit();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        api.post('/items', {
          name: fresh('صنف متزامن', 'Concurrent item'),
          categoryId: leafCategory.id,
          unitId: each.id,
        }),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual(Array.from({ length: 6 }, () => 201));
    const seqs = responses
      .map((res) => seqOf(data<AdministrationItemDto>(res).code))
      .sort((a, b) => a - b);
    const first = seqs[0] ?? Number.NaN;
    expect(seqs).toEqual(seqs.map((_, i) => first + i));
  });
});

describe('two spellings typed at the same moment', () => {
  // The design's own pair (§19.7): «قطعه» and «قطعة», one word in two spellings.
  it.each([
    ['units', '/catalog-items', { kind: 'unit' }, 'قطعه صغيرة', 'قطعة صغيره'],
    ['categories', '/item-categories', {}, 'قطعه', 'قطعة'],
  ])('%s: one 201, one 409 ADMINISTRATION_DUPLICATE on name', async (_label, path, extra, a, b) => {
    const [first, second] = await Promise.all([
      api.post(path, { ...extra, name: { ar: a, en: 'Piece A' } }),
      api.post(path, { ...extra, name: { ar: b, en: 'Piece B' } }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refusal(refused)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
  });

  it('items: one 201, one 409 ADMINISTRATION_DUPLICATE on name — ux_name_key, inside the transaction', async () => {
    const references = { categoryId: (await category()).id, unitId: (await unit()).id };
    const [first, second] = await Promise.all([
      api.post('/items', { ...references, name: { ar: 'قطعه كبيرة', en: 'Piece A' } }),
      api.post('/items', { ...references, name: { ar: 'قطعة كبيره', en: 'Piece B' } }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refusal(refused)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
    const stored = await AdministrationItemModel.countDocuments({
      nameKey: foldName('قطعة كبيرة'),
    }).exec();
    expect(stored).toBe(1);
  });
});

describe('who may read and write', () => {
  /** One item, filed by the master-data desk, for the cases that only need one to exist. */
  const anItem = async (): Promise<AdministrationItemDto> => {
    const res = await api.post('/items', {
      name: fresh('صنف', 'Item'),
      categoryId: (await category()).id,
      unitId: (await unit()).id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<AdministrationItemDto>(res);
  };

  it('403 without the key, on every route', async () => {
    const outsider = administrationApi(world.app, world.outsiderToken);
    const meter = await unit();
    const top = await category();
    const filed = await anItem();
    for (const res of [
      await outsider.get('/catalog-items?kind=unit'),
      await outsider.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') }),
      await outsider.patch(`/catalog-items/${meter.id}`, { sortOrder: 1, version: 0 }),
      await outsider.get('/item-categories'),
      await outsider.post('/item-categories', { name: fresh('ج', 'C') }),
      await outsider.patch(`/item-categories/${top.id}`, { sortOrder: 1, version: 0 }),
      await outsider.get('/items'),
      await outsider.get(`/items/${filed.id}`),
      await outsider.post('/items', {
        name: fresh('ج', 'C'),
        categoryId: top.id,
        unitId: meter.id,
      }),
      await outsider.patch(`/items/${filed.id}`, { notes: 'x', version: 0 }),
    ]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
  });

  it('a catalog manager alone reads and writes the catalogs by their own key, and reads no item', async () => {
    const catalogs = administrationApi(world.app, world.catalogManagerToken);
    const filed = await anItem();

    // Each half of the widened read gate on its own: this is the catalog key's half.
    const units = await catalogs.get('/catalog-items?kind=unit&pageSize=100');
    expect(units.status, JSON.stringify(units.body)).toBe(200);
    expect(data<AdministrationCatalogItemDto[]>(units).length).toBeGreaterThan(0);
    const categories = await catalogs.get('/item-categories?pageSize=100');
    expect(categories.status, JSON.stringify(categories.body)).toBe(200);
    expect(data<AdministrationItemCategoryDto[]>(categories).length).toBeGreaterThan(0);
    const created = await catalogs.post('/catalog-items', {
      kind: 'unit',
      name: fresh('وحدة', 'Unit'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    for (const res of [await catalogs.get('/items'), await catalogs.get(`/items/${filed.id}`)]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
  });

  it('an item viewer reads units and categories — the item form’s lists — and the items, and writes none of them', async () => {
    const viewer = administrationApi(world.app, world.itemViewerToken);
    const meter = await unit();
    const top = await category();
    const filed = await anItem();

    const units = await viewer.get('/catalog-items?kind=unit&pageSize=100');
    expect(units.status).toBe(200);
    expect(data<AdministrationCatalogItemDto[]>(units).length).toBeGreaterThan(0);
    const categories = await viewer.get('/item-categories?topLevel=true&pageSize=100');
    expect(categories.status).toBe(200);
    expect(data<AdministrationItemCategoryDto[]>(categories).length).toBeGreaterThan(0);
    expect((await viewer.get('/items')).status).toBe(200);
    expect(data<AdministrationItemDto>(await viewer.get(`/items/${filed.id}`)).id).toBe(filed.id);

    for (const res of [
      await viewer.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') }),
      await viewer.patch(`/catalog-items/${meter.id}`, { sortOrder: 1, version: 0 }),
      await viewer.post('/item-categories', { name: fresh('ج', 'C') }),
      await viewer.patch(`/item-categories/${top.id}`, { sortOrder: 1, version: 0 }),
      await viewer.post('/items', {
        name: fresh('ج', 'C'),
        categoryId: top.id,
        unitId: meter.id,
      }),
      await viewer.patch(`/items/${filed.id}`, { notes: 'x', version: 0 }),
    ]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
  });

  it('a purchase-request creator reads the items — the request’s picker — and writes none (P2.2)', async () => {
    // The widened read gate's other half: `administrationPurchaseRequest.create` alone, no item key.
    const picker = administrationApi(
      world.app,
      await world
        .personWith(
          'request-picker',
          ['administrationPurchaseRequest.create'],
          'organization',
          null,
        )
        .then((p) => p.token),
    );
    const filed = await anItem();
    const list = await picker.get('/items?isActive=true');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(data<AdministrationItemDto[]>(list).length).toBeGreaterThan(0);
    expect(data<AdministrationItemDto>(await picker.get(`/items/${filed.id}`)).id).toBe(filed.id);
    for (const res of [
      await picker.post('/items', {
        name: fresh('ج', 'C'),
        categoryId: filed.categoryId,
        unitId: filed.unitId,
      }),
      await picker.patch(`/items/${filed.id}`, { notes: 'x', version: 0 }),
      // The picker is the items alone: the catalogs keep their own gate.
      await picker.get('/catalog-items?kind=unit'),
    ]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
  });

  it('403 below organization scope (OD-04 A): a branch holder reads the register but writes none of it', async () => {
    const branch = administrationApi(world.app, world.branchManagerToken);
    const meter = await unit();
    const top = await category();

    expect((await branch.get('/catalog-items?kind=unit')).status).toBe(200);
    const read = data<AdministrationItemCategoryDto[]>(
      await branch.get('/item-categories?pageSize=100'),
    );
    expect(read.length, 'master data is read whole').toBeGreaterThan(0);

    const filed = await anItem();
    expect((await branch.get('/items')).status).toBe(200);
    expect((await branch.get(`/items/${filed.id}`)).status).toBe(200);

    for (const res of [
      await branch.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') }),
      await branch.patch(`/catalog-items/${meter.id}`, { isActive: false, version: 0 }),
      await branch.post('/item-categories', { name: fresh('ج', 'C') }),
      await branch.patch(`/item-categories/${top.id}`, { sortOrder: 1, version: 0 }),
      await branch.post('/items', {
        name: fresh('ج', 'C'),
        categoryId: top.id,
        unitId: meter.id,
      }),
      await branch.patch(`/items/${filed.id}`, { isActive: false, version: 0 }),
    ]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
    const untouched = await AdministrationCatalogItemModel.findById(meter.id).lean().exec();
    expect(untouched?.isActive).toBe(true);
    const item = await AdministrationItemModel.findById(filed.id).lean().exec();
    expect(item?.isActive).toBe(true);
  });

  it('the super-admin writes, as an organization holder of every key', async () => {
    const admin = administrationApi(world.app, world.adminToken);
    const res = await admin.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') });
    expect(res.status).toBe(201);
  });
});
