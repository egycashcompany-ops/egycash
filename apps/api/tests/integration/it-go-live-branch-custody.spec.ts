// The branches' custody added, against a real mongo — «هبعتلك عهده الأفرع وعايزك تضيفهم مره واحده
// كل فرع فى فرعه فى الـ IT».
//
// What a source-reading test cannot see: a line the register does not hold registered in its
// branch's stock — its tag the serial, its other label printed, its notes naming the sheet, and no
// history entry; «أكمّل الناقص بس» — only what a device lacks filled, a typed value kept and
// reported, an `updated` entry naming what was filled, a device with nothing missing left exactly
// as it was; «انقلهم لفرع الملف» — a device in stock elsewhere moved to the sheet's branch with a
// `transferred` entry and its audit row, its place in the branch it left («مخزن IT») cleared and
// said so, while a device somebody holds stays where custody put it, its place with it, and is
// still filled — and, with nothing to fill, is not written at all (its version and its last
// editor untouched, no history); a line the register no longer holds reported and nothing
// registered for it; a line the review left out writing nothing — a disputed serial not moving
// the device in stock elsewhere that holds it; the step waiting for the inventory, the October
// all-in-ones and the specifications; a branch the organisation lacks, or a kind with no category
// of its own (a phone never filed as a desktop), refusing the whole run; and the whole thing done
// once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { ItAssetEventModel } from '../../src/modules/it/assets/asset-event.model';
import { ItCatalogItemModel } from '../../src/modules/it/catalog-items/catalog-item.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import { IT_INVENTORY_MARK } from '../../src/modules/it/go-live/inventory';
import { IT_AIO_OCTOBER_MARK } from '../../src/modules/it/go-live/aio-october';
import { IT_ASSET_SPECS_MARK } from '../../src/modules/it/go-live/asset-specs';
import {
  IT_BRANCH_CUSTODY_MARK,
  importItBranchCustody,
} from '../../src/modules/it/go-live/branch-custody';
import {
  updatedHistoryNote,
  type CustodyFillRow,
  type CustodyMoveRow,
  type CustodyNewRow,
  type CustodyRow,
  type CustodySkipRow,
} from '../../src/modules/it/go-live/branch-custody-import';
import type { InventoryBranch } from '../../src/modules/it/go-live/inventory-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-11-10T09:00:00.000Z');
const HQ = new Types.ObjectId();
const TANTA = new Types.ObjectId();
const SHOROUK = new Types.ObjectId();
const OCTOBER = new Types.ObjectId();
const PORTSAID = new Types.ObjectId();
const DESKTOP_CATEGORY = new Types.ObjectId();
const SCREEN_CATEGORY = new Types.ObjectId();
const PHONE_CATEGORY = new Types.ObjectId();
const EDITOR = new Types.ObjectId();

