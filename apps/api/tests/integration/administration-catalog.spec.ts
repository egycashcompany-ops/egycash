// Administrative Affairs' catalog over real HTTP, real RBAC and a real database (design §19.7) —
// P1a.1's part: units of measure and item categories. Items join this file in P1a.2.
//
// What a mocked spec cannot see: the folded name stored and indexed, so «قطعه» typed after «قطعة»
// is the same unit — even when the two are typed at the same moment, where only the unique index
// can refuse the second; the two-level rule judged against real parents and children; every
// refusal answered with its own code (§5.15); the writes held to organization scope (OD-04 A)
// while the reads are not; the trail's verbs; and the seed's indexes and its ready-made role.
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  foldName,
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { RoleModel } from '../../src/platform/rbac/role.model';
import { AdministrationCatalogItemModel } from '../../src/modules/administration/catalog/catalog-items/catalog-item.model';
import { administrationCatalogItemRepository } from '../../src/modules/administration/catalog/catalog-items/catalog-item.repository';
import { AdministrationItemCategoryModel } from '../../src/modules/administration/catalog/item-categories/item-category.model';
import { administrationItemCategoryRepository } from '../../src/modules/administration/catalog/item-categories/item-category.repository';
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
    // repository's `collectionReady` has run: only the seed's `syncDeclaredIndexes` brings them back.
    for (const model of [AdministrationCatalogItemModel, AdministrationItemCategoryModel]) {
      await model.init();
      await model.collection.dropIndexes();
      const left = await model.collection.indexes();
      expect(left.map((index) => index.name)).toEqual(['_id_']);
    }
    await seedAdministration();

    const units = await AdministrationCatalogItemModel.collection.indexes();
    expect(units.map((index) => index.name)).toEqual(
      expect.arrayContaining(['ux_kind_name_key', 'ux_kind_code', 'ix_kind_active_sort']),
    );
    const categories = await AdministrationItemCategoryModel.collection.indexes();
    expect(categories.map((index) => index.name)).toEqual(
      expect.arrayContaining(['ux_parent_name_key', 'ux_code', 'ix_parent_active_sort']),
    );
  });

  it('seeds the master-data administrator as a managed role with the catalog key (OD-78 A)', async () => {
    const role = await RoleModel.findOne({ key: 'administration-master-data' }).lean().exec();
    expect(role).toMatchObject({
      name: { en: 'Master-data administrator', ar: 'مسؤول البيانات الأساسية' },
      isSystem: false,
      permissionKeys: ['administrationCatalog.manage'],
    });
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
});

describe('who may read and write', () => {
  it('403 without the key, on every route', async () => {
    const outsider = administrationApi(world.app, world.outsiderToken);
    const meter = await unit();
    const top = await category();
    for (const res of [
      await outsider.get('/catalog-items?kind=unit'),
      await outsider.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') }),
      await outsider.patch(`/catalog-items/${meter.id}`, { sortOrder: 1, version: 0 }),
      await outsider.get('/item-categories'),
      await outsider.post('/item-categories', { name: fresh('ج', 'C') }),
      await outsider.patch(`/item-categories/${top.id}`, { sortOrder: 1, version: 0 }),
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

    for (const res of [
      await branch.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') }),
      await branch.patch(`/catalog-items/${meter.id}`, { isActive: false, version: 0 }),
      await branch.post('/item-categories', { name: fresh('ج', 'C') }),
      await branch.patch(`/item-categories/${top.id}`, { sortOrder: 1, version: 0 }),
    ]) {
      expect(res.status).toBe(403);
      expect(refusal(res).code).toBe('FORBIDDEN');
    }
    const untouched = await AdministrationCatalogItemModel.findById(meter.id).lean().exec();
    expect(untouched?.isActive).toBe(true);
  });

  it('the super-admin writes, as an organization holder of every key', async () => {
    const admin = administrationApi(world.app, world.adminToken);
    const res = await admin.post('/catalog-items', { kind: 'unit', name: fresh('ج', 'C') });
    expect(res.status).toBe(201);
  });
});
