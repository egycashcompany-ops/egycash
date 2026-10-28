// The devices' specifications added, against a real mongo — «وهبعتلك ملف تانى أسمه (جرد الأجهزة)
// هنشوف فيه الـ سيريال بتاع الجهاز وتاخد بيانات الرام والبروسيسور والهارد وتزودها على السيستم».
//
// What a source-reading test cannot see: the rows of the table a device had no value for filled,
// the table made for a device that had none, a value the IT team typed kept — and reported where
// the sheet disagrees — every other row left as it was, a device found under the register's
// spelling of a serial the sheet mistyped and without case, a serial the register does not hold
// reported and nothing registered for it, every write moving the device's version and leaving a
// line in its history, the step waiting for the inventory, and the whole thing done once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { ItAssetEventModel } from '../../src/modules/it/assets/asset-event.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import { IT_INVENTORY_MARK } from '../../src/modules/it/go-live/inventory';
import {
  IT_ASSET_SPECS_MARK,
  importItAssetSpecs,
  specsHistoryNote,
} from '../../src/modules/it/go-live/asset-specs';
import { type AssetSpecsRow } from '../../src/modules/it/go-live/asset-specs-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-10-28T09:00:00.000Z');
const HQ = new Types.ObjectId();
const DESKTOP_CATEGORY = new Types.ObjectId();
const EDITOR = new Types.ObjectId();

const BARE = new Types.ObjectId();
const TYPED = new Types.ObjectId();
const MISTYPED = new Types.ObjectId();
const LOWER_CASE = new Types.ObjectId();
const COMPLETE = new Types.ObjectId();

const plantAsset = async (
  _id: Types.ObjectId,
  assetCode: string,
  serialNumber: string,
  over: Record<string, unknown>,
): Promise<void> => {
  await ItAssetModel.collection.insertOne({
    _id,
    assetCode,
    name: 'Dell OptiPlex 7070',
    description: null,
    categoryId: DESKTOP_CATEGORY,
    status: 'inStock',
    serialNumber,
    model: 'OptiPlex 7070',
    manufacturer: 'Dell',
    externalTag: null,
    branchId: HQ,
    location: null,
    purchase: null,
    warranty: null,
    currentAssignmentId: null,
    disposal: null,
    notes: null,
    specs: null,
    accessories: [],
    isDeleted: false,
    deletedAt: null,
    updatedBy: EDITOR,
    __v: 0,
    ...over,
  });
};

const row = (key: string, serial: string, over: Partial<AssetSpecsRow> = {}): AssetSpecsRow => ({
  key,
  serial,
  registerSerial: null,
  processor: 'Intel Core i7',
  memory: '8 GB',
  storage: 'SSD',
  ...over,
});

const ROWS: AssetSpecsRow[] = [
  row('جرد الأجهزة صف 3', 'B6K1QD3', { storage: 'HDD' }),
  row('جرد الأجهزة صف 5', 'DQ8L933'),
  // The sheet's «JSJSZXMS3» is the register's «JSZXMS3» — matched with the owner.
  row('جرد الأجهزة صف 2', 'JSJSZXMS3', { registerSerial: 'JSZXMS3' }),
  row('جرد الأجهزة صف 4', '4S58033', { storage: 'HDD' }),
  row('جرد الأجهزة صف 10', 'DB6CN33', { memory: '16 GB' }),
  // Only a deleted device has it — gone from the register.
  row('جرد الأجهزة صف 6', '7F65YQ3'),
  row('جرد الأجهزة صف 99', 'NOPE123'),
];

/** The specifications the IT team typed on DQ8L933 before the sheet arrived. */
const TYPED_SPECS = {
  processor: 'Intel Core i5',
  memory: null,
  systemType: '64-bit',
  storage: 'ssd',
  mediaDrive: null,
  displayAdapter: 'Intel UHD Graphics',
  graphicsMemory: null,
  networkAdapters: ['Intel Ethernet I219-LM'],
};

const EMPTY = {
  systemType: null,
  mediaDrive: null,
  displayAdapter: null,
  graphicsMemory: null,
  networkAdapters: [],
};

