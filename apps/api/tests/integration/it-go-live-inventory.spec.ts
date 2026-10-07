// The IT inventory imported, against a real mongo — «… وتسلمه الأجهزة اللى معاه … ولو مكتوب مخزن
// يبقي مش متسلم … الأفرع كل الأجهزة والأصول اللى فيها خليها مش متسلمه».
//
// What a source-reading test cannot see: every device registered under its kind in its branch —
// the branch found through its spelling, the IT team's own category taken where there is one — the
// settled head-office devices handed over on ONE receipt per employee, a holder who has left given
// nothing, a serial the register already holds left alone, the import waiting for the asset
// restart, and the whole thing done once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { ItAssetAssignmentModel } from '../../src/modules/it/assets/assignment.model';
import { ItAssetEventModel } from '../../src/modules/it/assets/asset-event.model';
import { ItCustodyReceiptModel } from '../../src/modules/it/assets/receipt.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import { IT_ASSET_RESTART_MARK } from '../../src/modules/it/go-live/asset-restart';
import {
  INVENTORY_NOTE,
  IT_INVENTORY_MARK,
  importItInventory,
} from '../../src/modules/it/go-live/inventory';
import { type InventoryDevice } from '../../src/modules/it/go-live/inventory-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-10-07T09:00:00.000Z');
const HQ = new Types.ObjectId();
const ASSIUT = new Types.ObjectId();
const DEPARTMENT = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();
const AIO_CATEGORY = new Types.ObjectId();
const SCREEN_CATEGORY = new Types.ObjectId();

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

