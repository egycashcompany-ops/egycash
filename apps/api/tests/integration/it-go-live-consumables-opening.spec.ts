// The consumables' opening stock entered, against a real mongo — «دخّل الأرصدة».
//
// What a source-reading test cannot see: every item added to the store of the branch the file
// names, under its type — the branch found in the organisation's list and the whole run refused
// while it is missing, while the types are not seeded, or while one it needs is retired — each with
// ONE received movement of its count and the counters that movement makes; the new items' codes one
// unbroken block; an item the store already keeps received into rather than doubled (however its
// name is written, and even retired), another store's item of the same name left as its own; and
// the whole thing done once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { ItConsumableModel } from '../../src/modules/it/consumables/consumable.model';
import { ItConsumableMovementModel } from '../../src/modules/it/consumables/consumable-movement.model';
import {
  CONSUMABLE_SEQUENCE_KEY,
  formatConsumableCode,
} from '../../src/modules/it/consumables/consumable-number';
import { currentSequenceValue, nextSequenceValue } from '../../src/modules/it/shared/sequence';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import { seedItConsumableTypes } from '../../src/modules/it/go-live/consumable-types';
import {
  IT_CONSUMABLES_OPENING_MARK,
  importItConsumablesOpening,
} from '../../src/modules/it/go-live/consumables-opening';
import { type ConsumablesOpeningFile } from '../../src/modules/it/go-live/consumables-opening-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-10-28T09:00:00.000Z');
const HQ = new Types.ObjectId();
const ASSIUT = new Types.ObjectId();
const SOURCE = 'جرد الأجهزة.xlsx — الصفحة الأولى، صف «إجمالي»';
// The store's own items, there before the import — none of them a seeded type's to judge.
const SOME_TYPE = new Types.ObjectId();
const MOUSE = new Types.ObjectId();
const RAM = new Types.ObjectId();
const ASSIUT_KEYBOARD = new Types.ObjectId();

const FILE: ConsumablesOpeningFile = {
  source: SOURCE,
  branch: 'المهندسين',
  items: [
    { key: 'جرد الأجهزة — SSD', name: 'SSD', type: 'storage', unit: 'قطعة', qty: 3 },
    { key: 'جرد الأجهزة — Ram 8giga', name: 'RAM 8 GB', type: 'memory', unit: 'قطعة', qty: 5 },
    { key: 'جرد الأجهزة — Keyboard', name: 'Keyboard', type: 'keyboards', unit: 'قطعة', qty: 23 },
    { key: 'جرد الأجهزة — Mouse', name: 'Mouse', type: 'mice', unit: 'قطعة', qty: 13 },
    { key: 'جرد الأجهزة — HDMI 3M', name: 'HDMI Cable 3 m', type: 'cables', unit: 'قطعة', qty: 11 },
  ],
};

