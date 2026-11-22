// «حبارات» given the printer's counter by the deploy, against a real mongo — «عند صرف الصنف : حبارة
// أو النوع : حبارات .. عايز يبقى فى Counter لعدد لورق المطبوع للطابعة اللى بيركب عليها الحبارة», and
// of the flag «يتطلب عداد الطباعة» on the type: ticked on «حبارات» from the start.
//
// What a source-reading test cannot see: the live catalog's «حبارات» (seeded before the flag, so
// its row has no key at all) ticked and no other type; found by its code or else by its Arabic
// name, and ticked even retired; a deleted one reported missing and nothing made in its place; a
// row already ticked — a fresh catalog's seed — reported as such and not written; the version
// moved, so a catalog form opened before the tick answers 409; the trail and the run row say what
// happened; nothing done before the types' own seed (and no run row, so the next boot tries
// again); and all of it once — a type the IT team unticks after the run stays unticked, and two
// processes racing tick it once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { itCatalogItemService } from '../../src/modules/it/catalog-items';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import {
  IT_CONSUMABLE_TYPES_MARK,
  seedItConsumableTypes,
} from '../../src/modules/it/go-live/consumable-types';
import {
  IT_CONSUMABLE_COUNTER_TYPES_MARK,
  flagItConsumableCounterTypes,
} from '../../src/modules/it/go-live/consumable-counter-types';

let replSet: MongoMemoryReplSet | null = null;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-counter-types-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** A catalog with no consumable type and neither step run — each case below starts from it. */
const emptyCatalog = async (): Promise<void> => {
  await ItCatalogItemModel.deleteMany({ kind: 'consumableType' }).exec();
  await ItGoLiveRunModel.deleteMany({
    key: { $in: [IT_CONSUMABLE_TYPES_MARK, IT_CONSUMABLE_COUNTER_TYPES_MARK] },
  }).exec();
};

/** The types' seed as the live database ran it on 2026-11-17 — its rows hold no flag at all. */
const seededBeforeTheFlag = async (): Promise<void> => {
  expect((await seedItConsumableTypes()).status).toBe('done');
  await ItCatalogItemModel.collection.updateMany(
    { kind: 'consumableType' },
    {
      $unset: { requiresCounterReading: '' },
      $set: { updatedAt: new Date('2026-11-17T08:00:00.000Z') },
    },
  );
};

/** The types' run row alone: the IT team made (or deleted) their own types, the seed kept them. */
const typesRunRow = async (): Promise<void> => {
  await ItGoLiveRunModel.create({
    key: IT_CONSUMABLE_TYPES_MARK,
    finishedAt: new Date(),
    outcome: {},
  });
};

const plantType = async (over: {
  code: string | null;
  ar: string;
  isActive?: boolean;
  isDeleted?: boolean;
}): Promise<Types.ObjectId> => {
  const _id = new Types.ObjectId();
  const at = new Date('2026-11-01T08:00:00.000Z');
  await ItCatalogItemModel.collection.insertOne({
    _id,
    kind: 'consumableType',
    code: over.code,
    name: { ar: over.ar, en: over.ar },
    description: null,
    sortOrder: 10,
    isActive: over.isActive ?? true,
    schemaVersion: 1,
    isDeleted: over.isDeleted ?? false,
    deletedAt: over.isDeleted === true ? at : null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: at,
    updatedAt: at,
    __v: 0,
  });
  return _id;
};

const typeByCode = (code: string) =>
  ItCatalogItemModel.findOne({ kind: 'consumableType', code, isDeleted: false }).lean().exec();

const counterAudits = (id: Types.ObjectId | string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'it',
    'entityRef.entityType': 'catalogItem',
    'entityRef.entityId': String(id),
    action: 'update',
  })
    .lean()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('before the types are seeded', () => {
  it('refuses, writes nothing and no run row — so the next boot tries again', async () => {
    await emptyCatalog();
    await plantType({ code: 'ink', ar: 'حبارات' });

    expect(await flagItConsumableCounterTypes()).toEqual({
      status: 'refused',
      reason: 'typesNotSeeded',
    });
    expect(await typeByCode('ink')).not.toHaveProperty('requiresCounterReading');
    expect(
      await ItGoLiveRunModel.countDocuments({ key: IT_CONSUMABLE_COUNTER_TYPES_MARK }).exec(),
    ).toBe(0);
  });
});

