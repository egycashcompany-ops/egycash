// The October all-in-ones registered, against a real mongo — «هبعتلك سيريلات أجهزة عايز أرفعها
// بنفس مواصفات Lenovo ThinkCentre neo 50a 24 جهاز كمبيوتر AIO بس هيكون فى فرع أكتوبر ومش متسلم لحد».
//
// What a source-reading test cannot see: every serial a new asset in the October branch — the
// branch found through its spelling — in stock with nobody holding it; each a copy of the device
// the register holds by EXACTLY that name, the one with specifications, and of nothing that belongs
// to that one machine; without such a device, the file's maker and model filed where the inventory
// files an all-in-one, or a refusal when there is nowhere to file it; a serial the register already
// holds left alone; the import waiting for the inventory; and the whole thing done once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { ItAssetAssignmentModel } from '../../src/modules/it/assets/assignment.model';
import { ItAssetEventModel } from '../../src/modules/it/assets/asset-event.model';
import { ItCustodyReceiptModel } from '../../src/modules/it/assets/receipt.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import { IT_INVENTORY_MARK } from '../../src/modules/it/go-live/inventory';
import {
  AIO_OCTOBER_NOTE,
  IT_AIO_OCTOBER_MARK,
  importItAioOctober,
} from '../../src/modules/it/go-live/aio-october';
import { type AioOctoberFile } from '../../src/modules/it/go-live/aio-october-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-10-28T09:00:00.000Z');
const HQ = new Types.ObjectId();
const OCTOBER = new Types.ObjectId();
const AIO_CATEGORY = new Types.ObjectId();
const DESKTOP_CATEGORY = new Types.ObjectId();
const TEMPLATE = new Types.ObjectId();

