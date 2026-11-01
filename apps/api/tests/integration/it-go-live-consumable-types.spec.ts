// The consumables' types seeded, against a real mongo — «للمستهلكات زي: حبارات - كابلات بأنواعها -
// كونفرترات (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات - فلاشات - وهكذا».
//
// What a source-reading test cannot see: the owner's types written as ordinary catalog rows of the
// new kind, in his order; a type the IT team already made left exactly as it is and nothing seeded
// beside it — by its code or by its Arabic name, retired or not — an asset category of the same name
// not counted as one; and the whole thing done once, so a type deleted since stays deleted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
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
      });
    }

    // The IT team's own, exactly as they were — no twin beside either.
    expect(await ItCatalogItemModel.findById(TONER).lean().exec()).toMatchObject({
      code: 'INK',
      name: { ar: 'أحبار وتونر' },
      isActive: false,
    });
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
});