const asset = (_id: Types.ObjectId) => ItAssetModel.findById(_id).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantAsset(BARE, 'AST-00010', 'B6K1QD3', {});
  // Edited three times already: its version is not the first.
  await plantAsset(TYPED, 'AST-00011', 'DQ8L933', { specs: TYPED_SPECS, __v: 3 });
  // Registered before the register had specifications at all — no `specs` on the row.
  await plantAsset(MISTYPED, 'AST-00012', 'JSZXMS3', {});
  await ItAssetModel.collection.updateOne({ _id: MISTYPED }, { $unset: { specs: '' } });
  await plantAsset(LOWER_CASE, 'AST-00013', '4s58033', {});
  await plantAsset(COMPLETE, 'AST-00014', 'DB6CN33', {
    specs: { ...EMPTY, processor: 'Intel Core i7', memory: '16GB', storage: 'SSD' },
  });
  await plantAsset(new Types.ObjectId(), 'AST-00015', '7F65YQ3', {
    isDeleted: true,
    deletedAt: new Date('2026-10-20T09:00:00.000Z'),
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('adding the devices’ specifications', () => {
  it('waits — writing nothing — until the inventory is in', async () => {
    const outcome = await importItAssetSpecs(ROWS, AT);

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.reason : '').toContain('inventory');
    expect(await asset(BARE)).toMatchObject({ specs: null, __v: 0 });
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(0);
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_ASSET_SPECS_MARK }).exec()).toBe(0);

    await ItGoLiveRunModel.create({ key: IT_INVENTORY_MARK, finishedAt: AT, outcome: {} });
  });

  it('adds what each device lacks, keeps what was typed, and reports the rest', async () => {
    const outcome = await importItAssetSpecs(ROWS, AT);

    expect(outcome).toEqual({
      status: 'done',
      rows: 7,
      assets: 4,
      filled: { processor: 3, memory: 4, storage: 3 },
      corrected: [
        {
          key: 'جرد الأجهزة صف 2',
          serial: 'JSJSZXMS3',
          registerSerial: 'JSZXMS3',
          assetCode: 'AST-00012',
        },
      ],
      complete: [{ key: 'جرد الأجهزة صف 10', assetCode: 'AST-00014' }],
      kept: [
        {
          key: 'جرد الأجهزة صف 5',
          assetCode: 'AST-00011',
          field: 'processor',
          kept: 'Intel Core i5',
          sheet: 'Intel Core i7',
        },
      ],
      notFound: [
        { key: 'جرد الأجهزة صف 6', serial: '7F65YQ3' },
        { key: 'جرد الأجهزة صف 99', serial: 'NOPE123' },
      ],
      ambiguous: [],
    });

    // No specifications at all: the table is made, the sheet's three in it. The version moves, and
    // the edit is nobody's hand.
    expect(await asset(BARE)).toMatchObject({
      specs: { ...EMPTY, processor: 'Intel Core i7', memory: '8 GB', storage: 'HDD' },
      __v: 1,
      updatedBy: null,
    });

    // Typed by the IT team: kept («ssd» is the sheet's «SSD», so not even reported); the one row
    // it lacked is added; every other row exactly as it was.
    expect(await asset(TYPED)).toMatchObject({
      specs: { ...TYPED_SPECS, memory: '8 GB' },
      __v: 4,
    });

    // Under the register's spelling, and without case.
    expect(await asset(MISTYPED)).toMatchObject({
      specs: { ...EMPTY, processor: 'Intel Core i7', memory: '8 GB', storage: 'SSD' },
      __v: 1,
    });
    expect((await asset(LOWER_CASE))?.specs).toMatchObject({ storage: 'HDD' });

    // Nothing lacking, nothing written — not even its version.
    const complete = await asset(COMPLETE);
    expect(complete?.__v).toBe(0);
    expect(String(complete?.updatedBy)).toBe(String(EDITOR));
    expect(await ItAssetEventModel.countDocuments({ subjectId: COMPLETE }).exec()).toBe(0);

    // Each device written says so in its history, naming the rows filled.
    const [typedHistory] = await ItAssetEventModel.find({ subjectId: TYPED }).lean().exec();
    expect(typedHistory).toMatchObject({
      type: 'updated',
      at: AT,
      actorUserId: null,
      actorName: '',
      metadata: { fields: ['specs.memory'] },
      notes: specsHistoryNote(['memory']),
    });
    expect(await ItAssetEventModel.countDocuments({ type: 'updated' }).exec()).toBe(4);

    // A serial the register does not hold is reported, never registered.
    expect(await ItAssetModel.countDocuments({ serialNumber: 'NOPE123' }).exec()).toBe(0);
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(6);
    const run = await ItGoLiveRunModel.findOne({ key: IT_ASSET_SPECS_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ rows: 7, assets: 4 });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItAssetSpecs(ROWS, AT)).status).toBe('alreadyDone');
    expect(await asset(BARE)).toMatchObject({ __v: 1 });
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(4);
  });
});