const NAME = 'Lenovo ThinkCentre neo 50a 24';
const SPECS = {
  processor: 'Intel Core i5-13420H',
  memory: '8 GB',
  systemType: '64-bit',
  storage: '512 GB SSD',
  mediaDrive: null,
  displayAdapter: 'Intel UHD Graphics',
  graphicsMemory: null,
  networkAdapters: ['Realtek PCIe GbE'],
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

const plantCategory = async (_id: Types.ObjectId, ar: string): Promise<void> => {
  await ItCatalogItemModel.collection.insertOne({
    _id,
    kind: 'assetCategory',
    code: null,
    name: { ar, en: ar },
    description: null,
    sortOrder: 0,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const plantAsset = async (
  assetCode: string,
  over: Record<string, unknown>,
  _id: Types.ObjectId = new Types.ObjectId(),
): Promise<void> => {
  await ItAssetModel.collection.insertOne({
    _id,
    assetCode,
    name: NAME,
    description: null,
    categoryId: AIO_CATEGORY,
    status: 'inStock',
    serialNumber: null,
    model: 'ThinkCentre neo 50a 24',
    manufacturer: 'Lenovo',
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
    createdAt: new Date('2026-10-07T09:00:00.000Z'),
    updatedAt: new Date('2026-10-07T09:00:00.000Z'),
    __v: 0,
    ...over,
  });
};

const FILE: Pick<AioOctoberFile, 'branch' | 'template' | 'devices'> = {
  branch: 'أكتوبر',
  template: {
    name: NAME,
    manufacturer: 'Lenovo',
    model: 'ThinkCentre neo 50a 24',
    category: 'allInOne',
  },
  devices: [
    { key: 'SN ايجي كاش صف 1', serial: 'MP30EPF4' },
    // Registered by the IT team since the sheet was sent — the register spells it in lower case.
    { key: 'SN ايجي كاش صف 2', serial: 'MP30EPF3' },
    { key: 'SN ايجي كاش صف 3', serial: 'MP30EPF2' },
    // Scanned in by the IT team since — the register spells it as the barcode does, with its «S».
    { key: 'SN ايجي كاش صف 5', serial: 'MP30EPE9' },
  ],
};

const assetBySerial = (serialNumber: string) =>
  ItAssetModel.findOne({ serialNumber, isDeleted: false }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantBranch(HQ, 'HQ', 'المهندسين');
  // The organisation spells it with the number; the file without.
  await plantBranch(OCTOBER, 'OCT', '6 أكتوبر');
  await plantCategory(AIO_CATEGORY, 'كمبيوتر All');
  await plantCategory(DESKTOP_CATEGORY, 'كمبيوتر مكتبي');
  // The device the owner named, with its specifications filled in — handed over at the head
  // office, bought, under warranty, somewhere and with notes of its own.
  await plantAsset(
    'AST-00116',
    {
      serialNumber: 'MP30EPDA',
      status: 'assigned',
      currentAssignmentId: new Types.ObjectId(),
      description: 'جهاز الاستقبال',
      externalTag: 'TAG-116',
      location: 'الدور الثالث',
      purchase: { date: new Date('2026-09-01'), cost: 25000, vendorId: null, invoiceRef: 'INV-77' },
      warranty: {
        vendorId: null,
        start: new Date('2026-09-01'),
        end: new Date('2027-09-01'),
        terms: null,
      },
      notes: 'ملاحظة على الجهاز نفسه لا تُنسخ',
      specs: SPECS,
      accessories: ['Keyboard', 'Mouse'],
      updatedAt: new Date('2026-10-10T09:00:00.000Z'),
    },
    TEMPLATE,
  );
  // Its twin, edited later but with no specifications — not the one the owner means.
  await plantAsset('AST-00117', {
    serialNumber: 'MP30EPD2',
    accessories: ['Keyboard'],
    updatedAt: new Date('2026-10-20T09:00:00.000Z'),
  });
  // A neighbouring model, edited last of all — not the name the owner gave.
  await plantAsset('AST-00118', {
    name: 'Lenovo ThinkCentre neo 50a 27',
    serialNumber: 'NB000001',
    categoryId: DESKTOP_CATEGORY,
    specs: { ...SPECS, processor: 'Intel Core i7-13620H' },
    updatedAt: new Date('2026-10-25T09:00:00.000Z'),
  });
  // One deleted, with specifications — gone from the register, so never copied.
  await plantAsset('AST-00119', {
    serialNumber: 'DELETED1',
    isDeleted: true,
    deletedAt: new Date('2026-10-26T09:00:00.000Z'),
    specs: { ...SPECS, processor: 'Intel Core i9' },
    updatedAt: new Date('2026-10-26T09:00:00.000Z'),
  });
  // One of the batch, registered by hand since the sheet was sent.
  await plantAsset('AST-00900', {
    name: 'كمبيوتر AIO',
    serialNumber: 'mp30epf3',
    branchId: OCTOBER,
  });
  // Another, scanned in from its barcode, which prints an «S» before the serial.
  await plantAsset('AST-00901', {
    name: 'كمبيوتر AIO',
    serialNumber: 'SMP30EPE9',
    branchId: OCTOBER,
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('registering the October all-in-ones', () => {
  it('waits — writing nothing — until the inventory is in', async () => {
    const outcome = await importItAioOctober(FILE);

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.reason : '').toContain('inventory');
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(6);
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(0);
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_AIO_OCTOBER_MARK }).exec()).toBe(0);

    await ItGoLiveRunModel.create({ key: IT_INVENTORY_MARK, finishedAt: AT, outcome: {} });
  });

  it('registers every serial in the October branch, in stock, as a copy of the device named', async () => {
    const outcome = await importItAioOctober(FILE);

    expect(outcome).toMatchObject({
      status: 'done',
      assets: 2,
      firstCode: 'AST-00001',
      lastCode: 'AST-00002',
      branch: '6 أكتوبر',
      template: { assetCode: 'AST-00116' },
      category: { id: String(AIO_CATEGORY), name: 'كمبيوتر All' },
      skippedSerials: [
        { key: 'SN ايجي كاش صف 2', serial: 'MP30EPF3', existing: 'AST-00900' },
        { key: 'SN ايجي كاش صف 5', serial: 'MP30EPE9', existing: 'AST-00901' },
      ],
    });

    // «بنفس مواصفات»: the category, maker, model, specifications and accessories of AST-00116 —
    // and none of what is that one machine's own.
    const copy = await assetBySerial('MP30EPF4');
    expect(copy).toMatchObject({
      assetCode: 'AST-00001',
      name: NAME,
      manufacturer: 'Lenovo',
      model: 'ThinkCentre neo 50a 24',
      specs: SPECS,
      accessories: ['Keyboard', 'Mouse'],
      description: null,
      externalTag: null,
      location: null,
      purchase: null,
      warranty: null,
      notes: AIO_OCTOBER_NOTE,
    });
    expect(String(copy?.categoryId)).toBe(String(AIO_CATEGORY));
    expect(String(copy?.branchId)).toBe(String(OCTOBER));
    expect((await assetBySerial('MP30EPF2'))?.assetCode).toBe('AST-00002');

    // «ومش متسلم لحد»: in stock, nobody holds them, no paper.
    expect(copy).toMatchObject({ status: 'inStock', currentAssignmentId: null });
    expect(await ItAssetAssignmentModel.countDocuments({}).exec()).toBe(0);
    expect(await ItCustodyReceiptModel.countDocuments({}).exec()).toBe(0);

    // No history entry, like any registration — so one registered in error can still be deleted
    // (FR-5); the asset itself says where it came from.
    expect(copy).toMatchObject({ assetCode: 'AST-00001', notes: AIO_OCTOBER_NOTE });
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(0);

    // The device copied and the device already registered are left as they were.
    expect(await ItAssetModel.findById(TEMPLATE).lean().exec()).toMatchObject({
      __v: 0,
      serialNumber: 'MP30EPDA',
      status: 'assigned',
    });
    expect(
      await ItAssetModel.countDocuments({ serialNumber: { $in: ['MP30EPF3', 'mp30epf3'] } }).exec(),
    ).toBe(1);
    expect(
      await ItAssetModel.countDocuments({
        serialNumber: { $in: ['MP30EPE9', 'SMP30EPE9'] },
      }).exec(),
    ).toBe(1);
    const run = await ItGoLiveRunModel.findOne({ key: IT_AIO_OCTOBER_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ assets: 2, template: { assetCode: 'AST-00116' } });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItAioOctober(FILE)).status).toBe('alreadyDone');
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(8);
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(0);
  });
});

describe('when the register holds no device by that name', () => {
  const LATER: Pick<AioOctoberFile, 'branch' | 'template' | 'devices'> = {
    ...FILE,
    devices: [{ key: 'SN ايجي كاش صف 4', serial: 'MP30EPF1' }],
  };
  const categories = { _id: { $in: [AIO_CATEGORY, DESKTOP_CATEGORY] } };

  beforeAll(async () => {
    // A database the import has not run on, whose register has no device of that name.
    await ItGoLiveRunModel.deleteOne({ key: IT_AIO_OCTOBER_MARK }).exec();
    await ItAssetModel.updateMany({ name: NAME }, { $set: { isDeleted: true } }).exec();
  });

  it('refuses — writing nothing — while there is no category to file it under', async () => {
    await ItCatalogItemModel.updateMany(categories, { $set: { isDeleted: true } }).exec();

    const outcome = await importItAioOctober(LATER);

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.reason : '').toContain('no asset category');
    expect(await assetBySerial('MP30EPF1')).toBeNull();
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_AIO_OCTOBER_MARK }).exec()).toBe(0);

    await ItCatalogItemModel.updateMany(categories, { $set: { isDeleted: false } }).exec();
  });

  it('copies the file’s maker and model, filed where the inventory files an all-in-one', async () => {
    const outcome = await importItAioOctober(LATER);

    // The refusal took no code: the next is the one after the first run's.
    expect(outcome).toMatchObject({
      status: 'done',
      assets: 1,
      firstCode: 'AST-00003',
      template: null,
      category: { id: String(AIO_CATEGORY), name: 'كمبيوتر All' },
      skippedSerials: [],
    });
    const asset = await assetBySerial('MP30EPF1');
    expect(asset).toMatchObject({
      name: NAME,
      manufacturer: 'Lenovo',
      model: 'ThinkCentre neo 50a 24',
      specs: null,
      accessories: [],
      status: 'inStock',
      notes: AIO_OCTOBER_NOTE,
    });
    expect(String(asset?.categoryId)).toBe(String(AIO_CATEGORY));
    expect(String(asset?.branchId)).toBe(String(OCTOBER));
  });
});