const plantBranch = async (_id: Types.ObjectId, code: string, ar: string): Promise<void> => {
  await BranchModel.collection.insertOne({
    _id,
    code,
    name: { ar, en: code },
    status: 'active',
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

/** An item the store keeps already — its code from the register's own series, as any item's. */
const plantItem = async (
  _id: Types.ObjectId,
  branchId: Types.ObjectId,
  name: string,
  counters: { onHandQty: number; issuedQty: number; scrappedQty: number },
  active = true,
): Promise<void> => {
  await ItConsumableModel.collection.insertOne({
    _id,
    code: formatConsumableCode(await nextSequenceValue(CONSUMABLE_SEQUENCE_KEY)),
    name,
    typeId: SOME_TYPE,
    unit: 'قطعة',
    branchId,
    minQty: null,
    notes: null,
    active,
    ...counters,
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const itemIn = (branchId: Types.ObjectId, name: string) =>
  ItConsumableModel.findOne({ branchId, name, isDeleted: false }).lean().exec();

const typeId = async (code: string): Promise<string> =>
  String((await ItCatalogItemModel.findOne({ kind: 'consumableType', code }).lean().exec())?._id);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantBranch(ASSIUT, 'AST', 'أسيوط');
  // The head office's store keeps a mouse already (two on the shelf, one issued)…
  await plantItem(MOUSE, HQ, 'Mouse', { onHandQty: 2, issuedQty: 1, scrappedQty: 0 });
  // …and a RAM item written its own way, retired since.
  await plantItem(RAM, HQ, 'ram 8gb', { onHandQty: 0, issuedQty: 0, scrappedQty: 0 }, false);
  // Assiut's keyboards are Assiut's stock.
  await plantItem(ASSIUT_KEYBOARD, ASSIUT, 'Keyboard', {
    onHandQty: 4,
    issuedQty: 0,
    scrappedQty: 0,
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

/** Nothing written: the planted items as they were, no movement, no run row, no code taken. */
const expectNothingWritten = async (): Promise<void> => {
  expect(await ItConsumableModel.countDocuments({}).exec()).toBe(3);
  expect(await ItConsumableMovementModel.countDocuments({}).exec()).toBe(0);
  expect(await itemIn(HQ, 'Mouse')).toMatchObject({ onHandQty: 2 });
  expect(await currentSequenceValue(CONSUMABLE_SEQUENCE_KEY)).toBe(3);
  expect(await ItGoLiveRunModel.countDocuments({ key: IT_CONSUMABLES_OPENING_MARK }).exec()).toBe(
    0,
  );
};

describe('entering the consumables opening stock', () => {
  it('refuses — writing nothing — while the branch the file names is not in the organisation', async () => {
    const outcome = await importItConsumablesOpening(FILE, AT);

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.reason : '').toContain('المهندسين: missing');
    await expectNothingWritten();

    await plantBranch(HQ, 'HQ', 'المهندسين');
  });

  it('refuses — writing nothing — until the types it files under are seeded', async () => {
    const outcome = await importItConsumablesOpening(FILE, AT);

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'the consumable types have not been seeded yet',
    });
    await expectNothingWritten();

    expect((await seedItConsumableTypes()).status).toBe('done');
  });

  it('refuses — writing nothing — while a type it needs is retired', async () => {
    await ItCatalogItemModel.updateOne(
      { kind: 'consumableType', code: 'mice' },
      { $set: { isActive: false } },
    ).exec();

    const outcome = await importItConsumablesOpening(FILE, AT);

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'consumable types not usable: mice: inactive',
    });
    await expectNothingWritten();

    await ItCatalogItemModel.updateOne(
      { kind: 'consumableType', code: 'mice' },
      { $set: { isActive: true } },
    ).exec();
  });

  it('adds every item with one delivery of its count, receiving into what the store keeps', async () => {
    const outcome = await importItConsumablesOpening(FILE, AT);

    expect(outcome).toEqual({
      status: 'done',
      branch: 'المهندسين',
      items: 5,
      created: 3,
      reused: [
        { key: 'جرد الأجهزة — Ram 8giga', code: 'CON-00002', name: 'ram 8gb', retired: true },
        { key: 'جرد الأجهزة — Mouse', code: 'CON-00001', name: 'Mouse', retired: false },
      ],
      units: 55,
      firstCode: 'CON-00004',
      lastCode: 'CON-00006',
      byType: { storage: 1, memory: 1, keyboards: 1, mice: 1, cables: 1 },
    });

    // New items: the next codes, one block in the file's order, under their types, in the store.
    const ssd = await itemIn(HQ, 'SSD');
    expect(ssd).toMatchObject({
      code: 'CON-00004',
      unit: 'قطعة',
      minQty: null,
      notes: null,
      active: true,
      onHandQty: 3,
      issuedQty: 0,
      scrappedQty: 0,
    });
    expect(String(ssd?.typeId)).toBe(await typeId('storage'));
    const keyboard = await itemIn(HQ, 'Keyboard');
    expect(keyboard).toMatchObject({ code: 'CON-00005', onHandQty: 23 });
    expect(String(keyboard?.typeId)).toBe(await typeId('keyboards'));
    expect(await itemIn(HQ, 'HDMI Cable 3 m')).toMatchObject({ code: 'CON-00006', onHandQty: 11 });
    expect(await currentSequenceValue(CONSUMABLE_SEQUENCE_KEY)).toBe(6);

    // The store's own mouse took the count — no second «Mouse» — and kept what it had issued.
    expect(await ItConsumableModel.countDocuments({ branchId: HQ, name: 'Mouse' }).exec()).toBe(1);
    expect(await itemIn(HQ, 'Mouse')).toMatchObject({
      onHandQty: 15,
      issuedQty: 1,
      scrappedQty: 0,
    });
    // The retired RAM item, written its own way, took its count and stays as the IT team left it.
    expect(await ItConsumableModel.findById(RAM).lean().exec()).toMatchObject({
      name: 'ram 8gb',
      active: false,
      onHandQty: 5,
    });
    expect(await itemIn(HQ, 'RAM 8 GB')).toBeNull();
    // Assiut's keyboards are untouched: another store, another stock.
    expect(await ItConsumableModel.findById(ASSIUT_KEYBOARD).lean().exec()).toMatchObject({
      onHandQty: 4,
    });

    // ONE delivery per item, its count, noted with the file's source — nobody's hand.
    const movements = await ItConsumableMovementModel.find({}).sort({ _id: 1 }).lean().exec();
    expect(movements).toHaveLength(5);
    for (const movement of movements) {
      expect(movement).toMatchObject({
        kind: 'received',
        at: AT,
        byUserId: null,
        employeeId: null,
        assetId: null,
        reason: null,
        memoId: null,
        notes: SOURCE,
      });
      expect(String(movement.branchId)).toBe(String(HQ));
    }
    const qtyOf = (id: Types.ObjectId | undefined): number[] =>
      movements.filter((m) => String(m.consumableId) === String(id)).map((m) => m.qty);
    expect(qtyOf(ssd?._id)).toEqual([3]);
    expect(qtyOf(MOUSE)).toEqual([13]);
    expect(qtyOf(RAM)).toEqual([5]);

    const run = await ItGoLiveRunModel.findOne({ key: IT_CONSUMABLES_OPENING_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ items: 5, created: 3, units: 55 });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItConsumablesOpening(FILE, AT)).status).toBe('alreadyDone');
    expect(await ItConsumableModel.countDocuments({}).exec()).toBe(6);
    expect(await ItConsumableMovementModel.countDocuments({}).exec()).toBe(5);
    expect(await itemIn(HQ, 'Mouse')).toMatchObject({ onHandQty: 15 });
  });
});
