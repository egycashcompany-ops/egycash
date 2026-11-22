// The consumables' types seeded, against a real mongo — «للمستهلكات زي: حبارات - كابلات بأنواعها -
// كونفرترات (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات - فلاشات - وهكذا».
//
// What a source-reading test cannot see: the owner's types written as ordinary catalog rows of the
// new kind, in his order; a type the IT team already made left exactly as it is and nothing seeded
// beside it — by its code or by its Arabic name, retired or not — an asset category of the same name
// not counted as one; and the whole thing done once, so a type deleted since stays deleted. And a
// fresh catalog's «حبارات» born taking the printer's counter («يتطلب عداد الطباعة»), no other type.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import {
  IT_CONSUMABLE_TYPES_MARK,
  seedItConsumableTypes,
} from '../../src/modules/it/go-live/consumable-types';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const TONER = new Types.ObjectId();
const CABLES = new Types.ObjectId();
const ASSET_OTHER = new Types.ObjectId();

const plantCatalogItem = async (
  _id: Types.ObjectId,
  kind: 'assetCategory' | 'consumableType',
  code: string | null,
  ar: string,
  isActive: boolean,
): Promise<void> => {
  await ItCatalogItemModel.collection.insertOne({
    _id,
    kind,
    code,
    name: { ar, en: ar },
    description: null,
    sortOrder: 0,
    isActive,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const liveTypes = () =>
  ItCatalogItemModel.find({ kind: 'consumableType', isDeleted: false })
    .sort({ sortOrder: 1, _id: 1 })
    .lean()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  // The IT team's own toner type: coded like the seed's, in capitals, and retired since.
  await plantCatalogItem(TONER, 'consumableType', 'INK', 'أحبار وتونر', false);
  // Their own «كابلات», with no code at all.
  await plantCatalogItem(CABLES, 'consumableType', null, 'كابلات', true);
  // An ASSET category that happens to share a type's name — another list, not a type.
  await plantCatalogItem(ASSET_OTHER, 'assetCategory', null, 'أخرى', true);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('seeding the consumable types', () => {
  it('writes the owner’s types the catalog lacks, and leaves the IT team’s own alone', async () => {
    const outcome = await seedItConsumableTypes();

    expect(outcome).toEqual({
      status: 'done',
      created: ['adapters', 'mice', 'keyboards', 'memory', 'storage', 'flash', 'other'],
      kept: [
        { code: 'ink', id: String(TONER), name: 'أحبار وتونر', by: 'code', active: false },
        { code: 'cables', id: String(CABLES), name: 'كابلات', by: 'name', active: true },
      ],
    });

    // Ordinary catalog rows of the new kind, in the owner's order, «أخرى» last.
    const seeded = (await liveTypes()).filter(
      (type) => !type._id.equals(TONER) && !type._id.equals(CABLES),
    );
    expect(seeded.map((type) => [type.code, type.name.ar, type.name.en, type.sortOrder])).toEqual([
      ['adapters', 'محولات', 'Adapters', 30],
      ['mice', 'ماوس', 'Mice', 40],
      ['keyboards', 'كيبورد', 'Keyboards', 50],
      ['memory', 'رامات', 'Memory (RAM)', 60],
      ['storage', 'هاردات', 'Storage drives', 70],
      ['flash', 'فلاشات', 'Flash drives', 80],
      ['other', 'أخرى', 'Other', 90],
    ]);
    for (const type of seeded) {
      expect(type).toMatchObject({
        kind: 'consumableType',
        description: null,
        isActive: true,
        isDeleted: false,
        createdBy: null,
        // None of these goes into a printer: only «حبارات» takes the counter.
        requiresCounterReading: false,
      });
    }

    // The IT team's own, exactly as they were — no twin beside either. Their toner type is not
    // ticked here either: the seed leaves a kept row alone, and the counter's own step ticks it.
    const toner = await ItCatalogItemModel.findById(TONER).lean().exec();
    expect(toner).toMatchObject({
      code: 'INK',
      name: { ar: 'أحبار وتونر' },
      isActive: false,
    });
    expect(toner).not.toHaveProperty('requiresCounterReading');
    expect(await ItCatalogItemModel.findById(CABLES).lean().exec()).toMatchObject({
      code: null,
      isActive: true,
    });
    expect(await liveTypes()).toHaveLength(9);
    // The asset category is untouched, and «أخرى» is a type all the same.
    expect(await ItCatalogItemModel.countDocuments({ kind: 'assetCategory' }).exec()).toBe(1);

    const run = await ItGoLiveRunModel.findOne({ key: IT_CONSUMABLE_TYPES_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({
      created: outcome.status === 'done' ? outcome.created : [],
    });
  });

  it('happens once: a later boot writes nothing, and a type deleted since stays deleted', async () => {
    await ItCatalogItemModel.updateOne(
      { kind: 'consumableType', code: 'flash' },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    ).exec();

    expect((await seedItConsumableTypes()).status).toBe('alreadyDone');
    expect(await liveTypes()).toHaveLength(8);
    expect(await ItCatalogItemModel.countDocuments({ kind: 'consumableType' }).exec()).toBe(9);
  });

  // «يتطلب عداد الطباعة», ticked on «حبارات» from the start (19 November 2026): a catalog that
  // never had the types gets all nine, and its «حبارات» is born taking the printer's counter.
  it('seeds a fresh catalog’s «حبارات» taking the printer counter, and no other type', async () => {
    await ItCatalogItemModel.deleteMany({ kind: 'consumableType' }).exec();
    await ItGoLiveRunModel.deleteOne({ key: IT_CONSUMABLE_TYPES_MARK }).exec();

    const outcome = await seedItConsumableTypes();
    expect(outcome).toMatchObject({ status: 'done', kept: [] });

    expect(
      (await liveTypes()).map((type) => [type.code, type.name.ar, type.requiresCounterReading]),
    ).toEqual([
      ['ink', 'حبارات', true],
      ['cables', 'كابلات', false],
      ['adapters', 'محولات', false],
      ['mice', 'ماوس', false],
      ['keyboards', 'كيبورد', false],
      ['memory', 'رامات', false],
      ['storage', 'هاردات', false],
      ['flash', 'فلاشات', false],
      ['other', 'أخرى', false],
    ]);

    // Its audit row says so, as the catalog service's would for a type made ticked.
    const ink = (await liveTypes()).find((type) => type.code === 'ink');
    const created = await AuditLogModel.findOne({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'catalogItem',
      'entityRef.entityId': String(ink?._id),
      action: 'create',
    })
      .lean()
      .exec();
    expect(created?.changes).toContainEqual({
      field: 'requiresCounterReading',
      old: null,
      new: true,
    });
  });
});