const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  status: 'active' | 'exited',
): Promise<void> => {
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status,
    personal: { fullNameAr, nationalId: '28001010101010' },
    employment: {
      jobTitleId: new Types.ObjectId(),
      departmentId: DEPARTMENT,
      sectionId: null,
      branchId: HQ,
    },
    branchId: HQ,
    departmentId: DEPARTMENT,
    sectionId: null,
    userId: null,
    exit: null,
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

const device = (key: string, over: Partial<InventoryDevice>): InventoryDevice => ({
  key,
  category: 'desktop',
  name: 'Dell OptiPlex 7070',
  manufacturer: 'Dell',
  model: 'OptiPlex 7070',
  serial: null,
  branch: 'المهندسين',
  holderCode: null,
  holder: null,
  location: null,
  accessories: [],
  storage: null,
  notes: null,
  ...over,
});

const settled = { holderCode: '0100006', holder: 'محمد عادل' };
const DEVICES: InventoryDevice[] = [
  device('HQ PC#3', {
    ...settled,
    serial: 'PC0001',
    accessories: ['Keyboard', 'Mouse'],
    storage: 'SSD',
  }),
  device('HQ PC#4', {
    ...settled,
    category: 'screen',
    name: 'Dell E2218HN',
    model: 'E2218HN',
    serial: 'SC0001',
  }),
  device('HQ PC#116', {
    ...settled,
    category: 'allInOne',
    name: 'Lenovo ThinkCentre neo 50a 24',
    manufacturer: 'Lenovo',
    model: 'ThinkCentre neo 50a 24',
    serial: 'AIO001',
  }),
  // Settled by the review, but HR says they have left since.
  device('LapTop#16', {
    category: 'laptop',
    name: 'Dell Latitude 5520',
    model: 'Latitude 5520',
    serial: 'LT0001',
    holderCode: '0100001',
    holder: 'محمود ونيس',
  }),
  // Registered by the IT team since the sheet was made.
  device('IP Phone#9', {
    ...settled,
    category: 'ipPhone',
    name: 'Cisco IP Phone 8841',
    manufacturer: 'Cisco',
    model: 'IP Phone 8841',
    serial: 'TAKEN01',
  }),
  device('Assiut#30', {
    category: 'printer',
    name: 'HP LaserJet Pro MFP M428fdn',
    manufacturer: 'HP',
    model: 'LaserJet Pro MFP M428fdn',
    serial: 'PR0001',
    branch: 'أسيوط',
    holder: 'عقيد/أسامة محمد علي',
    notes: 'في الجرد مع: عقيد/أسامة محمد علي',
  }),
  device('HQ PC#140', {
    category: 'screen',
    name: 'Dell E2020H',
    model: 'E2020H',
    holder: 'مخزن IT',
    location: 'مخزن IT',
    notes: 'لا يعمل',
  }),
];

const assetBySerial = (serialNumber: string) =>
  ItAssetModel.findOne({ serialNumber, isDeleted: false }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantBranch(HQ, 'HQ', 'المهندسين');
  // The organisation spells it without the hamza; the sheet with it.
  await plantBranch(ASSIUT, 'AST', 'اسيوط');
  await plantEmployee(EMPLOYEE, '0100006', 'محمد عادل محمد عبد الفتاح', 'active');
  await plantEmployee(LEAVER, '0100001', 'محمود ونيس غنيمي عبادة', 'exited');
  await plantCategory(AIO_CATEGORY, 'كمبيوتر All');
  await plantCategory(SCREEN_CATEGORY, 'شاشه');
  await ItAssetModel.collection.insertOne({
    _id: new Types.ObjectId(),
    assetCode: 'AST-00900',
    name: 'Cisco IP Phone 8841',
    categoryId: SCREEN_CATEGORY,
    status: 'inStock',
    serialNumber: 'TAKEN01',
    branchId: HQ,
    currentAssignmentId: null,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('importing the IT inventory', () => {
  it('waits — writing nothing — until the asset restart has decided', async () => {
    const outcome = await importItInventory(DEVICES, AT);

    expect(outcome.status).toBe('refused');
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(1);
    expect(await ItCatalogItemModel.countDocuments({}).exec()).toBe(2);
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_INVENTORY_MARK }).exec()).toBe(0);

    await ItGoLiveRunModel.create({
      key: IT_ASSET_RESTART_MARK,
      finishedAt: AT,
      outcome: { refused: true },
    });
  });

  it('registers every device and hands the settled ones over on one receipt', async () => {
    const outcome = await importItInventory(DEVICES, AT);

    expect(outcome).toMatchObject({
      status: 'done',
      assets: 6,
      assigned: 3,
      inStock: 3,
      receipts: 1,
      firstCode: 'AST-00001',
      lastCode: 'AST-00006',
      firstReceipt: 1,
      lastReceipt: 1,
      byBranch: { المهندسين: 5, أسيوط: 1 },
      skippedSerials: [{ key: 'IP Phone#9', serial: 'TAKEN01', existing: 'AST-00900' }],
      held: [{ key: 'LapTop#16', holderCode: '0100001', reason: 'leftCompany' }],
    });

    // Handed over: the asset, its open interval and its history all say so.
    const pc = await assetBySerial('PC0001');
    expect(pc).toMatchObject({ assetCode: 'AST-00001', status: 'assigned', manufacturer: 'Dell' });
    expect(String(pc?.branchId)).toBe(String(HQ));
    expect(pc?.specs?.storage).toBe('SSD');
    expect(pc?.accessories).toEqual(['Keyboard', 'Mouse']);
    const intervals = await ItAssetAssignmentModel.find({ assignedToEmployeeId: EMPLOYEE })
      .lean()
      .exec();
    expect(intervals).toHaveLength(3);
    expect(intervals.every((i) => i.returnedAt === null && i.notes === INVENTORY_NOTE)).toBe(true);
    expect(new Set(intervals.map((i) => String(i.receiptId))).size).toBe(1);
    expect(String(pc?.currentAssignmentId)).toBe(
      String(intervals.find((i) => String(i.assetId) === String(pc?._id))?._id),
    );
    expect(await ItAssetEventModel.countDocuments({ type: 'assigned' }).exec()).toBe(3);

    // The IT team's own categories where they have one; a new one where not.
    expect(String((await assetBySerial('AIO001'))?.categoryId)).toBe(String(AIO_CATEGORY));
    expect(String((await assetBySerial('SC0001'))?.categoryId)).toBe(String(SCREEN_CATEGORY));
    const desktop = await ItCatalogItemModel.findOne({ 'name.ar': 'كمبيوتر مكتبي' }).lean().exec();
    expect(String(pc?.categoryId)).toBe(String(desktop?._id));

    // ONE receipt for the employee: every device a page of it, the HR snapshot on it.
    const [receipt] = await ItCustodyReceiptModel.find({}).lean().exec();
    expect(receipt).toMatchObject({
      formNumber: 1,
      employeeCode: '0100006',
      employeeName: 'محمد عادل محمد عبد الفتاح',
      issuedByUserId: null,
    });
    expect(String(receipt?.employeeId)).toBe(String(EMPLOYEE));
    expect(receipt?.lines.map((line) => [line.assetCode, line.deviceType])).toEqual([
      ['AST-00001', 'كمبيوتر مكتبي'],
      ['AST-00002', 'شاشه'],
      ['AST-00003', 'كمبيوتر All'],
    ]);

    // In stock: the holder who left, the branch device in its branch, the IT store.
    const laptop = await assetBySerial('LT0001');
    expect(laptop).toMatchObject({ status: 'inStock', currentAssignmentId: null });
    expect(laptop?.notes).toContain('في الجرد مع: محمود ونيس');
    const printer = await assetBySerial('PR0001');
    expect(printer?.status).toBe('inStock');
    expect(String(printer?.branchId)).toBe(String(ASSIUT));
    const store = await ItAssetModel.findOne({ location: 'مخزن IT' }).lean().exec();
    expect(store).toMatchObject({ status: 'inStock', serialNumber: null, notes: 'لا يعمل' });

    // The device already on the register is left as it was.
    expect(await ItAssetModel.countDocuments({ serialNumber: 'TAKEN01' }).exec()).toBe(1);
    const run = await ItGoLiveRunModel.findOne({ key: IT_INVENTORY_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ assets: 6, receipts: 1 });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItInventory(DEVICES, AT)).status).toBe('alreadyDone');
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(7);
    expect(await ItCustodyReceiptModel.countDocuments({}).exec()).toBe(1);
  });
});