describe('the live catalog, seeded before the flag', () => {
  let inkId: Types.ObjectId;

  it('ticks «حبارات» and no other type, moving its version', async () => {
    await emptyCatalog();
    await seededBeforeTheFlag();
    const before = await typeByCode('ink');
    inkId = before?._id as Types.ObjectId;
    expect(before).not.toHaveProperty('requiresCounterReading');

    const outcome = await flagItConsumableCounterTypes();

    expect(outcome).toEqual({
      status: 'done',
      flagged: [{ code: 'ink', id: String(inkId), name: 'حبارات', by: 'code', active: true }],
      alreadyFlagged: [],
      missing: [],
    });
    const after = await typeByCode('ink');
    expect(after).toMatchObject({ requiresCounterReading: true, __v: 1, updatedBy: null });
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity);
    // The other eight are left exactly as they were.
    const others = await ItCatalogItemModel.find({
      kind: 'consumableType',
      code: { $ne: 'ink' },
    })
      .lean()
      .exec();
    expect(others).toHaveLength(8);
    for (const type of others) {
      expect(type).not.toHaveProperty('requiresCounterReading');
      expect(type.__v).toBe(0);
    }
  });

  it('says so in the trail and in the run row', async () => {
    const audits = await counterAudits(inkId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes).toEqual([
      { field: 'requiresCounterReading', old: false, new: true },
      { field: 'source', old: null, new: IT_CONSUMABLE_COUNTER_TYPES_MARK },
    ]);
    const run = await ItGoLiveRunModel.findOne({ key: IT_CONSUMABLE_COUNTER_TYPES_MARK })
      .lean()
      .exec();
    expect(run?.outcome).toEqual({
      flagged: [{ code: 'ink', id: String(inkId), name: 'حبارات', by: 'code', active: true }],
      alreadyFlagged: [],
      missing: [],
    });
  });

  it('answers 409 to a catalog form opened before the tick, rather than saving over it', async () => {
    const save = itCatalogItemService.update(
      String(inkId),
      { sortOrder: 15, version: 0 },
      String(new Types.ObjectId()),
    );
    await expect(save).rejects.toMatchObject({ httpStatus: 409 });
    expect(await typeByCode('ink')).toMatchObject({ sortOrder: 10, requiresCounterReading: true });
  });

  it('happens once: a type the IT team unticks after the run stays unticked', async () => {
    await itCatalogItemService.update(
      String(inkId),
      { requiresCounterReading: false, version: 1 },
      String(new Types.ObjectId()),
    );

    expect(await flagItConsumableCounterTypes()).toEqual({ status: 'alreadyDone' });
    expect(await typeByCode('ink')).toMatchObject({ requiresCounterReading: false, __v: 2 });
    // The IT team's untick is the only other trail row.
    expect(await counterAudits(inkId)).toHaveLength(2);
  });
});

describe('the IT team’s own «حبارات»', () => {
  it('is found by its Arabic name when it has no code — and ticked though retired', async () => {
    await emptyCatalog();
    await typesRunRow();
    const theirs = await plantType({ code: null, ar: 'حبارات', isActive: false });

    expect(await flagItConsumableCounterTypes()).toEqual({
      status: 'done',
      flagged: [{ code: 'ink', id: String(theirs), name: 'حبارات', by: 'name', active: false }],
      alreadyFlagged: [],
      missing: [],
    });
    expect(await ItCatalogItemModel.findById(theirs).lean().exec()).toMatchObject({
      requiresCounterReading: true,
      isActive: false,
      __v: 1,
    });
  });

  it('is found by its code under a name of their own', async () => {
    await emptyCatalog();
    await typesRunRow();
    const theirs = await plantType({ code: 'INK', ar: 'أحبار وتونر' });

    expect(await flagItConsumableCounterTypes()).toMatchObject({
      status: 'done',
      flagged: [{ code: 'ink', id: String(theirs), name: 'أحبار وتونر', by: 'code', active: true }],
    });
  });

  it('deleted, is reported missing — nothing is made in its place, the deleted row untouched', async () => {
    await emptyCatalog();
    await typesRunRow();
    const deleted = await plantType({ code: 'ink', ar: 'حبارات', isDeleted: true });

    expect(await flagItConsumableCounterTypes()).toEqual({
      status: 'done',
      flagged: [],
      alreadyFlagged: [],
      missing: ['ink'],
    });
    expect(await ItCatalogItemModel.countDocuments({ kind: 'consumableType' }).exec()).toBe(1);
    expect(await ItCatalogItemModel.findById(deleted).lean().exec()).not.toHaveProperty(
      'requiresCounterReading',
    );
    expect(await counterAudits(deleted)).toHaveLength(0);
  });
});

describe('a fresh catalog', () => {
  it('was born with «حبارات» ticked: the step finds it so and writes nothing', async () => {
    await emptyCatalog();
    expect((await seedItConsumableTypes()).status).toBe('done');
    const ink = await typeByCode('ink');
    expect(ink).toMatchObject({ requiresCounterReading: true, __v: 0 });

    expect(await flagItConsumableCounterTypes()).toEqual({
      status: 'done',
      flagged: [],
      alreadyFlagged: [
        { code: 'ink', id: String(ink?._id), name: 'حبارات', by: 'code', active: true },
      ],
      missing: [],
    });
    expect(await typeByCode('ink')).toMatchObject({ requiresCounterReading: true, __v: 0 });
    expect(await counterAudits(ink?._id as Types.ObjectId)).toHaveLength(0);
  });
});

describe('two processes booting at once', () => {
  it('tick it once: one run is done, the other finds the run row', async () => {
    await emptyCatalog();
    await seededBeforeTheFlag();
    const ink = await typeByCode('ink');

    const outcomes = await Promise.all([
      flagItConsumableCounterTypes(),
      flagItConsumableCounterTypes(),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['alreadyDone', 'done']);
    expect(await typeByCode('ink')).toMatchObject({ requiresCounterReading: true, __v: 1 });
    expect(
      await ItGoLiveRunModel.countDocuments({ key: IT_CONSUMABLE_COUNTER_TYPES_MARK }).exec(),
    ).toBe(1);
    expect(await counterAudits(ink?._id as Types.ObjectId)).toHaveLength(1);
  });
});