const BARE = new Types.ObjectId();
const TYPED = new Types.ObjectId();
const SCREEN = new Types.ObjectId();
const ON_THE_MOVE = new Types.ObjectId();
const HELD = new Types.ObjectId();
const COMPLETE = new Types.ObjectId();
const BY_HAND = new Types.ObjectId();
const LEFT_OUT = new Types.ObjectId();
const DISPUTED = new Types.ObjectId();
const HELD_COMPLETE = new Types.ObjectId();

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
  _id: Types.ObjectId,
  assetCode: string,
  serialNumber: string,
  over: Record<string, unknown>,
): Promise<void> => {
  await ItAssetModel.collection.insertOne({
    _id,
    assetCode,
    name: 'Dell OptiPlex 7000',
    description: null,
    categoryId: DESKTOP_CATEGORY,
    status: 'inStock',
    serialNumber,
    model: 'OptiPlex 7000',
    manufacturer: 'Dell',
    externalTag: null,
    branchId: TANTA,
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

const sheetOf = (branch: InventoryBranch) => ({ sheet: `عهدة فرع ${branch}`, branch });

const fill = (
  branch: InventoryBranch,
  row: number,
  over: Partial<CustodyFillRow>,
): CustodyFillRow => ({
  ...sheetOf(branch),
  row,
  kind: 'كمبيوتر مكتبي',
  serial: null,
  tag: null,
  action: 'fill',
  registerSerial: '',
  specs: {},
  accessories: [],
  ...over,
});

const move = (
  branch: InventoryBranch,
  row: number,
  over: Partial<CustodyMoveRow>,
): CustodyMoveRow => ({
  ...sheetOf(branch),
  row,
  kind: 'كمبيوتر مكتبي',
  serial: null,
  tag: null,
  action: 'move',
  registerSerial: '',
  fromBranch: 'أكتوبر',
  specs: {},
  accessories: [],
  ...over,
});

const fresh = (
  branch: InventoryBranch,
  row: number,
  over: Partial<CustodyNewRow>,
): CustodyNewRow => ({
  ...sheetOf(branch),
  row,
  kind: 'هاتف IP',
  serial: null,
  tag: null,
  action: 'new',
  category: 'ipPhone',
  name: 'Grandstream GXP1615',
  manufacturer: 'Grandstream',
  model: 'GXP1615',
  note: null,
  specs: {},
  accessories: [],
  ...over,
});

const skip = (
  branch: InventoryBranch,
  row: number,
  over: Partial<CustodySkipRow>,
): CustodySkipRow => ({
  ...sheetOf(branch),
  row,
  kind: 'كمبيوتر مكتبي',
  serial: null,
  tag: null,
  action: 'skip',
  reason: 'noSerialOrTag',
  ...over,
});

const SPECS = {
  processor: '12th Gen Intel(R) Core(TM) 7 2.10GHz',
  memory: '(1×8) 8',
  systemType: 'Microsoft Windows 11 pro',
  storage: '1TB HDD',
  displayAdapter: '770 Intel UHD Graphics',
};

/** The specifications the IT team typed on 99GSWV3 before the sheets arrived. */
const TYPED_SPECS = {
  processor: 'Intel Core i5',
  memory: null,
  systemType: null,
  storage: '1TB HDD',
  mediaDrive: null,
  displayAdapter: null,
  graphicsMemory: null,
  networkAdapters: ['Realtek PCIe GbE'],
};

const EMPTY = {
  processor: null,
  memory: null,
  systemType: null,
  storage: null,
  mediaDrive: null,
  displayAdapter: null,
  graphicsMemory: null,
  networkAdapters: [],
};

const PPID = 'CN-0DCYGF-QDC00-312-1EEI-A09';
const NEW_PPID = 'CN-0DCYGF-QDC00-312-1EEI-A10';

const ROWS: CustodyRow[] = [
  // A Dell screen nobody registered: its service tag the serial, its «CN-0…» label printed.
  fresh('بورسعيد', 19, {
    kind: 'شاشة',
    serial: NEW_PPID,
    tag: '2G76GJ5',
    category: 'screen',
    name: 'Dell E2020H',
    manufacturer: 'Dell',
    model: 'E2020H',
  }),
  fresh('بورسعيد', 40, { serial: '271FVCWP20CCCC4D' }),
  // Registered by hand since the review, without its maker.
  fresh('بورسعيد', 41, { serial: '271FVCWP20CCCC63' }),
  fill('طنطا', 2, {
    tag: 'H4QKWV3',
    registerSerial: 'H4QKWV3',
    specs: SPECS,
    accessories: ['Keyboard', 'Mouse'],
  }),
  fill('طنطا', 3, {
    tag: '99GSWV3',
    registerSerial: '99GSWV3',
    specs: { processor: 'Intel Core i7-12700', memory: '(1×8) 8', storage: '1TB HDD' },
    accessories: ['Keyboard', 'Mouse'],
  }),
  // An October all-in-one somebody holds — the sheet puts it in Tanta.
  move('طنطا', 17, {
    tag: 'MP30EPDE',
    registerSerial: 'MP30EPDE',
    specs: { processor: '1x intel core 5 210h', memory: '(1×16)16 G' },
    accessories: ['Keyboard', 'Mouse'],
  }),
  fill('طنطا', 19, { kind: 'شاشة', serial: PPID, tag: '2G76GJ3', registerSerial: '2G76GJ3' }),
  skip('طنطا', 24, { kind: 'شاشة', serial: '3KB75G3', reason: 'repeatedSerial' }),
  fill('طنطا', 35, { kind: 'طابعة', serial: 'CNDRQ5Q3LZ', registerSerial: 'CNDRQ5Q3LZ' }),
  // Only a deleted device had it — gone from the register.
  fill('طنطا', 36, { kind: 'طابعة', serial: 'GONE001', registerSerial: 'GONE001' }),
  fresh('طنطا', 37, {
    serial: '20FQKM8N30C682FE',
    name: 'Fiberme FAP2601',
    manufacturer: 'Fiberme',
    model: 'FAP2601',
    note: 'رقم الهاتف في الملف: 2007',
  }),
  // An October all-in-one in stock — «انقلهم لفرع الملف».
  move('الشروق', 16, {
    serial: 'MP30EPE1',
    registerSerial: 'MP30EPE1',
    specs: { processor: 'Intel(R) Core(TM) 5 210H', memory: '16' },
    accessories: ['Keyboard', 'Mouse'],
  }),
  // An October all-in-one somebody holds, and a line that adds nothing to it.
  move('الشروق', 18, { serial: 'MP30EPEV', registerSerial: 'MP30EPEV' }),
  // The serial the October inventory gave the head office's printer: left out, never moved.
  skip('الشروق', 27, { kind: 'طابعة', serial: 'CNDRP8Z666', reason: 'serialDisputed' }),
  // HP's product number for the build in the tag column — no one device's serial.
  skip('أكتوبر', 6, { tag: 'L8T14AV', reason: 'notASerial' }),
  skip('أكتوبر', 28, {}),
  // Two characters off an October screen the sheet does not list — likely it, misread.
  skip('أكتوبر', 39, { kind: 'شاشة', tag: 'B3SZ8V3', reason: 'nearSerial' }),
];

const asset = (_id: Types.ObjectId) => ItAssetModel.findById(_id).lean().exec();
const assetBySerial = (serialNumber: string) =>
  ItAssetModel.findOne({ serialNumber, isDeleted: false }).lean().exec();
const history = (subjectId: Types.ObjectId) =>
  ItAssetEventModel.find({ subjectId }).sort({ type: 1 }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantBranch(HQ, 'HQ', 'المهندسين');
  await plantBranch(TANTA, 'TNT', 'طنطا');
  // The organisation's names for two of them are not the sheets'.
  await plantBranch(SHOROUK, 'SHR', 'وصال');
  await plantBranch(OCTOBER, 'OCT', '6 أكتوبر');
  await plantCategory(DESKTOP_CATEGORY, 'كمبيوتر مكتبي');
  await plantCategory(SCREEN_CATEGORY, 'شاشة');
  // No «هاتف IP» category yet — the run must refuse, never file the phones as desktops.

  await plantAsset(BARE, 'AST-00010', 'H4QKWV3', {});
  // Edited three times already, with specifications and accessories of its own.
  await plantAsset(TYPED, 'AST-00011', '99GSWV3', {
    specs: TYPED_SPECS,
    accessories: ['Keyboard'],
    __v: 3,
  });
  await plantAsset(SCREEN, 'AST-00012', '2G76GJ3', {
    name: 'Dell E2020H',
    categoryId: SCREEN_CATEGORY,
    model: 'E2020H',
  });
  // In the IT store of the branch it is about to leave.
  await plantAsset(ON_THE_MOVE, 'AST-00013', 'MP30EPE1', {
    name: 'Lenovo ThinkCentre neo 50a 24',
    manufacturer: 'Lenovo',
    model: 'ThinkCentre neo 50a 24',
    branchId: OCTOBER,
    location: 'مخزن IT',
  });
  await plantAsset(HELD, 'AST-00014', 'MP30EPDE', {
    name: 'Lenovo ThinkCentre neo 50a 24',
    branchId: OCTOBER,
    status: 'assigned',
    currentAssignmentId: new Types.ObjectId(),
    location: 'خزينة1',
  });
  await plantAsset(COMPLETE, 'AST-00015', 'CNDRQ5Q3LZ', { name: 'HP LaserJet' });
  await plantAsset(new Types.ObjectId(), 'AST-00016', 'GONE001', {
    isDeleted: true,
    deletedAt: new Date('2026-11-01T09:00:00.000Z'),
  });
  await plantAsset(BY_HAND, 'AST-00017', '271fvcwp20cccc63', {
    name: 'هاتف',
    categoryId: PHONE_CATEGORY,
    manufacturer: null,
    model: 'GXP1615',
    branchId: PORTSAID,
  });
  await plantAsset(LEFT_OUT, 'AST-00018', '3KB75G3', { categoryId: SCREEN_CATEGORY, branchId: HQ });
  // In stock at the head office: the Shorouk line would move it, were it not left out.
  await plantAsset(DISPUTED, 'AST-00019', 'CNDRP8Z666', {
    name: 'HP LaserJet Pro MFP M428fdn',
    manufacturer: 'HP',
    model: 'LaserJet Pro MFP M428fdn',
    branchId: HQ,
  });
  // Somebody holds it in October; its line has no specifications and no accessories.
  await plantAsset(HELD_COMPLETE, 'AST-00020', 'MP30EPEV', {
    name: 'Lenovo ThinkCentre neo 50a 24',
    branchId: OCTOBER,
    status: 'assigned',
    currentAssignmentId: new Types.ObjectId(),
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

/** Nothing the step writes is there. */
const expectNothingWritten = async (): Promise<void> => {
  expect(await ItAssetModel.countDocuments({}).exec()).toBe(11);
  expect(await asset(BARE)).toMatchObject({ specs: null, __v: 0 });
  const unmoved = await asset(ON_THE_MOVE);
  expect(unmoved?.__v).toBe(0);
  expect(unmoved?.location).toBe('مخزن IT');
  expect(String(unmoved?.branchId)).toBe(String(OCTOBER));
  expect(await ItAssetModel.countDocuments({ assetCode: /^AST-0000\d$/u }).exec()).toBe(0);
  expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(0);
  expect(await ItGoLiveRunModel.countDocuments({ key: IT_BRANCH_CUSTODY_MARK }).exec()).toBe(0);
};

describe('adding the branches’ custody', () => {
  it('waits — writing nothing — for the inventory, the October all-in-ones and the specifications', async () => {
    const before = await importItBranchCustody({ devices: ROWS }, AT);
    expect(before.status).toBe('refused');
    for (const mark of [IT_INVENTORY_MARK, IT_AIO_OCTOBER_MARK, IT_ASSET_SPECS_MARK]) {
      expect(before.status === 'refused' ? before.reason : '').toContain(mark);
    }
    await expectNothingWritten();

    // Two of the three are not enough.
    await ItGoLiveRunModel.create({ key: IT_INVENTORY_MARK, finishedAt: AT, outcome: {} });
    await ItGoLiveRunModel.create({ key: IT_AIO_OCTOBER_MARK, finishedAt: AT, outcome: {} });
    const half = await importItBranchCustody({ devices: ROWS }, AT);
    expect(half.status).toBe('refused');
    expect(half.status === 'refused' ? half.reason : '').toContain(IT_ASSET_SPECS_MARK);
    expect(half.status === 'refused' ? half.reason : '').not.toContain(IT_INVENTORY_MARK);
    await expectNothingWritten();

    await ItGoLiveRunModel.create({ key: IT_ASSET_SPECS_MARK, finishedAt: AT, outcome: {} });
  });

  it('refuses — writing nothing — while a branch the sheets name is not in the organisation', async () => {
    const outcome = await importItBranchCustody({ devices: ROWS }, AT);

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'branches not found in the organisation: بورسعيد: missing',
    });
    await expectNothingWritten();

    await plantBranch(PORTSAID, 'PSD', 'بورسعيد');
  });

  it('refuses — writing nothing — while a kind has no category of its own: a phone is never a desktop', async () => {
    const outcome = await importItBranchCustody({ devices: ROWS }, AT);

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'no asset category to file ipPhone under',
    });
    await expectNothingWritten();

    await plantCategory(PHONE_CATEGORY, 'هاتف IP');
  });

  it('registers, fills, moves and reports — every line by its sheet and row', async () => {
    const outcome = await importItBranchCustody({ devices: ROWS }, AT);

    const line = (sheet: string, row: number, serial: string | null, tag: string | null) => ({
      sheet,
      row,
      serial,
      tag,
    });
    expect(outcome).toMatchObject({
      status: 'done',
      rows: 17,
      created: [
        {
          ...line('عهدة فرع بورسعيد', 19, NEW_PPID, '2G76GJ5'),
          assetCode: 'AST-00001',
          serialNumber: '2G76GJ5',
          externalTag: NEW_PPID,
          branch: 'بورسعيد',
        },
        {
          ...line('عهدة فرع بورسعيد', 40, '271FVCWP20CCCC4D', null),
          assetCode: 'AST-00002',
          serialNumber: '271FVCWP20CCCC4D',
          externalTag: null,
          branch: 'بورسعيد',
        },
        {
          ...line('عهدة فرع طنطا', 37, '20FQKM8N30C682FE', null),
          assetCode: 'AST-00003',
          serialNumber: '20FQKM8N30C682FE',
          externalTag: null,
          branch: 'طنطا',
        },
      ],
      filled: {
        'specs.processor': 3,
        'specs.memory': 4,
        'specs.systemType': 1,
        'specs.storage': 1,
        'specs.displayAdapter': 1,
        accessories: 3,
        externalTag: 1,
        manufacturer: 1,
        model: 0,
      },
      moved: [
        {
          ...line('عهدة فرع الشروق', 16, 'MP30EPE1', null),
          assetCode: 'AST-00013',
          from: '6 أكتوبر',
          to: 'وصال',
          location: 'مخزن IT',
        },
      ],
      notMoved: [
        {
          ...line('عهدة فرع طنطا', 17, null, 'MP30EPDE'),
          assetCode: 'AST-00014',
          status: 'assigned',
          branch: '6 أكتوبر',
        },
        {
          ...line('عهدة فرع الشروق', 18, 'MP30EPEV', null),
          assetCode: 'AST-00020',
          status: 'assigned',
          branch: '6 أكتوبر',
        },
      ],
      kept: [
        {
          ...line('عهدة فرع طنطا', 3, null, '99GSWV3'),
          assetCode: 'AST-00011',
          field: 'specs.processor',
          register: 'Intel Core i5',
          sheetValue: 'Intel Core i7-12700',
        },
        {
          ...line('عهدة فرع طنطا', 3, null, '99GSWV3'),
          assetCode: 'AST-00011',
          field: 'accessories',
          register: 'Keyboard',
          sheetValue: 'Keyboard, Mouse',
        },
      ],
      notFound: [{ ...line('عهدة فرع طنطا', 36, 'GONE001', null), registerSerial: 'GONE001' }],
      ambiguous: [],
      alreadyRegistered: [
        { ...line('عهدة فرع بورسعيد', 41, '271FVCWP20CCCC63', null), assetCode: 'AST-00017' },
      ],
      duplicateTarget: [],
      skipped: [
        { ...line('عهدة فرع طنطا', 24, '3KB75G3', null), reason: 'repeatedSerial' },
        { ...line('عهدة فرع الشروق', 27, 'CNDRP8Z666', null), reason: 'serialDisputed' },
        { ...line('عهدة فرع أكتوبر', 6, null, 'L8T14AV'), reason: 'notASerial' },
        { ...line('عهدة فرع أكتوبر', 28, null, null), reason: 'noSerialOrTag' },
        { ...line('عهدة فرع أكتوبر', 39, null, 'B3SZ8V3'), reason: 'nearSerial' },
      ],
      complete: [{ ...line('عهدة فرع طنطا', 35, 'CNDRQ5Q3LZ', null), assetCode: 'AST-00015' }],
    });

    // A new device, in its branch's stock: the tag its serial, the «CN-0…» label printed, the
    // sheet named — and no history entry, like any registration (FR-5's window stays open).
    const screen = await assetBySerial('2G76GJ5');
    expect(screen).toMatchObject({
      assetCode: 'AST-00001',
      name: 'Dell E2020H',
      manufacturer: 'Dell',
      model: 'E2020H',
      externalTag: NEW_PPID,
      status: 'inStock',
      currentAssignmentId: null,
      description: null,
      location: null,
      purchase: null,
      warranty: null,
      specs: null,
      accessories: [],
      notes: 'من ملف «عهدة فرع بورسعيد» — نوفمبر 2026',
    });
    expect(String(screen?.branchId)).toBe(String(PORTSAID));
    expect(String(screen?.categoryId)).toBe(String(SCREEN_CATEGORY));
    // The line's own note on a line of its own.
    const phone = await assetBySerial('20FQKM8N30C682FE');
    expect(phone).toMatchObject({
      assetCode: 'AST-00003',
      name: 'Fiberme FAP2601',
      notes: 'من ملف «عهدة فرع طنطا» — نوفمبر 2026\nرقم الهاتف في الملف: 2007',
    });
    expect(String(phone?.branchId)).toBe(String(TANTA));
    expect(String(phone?.categoryId)).toBe(String(PHONE_CATEGORY));
    expect(
      await ItAssetEventModel.countDocuments({
        subjectId: { $in: [screen?._id, phone?._id] },
      }).exec(),
    ).toBe(0);
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityId': String(screen?._id),
        action: 'create',
      }).exec(),
    ).toBe(1);

    // «أكمّل الناقص بس»: no specifications at all — the table made, the sheet's five in it; the
    // accessories it had none of. The version moves, the edit is nobody's hand, and the history
    // names what was filled.
    expect(await asset(BARE)).toMatchObject({
      specs: { ...EMPTY, ...SPECS },
      accessories: ['Keyboard', 'Mouse'],
      __v: 1,
      updatedBy: null,
    });
    const fields = [
      'specs.processor',
      'specs.memory',
      'specs.systemType',
      'specs.storage',
      'specs.displayAdapter',
      'accessories',
    ] as const;
    expect(await history(BARE)).toMatchObject([
      {
        type: 'updated',
        at: AT,
        actorUserId: null,
        actorName: '',
        metadata: { fields },
        notes: updatedHistoryNote({ sheet: 'عهدة فرع طنطا' }, fields),
      },
    ]);

    // Typed by the IT team: its processor and its accessories kept (reported above), «1TB HDD» the
    // sheet's own, the one row it lacked added — every other row exactly as it was.
    expect(await asset(TYPED)).toMatchObject({
      specs: { ...TYPED_SPECS, memory: '(1×8) 8' },
      accessories: ['Keyboard'],
      __v: 4,
    });
    expect(await history(TYPED)).toMatchObject([
      { type: 'updated', metadata: { fields: ['specs.memory'] } },
    ]);

    // The screen's «CN-0…» label beside its service tag.
    expect(await asset(SCREEN)).toMatchObject({
      externalTag: PPID,
      serialNumber: '2G76GJ3',
      __v: 1,
    });

    // In stock in October, on the Shorouk sheet: moved — and filled, both in its history. Its place
    // in October's IT store is no place in Shorouk: cleared with the move, and said so.
    expect(await asset(ON_THE_MOVE)).toMatchObject({
      status: 'inStock',
      currentAssignmentId: null,
      accessories: ['Keyboard', 'Mouse'],
      location: null,
      __v: 1,
    });
    expect(String((await asset(ON_THE_MOVE))?.branchId)).toBe(String(SHOROUK));
    expect(await history(ON_THE_MOVE)).toMatchObject([
      {
        type: 'transferred',
        at: AT,
        actorUserId: null,
        metadata: { fromBranchId: String(OCTOBER), toBranchId: String(SHOROUK) },
        notes:
          'نُقل إلى فرع الشروق حسب ملف «عهدة فرع الشروق» — نوفمبر 2026 — وأُزيل الموقع السابق «مخزن IT»',
      },
      { type: 'updated', metadata: { fields: ['specs.processor', 'specs.memory', 'accessories'] } },
    ]);
    const transfer = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'asset',
      'entityRef.entityId': String(ON_THE_MOVE),
      action: 'transfer',
    })
      .lean()
      .exec();
    expect(transfer).toHaveLength(1);
    expect(transfer[0]?.changes).toEqual([
      { field: 'branchId', old: String(OCTOBER), new: String(SHOROUK) },
      { field: 'location', old: 'مخزن IT', new: null },
      { field: 'source', old: null, new: IT_BRANCH_CUSTODY_MARK },
    ]);

    // Somebody holds it: custody moves it, never this step — still in October, still theirs, but
    // what it lacked is filled.
    const held = await asset(HELD);
    expect(held).toMatchObject({
      status: 'assigned',
      specs: { ...EMPTY, processor: '1x intel core 5 210h', memory: '(1×16)16 G' },
      accessories: ['Keyboard', 'Mouse'],
      location: 'خزينة1',
      __v: 1,
    });
    expect(String(held?.branchId)).toBe(String(OCTOBER));
    expect((await history(HELD)).map((entry) => entry.type)).toEqual(['updated']);

    // Somebody holds it and its line adds nothing: reported where it is — under `notMoved` and
    // nowhere else — and not written at all: not its version, not its last editor, no history.
    const heldComplete = await asset(HELD_COMPLETE);
    expect(heldComplete).toMatchObject({
      status: 'assigned',
      specs: null,
      accessories: [],
      __v: 0,
    });
    expect(String(heldComplete?.updatedBy)).toBe(String(EDITOR));
    expect(String(heldComplete?.branchId)).toBe(String(OCTOBER));
    expect(await ItAssetEventModel.countDocuments({ subjectId: HELD_COMPLETE }).exec()).toBe(0);
    expect(
      await AuditLogModel.countDocuments({ 'entityRef.entityId': String(HELD_COMPLETE) }).exec(),
    ).toBe(0);
    const lists = outcome as unknown as Record<string, unknown>;
    expect(
      Object.keys(lists).filter((list) => {
        const entries = lists[list];
        return (
          Array.isArray(entries) &&
          (entries as unknown[]).some(
            (entry) =>
              typeof entry === 'object' &&
              entry !== null &&
              'assetCode' in entry &&
              entry.assetCode === 'AST-00020',
          )
        );
      }),
    ).toEqual(['notMoved']);

    // Registered by hand since the review: given the maker it lacked, nothing else.
    expect(await asset(BY_HAND)).toMatchObject({
      manufacturer: 'Grandstream',
      model: 'GXP1615',
      name: 'هاتف',
      __v: 1,
    });

    // Nothing lacking, nothing written — not even its version.
    const complete = await asset(COMPLETE);
    expect(complete?.__v).toBe(0);
    expect(String(complete?.updatedBy)).toBe(String(EDITOR));
    expect(await ItAssetEventModel.countDocuments({ subjectId: COMPLETE }).exec()).toBe(0);

    // A line left out touches nothing, not even the device whose serial it repeats; a line the
    // register no longer holds registers nothing.
    const leftOut = await asset(LEFT_OUT);
    expect(leftOut?.__v).toBe(0);
    expect(String(leftOut?.branchId)).toBe(String(HQ));
    expect(await assetBySerial('GONE001')).toBeNull();
    // A disputed serial moves nothing: the head office's printer stays in stock where it is.
    const disputed = await asset(DISPUTED);
    expect(disputed).toMatchObject({ status: 'inStock', __v: 0 });
    expect(String(disputed?.branchId)).toBe(String(HQ));
    expect(await ItAssetEventModel.countDocuments({ subjectId: DISPUTED }).exec()).toBe(0);

    expect(await ItAssetModel.countDocuments({}).exec()).toBe(14);
    expect(await ItAssetEventModel.countDocuments({ type: 'updated' }).exec()).toBe(6);
    expect(await ItAssetEventModel.countDocuments({ type: 'transferred' }).exec()).toBe(1);
    const run = await ItGoLiveRunModel.findOne({ key: IT_BRANCH_CUSTODY_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ rows: 17, notFound: [{ row: 36 }] });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItBranchCustody({ devices: ROWS }, AT)).status).toBe('alreadyDone');
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(14);
    expect(await asset(BARE)).toMatchObject({ __v: 1 });
    expect(await ItAssetEventModel.countDocuments({}).exec()).toBe(7);
  });
});
