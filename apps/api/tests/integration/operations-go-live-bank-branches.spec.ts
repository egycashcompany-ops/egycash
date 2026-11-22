// The owner's four banks' branch lists loaded by the deploy (Round 29b), against a real mongo —
// «انا عاوز الداتا اللى باعتهالك دى تتضاف … نفذها».
//
// What a source-reading test cannot see: each bank loaded ONCE, in ONE transaction whose last write
// is its run row — a failure leaves neither the row nor any of the data, is counted, and is tried
// again for a week, then never; a later boot writes nothing at all, so a branch an operator deleted
// or edited since stays as he left it; the import's own rules (both areas, an area created or
// reused by its folded name and its empty English name filled, a held branch's code and area
// updated and its address kept, «-2» / «-3» past a code in use, a name twice refused); the rows
// that may be a branch the bank holds held back, and every edit kept with what it replaced (Round
// 29b critic); a bank found by its folded name, created where «البنوك» lacks it and nothing looks
// like it, and skipped FOR GOOD — its run row says why — when two banks answer to its names, one
// only looks like it, or it is stopped. SYNTHETIC files shaped like the committed ones; never a row
// of the owner's.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { OperationsAreaModel } from '../../src/modules/operations/areas/area.model';
import { OperationsBankBranchModel } from '../../src/modules/operations/bank-branches/bank-branch.model';
import { OperationsBankModel } from '../../src/modules/operations/banks/bank.model';
import {
  OperationsGoLiveRunModel,
  operationsGoLiveFailedKey,
} from '../../src/modules/operations/go-live/go-live-run.model';
import {
  OPERATIONS_BRANCH_LOAD_BANKS,
  type BankBranchesFile,
} from '../../src/modules/operations/go-live/bank-branches-banks';
import {
  BANK_BRANCHES_RETRY_DAYS,
  bankBranchesLoadMark,
  runOperationsBankBranchesGoLive,
} from '../../src/modules/operations/go-live/bank-branches';

let replset: MongoMemoryReplSet | undefined;
let dataDir: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env['MONGO_TEST_URI'];
  const dbName = `ecms-operations-go-live-bank-branches-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri(dbName);
};

type Row = BankBranchesFile['rows'][number];
const row = (
  n: number,
  name: string,
  code: string | null,
  areaAr: string | null = null,
  areaEn: string | null = null,
  address: string | null = null,
): Row => ({ row: n, name, code, areaAr, areaEn, address });

/** The synthetic files, one per bank, shaped like the committed ones. */
const FILES: Record<string, Omit<BankBranchesFile, 'source' | 'rowsRead'>> = {
  'banque-misr': {
    bank: 'banque-misr',
    leftOut: [
      {
        row: 5,
        problem: 'nameIsDate',
        nameAsRead: '2001-02-03 00:00:00',
        code: '300',
        why: 'synthetic',
      },
    ],
    rows: [
      // «116» is held by a branch the sheet does not name: the sheet's two take -2 and -3.
      row(2, 'فرع النخلة', '116', 'منطقة النجمة', 'Star'),
      // «الواحه» is the held «الواحة», folded — written in its own spelling.
      row(3, 'فرع الزيتونة', '116', 'الواحه', 'Oasis', 'شارع ٢'),
      // A held branch by name: its code and both areas updated, its own address kept.
      row(4, 'فرع قائم', '084', 'منطقة الجبل', 'Mountain', 'عنوان جديد'),
      row(6, 'فرع السنديان', '200'),
      // The same name twice: a problem, written nothing.
      row(7, 'فرع النخلة', '201', 'منطقة النجمة', 'Star'),
      // The held «فرع الربوه» spelt another way: held back — and its area is not created.
      row(8, 'فرع الربوة', '310', 'منطقة الربوة', 'Rabwa'),
      // «320», a code the sheet gives this branch alone, is the held «فرع المروة»'s: held back.
      row(9, 'فرع الصفا', '320'),
      // A held branch with an area: the sheet's REPLACES both — kept in the run row with the old.
      row(10, 'فرع السلام', '400', 'منطقة الجبل', 'Mountain'),
    ],
  },
  cib: {
    bank: 'cib',
    leftOut: [],
    rows: [
      row(2, 'فرع الأول', '1', 'منطقة الأفق', 'Horizon'),
      row(3, 'فرع الثاني', '1', 'منطقة الأفق', 'Horizon'),
    ],
  },
  nbe: { bank: 'nbe', leftOut: [], rows: [row(2, 'فرع الشمال', '10')] },
  'banque-du-caire': {
    bank: 'banque-du-caire',
    leftOut: [],
    rows: [row(2, 'فرع الجنوب', '20', null, null, 'عنوان الجنوب')],
  },
};

const ids: Record<string, mongoose.Types.ObjectId> = {};

const plantBank = async (
  key: string,
  code: number,
  opsName: string,
  en: string,
  extra: { isActive?: boolean; isDeleted?: boolean } = {},
): Promise<void> => {
  const doc = await OperationsBankModel.create({
    code,
    name: { ar: opsName, en },
    opsName,
    isActive: extra.isActive ?? true,
    isDeleted: extra.isDeleted ?? false,
  });
  ids[key] = doc._id as mongoose.Types.ObjectId;
};

const runsCollection = (): string => OperationsGoLiveRunModel.collection.collectionName;

const liveBranches = (bankId: mongoose.Types.ObjectId) =>
  OperationsBankBranchModel.find({ bankId, isDeleted: false }).sort({ code: 1 }).lean().exec();

/** The run rows — each bank's last word; a failed try's count is not one. */
const finalRuns = { key: { $not: /:failed$/u } };

const counts = async () => ({
  banks: await OperationsBankModel.countDocuments({}).exec(),
  branches: await OperationsBankBranchModel.countDocuments({}).exec(),
  areas: await OperationsAreaModel.countDocuments({}).exec(),
  runs: await OperationsGoLiveRunModel.countDocuments(finalRuns).exec(),
  audits: await AuditLogModel.countDocuments({ 'entityRef.moduleId': 'operations' }).exec(),
});

const failuresOf = async (bank: Parameters<typeof bankBranchesLoadMark>[0]) =>
  (
    await OperationsGoLiveRunModel.findOne({
      key: operationsGoLiveFailedKey(bankBranchesLoadMark(bank)),
    })
      .lean()
      .exec()
  )?.outcome;

const runOf = async (bank: Parameters<typeof bankBranchesLoadMark>[0]) =>
  (
    await OperationsGoLiveRunModel.findOne({ key: bankBranchesLoadMark(bank) })
      .lean()
      .exec()
  )?.outcome;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = mkdtempSync(join(tmpdir(), 'ecms-ops-bank-branches-'));
  for (const bank of OPERATIONS_BRANCH_LOAD_BANKS) {
    const file = FILES[bank.key] as Omit<BankBranchesFile, 'source' | 'rowsRead'>;
    const json: BankBranchesFile = {
      source: 'synthetic',
      rowsRead: file.rows.length + file.leftOut.length,
      ...file,
    };
    writeFileSync(join(dataDir, bank.file), JSON.stringify(json));
  }

  // «البنوك» before the deploy: بنك مصر held as it is named; البنك الأهلي spelt another way; two
  // banks answering to بنك القاهرة's names; no CIB; a deleted bank holding the highest code.
  await plantBank('misr', 1, 'بنك مصر', 'Banque Misr');
  await plantBank('nbe', 5, 'البنك الأهلى المصرى', 'NBE');
  await plantBank('cairo', 7, 'بنك القاهرة', 'BdC');
  await plantBank('cairoTwin', 8, 'BDC', 'Banque du Caire');
  await plantBank('gone', 40, 'بنك قديم', 'Old bank', { isDeleted: true });

  // بنك مصر's branches: one the sheet names (code, no area, an address), one it does not (holding «116»).
  const held = await OperationsBankBranchModel.create({
    bankId: ids['misr'],
    name: 'فرع قائم',
    code: '900',
    opsAreaName: null,
    financeAreaName: null,
    location: { addressLine: 'عنوان قديم', coordinates: null },
    isActive: true,
  });
  ids['held'] = held._id as mongoose.Types.ObjectId;
  const fixed = await OperationsBankBranchModel.create({
    bankId: ids['misr'],
    name: 'فرع ثابت',
    code: '116',
    opsAreaName: null,
    financeAreaName: null,
    location: null,
    isActive: true,
  });
  ids['fixed'] = fixed._id as mongoose.Types.ObjectId;
  // Three more the sheet does not name by name: «فرع الربوه» (its «فرع الربوة» spelt another way),
  // «فرع المروة» on «320» (the sheet's code for «فرع الصفا»), and one it names, with an area.
  for (const [key, name, code, area] of [
    ['rabwa', 'فرع الربوه', '77', null],
    ['marwa', 'فرع المروة', '320', null],
    ['salam', 'فرع السلام', '400', 'مدينة نصر'],
  ] as const) {
    const doc = await OperationsBankBranchModel.create({
      bankId: ids['misr'],
      name,
      code,
      opsAreaName: area,
      financeAreaName: area,
      location: null,
      isActive: true,
    });
    ids[key] = doc._id as mongoose.Types.ObjectId;
  }

  // «المناطق»: one with no English name (the sheet fills it), one spelt «الواحة».
  const star = await OperationsAreaModel.create({
    name: 'منطقة النجمة',
    nameEn: null,
    governorate: null,
    isActive: true,
  });
  ids['star'] = star._id as mongoose.Types.ObjectId;
  await OperationsAreaModel.create({
    name: 'الواحة',
    nameEn: 'Oasis',
    governorate: null,
    isActive: true,
  });
}, 120_000);

afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  await disconnectMongo();
  await replset?.stop();
});

describe('loading the four banks’ branches', () => {
  let firstFailedAt: Date;

  it('fails whole: a run row that cannot be written leaves none of the data — the try is counted', async () => {
    const before = await counts();
    // The run row is each transaction's LAST write; a validator refuses every one (a failed try's
    // count, under `<key>:failed`, still goes in).
    const db = mongoose.connection.db as mongoose.mongo.Db;
    const refuseEveryRow = { key: { $regex: ':failed$' } };
    const exists = await db
      .listCollections({ name: runsCollection() }, { nameOnly: true })
      .toArray();
    if (exists.length === 0) {
      await db.createCollection(runsCollection(), { validator: refuseEveryRow });
    } else {
      await db.command({ collMod: runsCollection(), validator: refuseEveryRow });
    }

    const outcomes = await runOperationsBankBranchesGoLive({ dataDir });
    // بنك القاهرة's skip is a run row too: refused, it fails like the others.
    expect(outcomes.map((o) => [o.bank, o.status])).toEqual([
      ['banque-misr', 'failed'],
      ['cib', 'failed'],
      ['nbe', 'failed'],
      ['banque-du-caire', 'failed'],
    ]);
    // Nothing: no CIB, no area, no branch, the held branch and area as they were, no run row.
    expect(await counts()).toEqual(before);
    expect(await OperationsBankModel.exists({ opsName: 'البنك التجاري الدولي' }).exec()).toBeNull();
    expect(await OperationsBankBranchModel.findById(ids['held']).lean().exec()).toMatchObject({
      code: '900',
      opsAreaName: null,
    });
    expect(await OperationsAreaModel.findById(ids['star']).lean().exec()).toMatchObject({
      nameEn: null,
    });
    // Each failure counted, readable from the database.
    for (const bank of OPERATIONS_BRANCH_LOAD_BANKS) {
      expect(await failuresOf(bank.key), bank.key).toMatchObject({
        status: 'failed',
        failures: 1,
        lastError: expect.stringMatching(/validation/iu) as unknown,
      });
    }
    firstFailedAt = (await failuresOf('nbe'))?.['firstFailedAt'] as Date;
    expect(firstFailedAt).toBeInstanceOf(Date);

    await db.command({ collMod: runsCollection(), validator: {} });
  });

  it('first boot: each bank found or created, its file written by the import’s rules, once', async () => {
    const outcomes = await runOperationsBankBranchesGoLive({ dataDir });
    expect(outcomes.map((o) => [o.bank, o.status])).toEqual([
      ['banque-misr', 'done'],
      ['cib', 'done'],
      ['nbe', 'done'],
      ['banque-du-caire', 'skipped'],
    ]);
    const [misr, cib, nbe, cairo] = outcomes;

    // ── بنك مصر: held, reused ──────────────────────────────────────────────────────────────────
    expect(misr).toMatchObject({
      status: 'done',
      bankId: String(ids['misr']),
      bankName: 'بنك مصر',
      bankCreated: false,
      rowsRead: 9,
      leftOut: [{ row: 5, problem: 'nameIsDate', code: '300' }],
      new: 3,
      updated: 2,
      unchanged: 0,
      suffixed: 2,
      problems: 1,
      problemRows: [{ row: 7, problem: 'duplicateName' }],
      heldBack: [
        {
          row: 8,
          name: 'فرع الربوة',
          code: '310',
          why: 'similarName',
          branch: { id: String(ids['rabwa']), name: 'فرع الربوه', code: '77' },
        },
        {
          row: 9,
          name: 'فرع الصفا',
          code: '320',
          why: 'codeHeld',
          branch: { id: String(ids['marwa']), name: 'فرع المروة', code: '320' },
        },
      ],
      areasCreated: 1,
      areasFilled: 1,
      areasReplaced: 1,
    });
    const misrBranches = new Map(
      (await liveBranches(ids['misr'] as mongoose.Types.ObjectId)).map((b) => [b.name, b]),
    );
    expect([...misrBranches.keys()].sort()).toEqual(
      [
        'فرع السنديان',
        'فرع الزيتونة',
        'فرع النخلة',
        'فرع ثابت',
        'فرع قائم',
        'فرع الربوه',
        'فرع المروة',
        'فرع السلام',
      ].sort(),
    );
    // Both areas from the sheet's one; the held area's own spelling; the address on a new branch.
    expect(misrBranches.get('فرع النخلة')).toMatchObject({
      code: '116-2',
      opsAreaName: 'منطقة النجمة',
      financeAreaName: 'منطقة النجمة',
      location: null,
      createdBy: null,
    });
    expect(misrBranches.get('فرع الزيتونة')).toMatchObject({
      code: '116-3',
      opsAreaName: 'الواحة',
      financeAreaName: 'الواحة',
      location: { addressLine: 'شارع ٢', coordinates: null },
    });
    expect(misrBranches.get('فرع السنديان')).toMatchObject({
      code: '200',
      opsAreaName: null,
      financeAreaName: null,
    });
    // The held branch: code and both areas from the sheet, its own address kept.
    expect(misrBranches.get('فرع قائم')).toMatchObject({
      code: '084',
      opsAreaName: 'منطقة الجبل',
      financeAreaName: 'منطقة الجبل',
      location: { addressLine: 'عنوان قديم' },
      updatedBy: null,
    });
    // Its area replaced by the sheet's — the owner's rule — and the old one in the run row.
    expect(misrBranches.get('فرع السلام')).toMatchObject({
      code: '400',
      opsAreaName: 'منطقة الجبل',
      financeAreaName: 'منطقة الجبل',
    });
    // The branches the sheet does not name — the two its held-back rows may be — untouched.
    expect(misrBranches.get('فرع ثابت')).toMatchObject({ code: '116', __v: 0 });
    expect(misrBranches.get('فرع الربوه')).toMatchObject({ code: '77', __v: 0 });
    expect(misrBranches.get('فرع المروة')).toMatchObject({ code: '320', __v: 0 });

    // «المناطق»: the empty English name filled, a new area with both names, «الواحة» not doubled,
    // and no area for the held-back row alone.
    const areas = new Map(
      (await OperationsAreaModel.find({ isDeleted: false }).lean().exec()).map((a) => [a.name, a]),
    );
    expect(areas.get('منطقة النجمة')?.nameEn).toBe('Star');
    expect(areas.get('منطقة الجبل')).toMatchObject({ nameEn: 'Mountain', isActive: true });
    expect(areas.has('الواحه')).toBe(false);
    expect(areas.has('منطقة الربوة')).toBe(false);

    // ── CIB: missing, created — the next code past every code given, the deleted bank's too ──
    expect(cib).toMatchObject({ status: 'done', bankCreated: true, new: 2, suffixed: 1 });
    const created = await OperationsBankModel.findOne({ opsName: 'البنك التجاري الدولي' })
      .lean()
      .exec();
    expect(created).toMatchObject({
      code: 41,
      name: { ar: 'البنك التجاري الدولي', en: 'Commercial International Bank' },
      slogan: null,
      sortOrder: null,
      isActive: true,
      createdBy: null,
    });
    expect(
      (await liveBranches(created?._id as mongoose.Types.ObjectId)).map((b) => [
        b.code,
        b.opsAreaName,
      ]),
    ).toEqual([
      ['1', 'منطقة الأفق'],
      ['1-2', 'منطقة الأفق'],
    ]);
    expect(areas.get('منطقة الأفق')?.nameEn).toBe('Horizon');

    // ── البنك الأهلي: found by its name folded ─────────────────────────────────────────────────
    expect(nbe).toMatchObject({ status: 'done', bankId: String(ids['nbe']), bankCreated: false });
    expect((await liveBranches(ids['nbe'] as mongoose.Types.ObjectId)).map((b) => b.name)).toEqual([
      'فرع الشمال',
    ]);

    // ── بنك القاهرة: two banks answer — skipped, nothing written but its run row ──────────────
    expect(cairo).toMatchObject({
      status: 'skipped',
      reason: 'severalBanks',
      banks: [
        { id: String(ids['cairo']), opsName: 'بنك القاهرة' },
        { id: String(ids['cairoTwin']), opsName: 'BDC' },
      ],
    });
    expect(await OperationsBankBranchModel.countDocuments({ name: 'فرع الجنوب' }).exec()).toBe(0);

    // The run rows — one per bank, each in the same transaction as its data, saying how it ended.
    const runs = await OperationsGoLiveRunModel.find(finalRuns).sort({ key: 1 }).lean().exec();
    expect(runs.map((r) => r.key).sort()).toEqual(
      OPERATIONS_BRANCH_LOAD_BANKS.map((b) => bankBranchesLoadMark(b.key)).sort(),
    );
    expect(await runOf('banque-misr')).toMatchObject({
      status: 'done',
      new: 3,
      updated: 2,
      leftOut: [{ row: 5 }],
      problemRows: [{ row: 7, problem: 'duplicateName' }],
      heldBack: [
        { row: 8, why: 'similarName' },
        { row: 9, why: 'codeHeld' },
      ],
      areasReplaced: 1,
      changed: [
        {
          row: 4,
          branchId: String(ids['held']),
          name: 'فرع قائم',
          changes: ['code', 'opsAreaName', 'financeAreaName'],
          before: { code: '900', opsAreaName: null, financeAreaName: null, address: 'عنوان قديم' },
          after: { code: '084', opsAreaName: 'منطقة الجبل', financeAreaName: 'منطقة الجبل' },
        },
        {
          row: 10,
          branchId: String(ids['salam']),
          name: 'فرع السلام',
          changes: ['opsAreaName', 'financeAreaName'],
          before: { code: '400', opsAreaName: 'مدينة نصر', financeAreaName: 'مدينة نصر' },
          after: { code: '400', opsAreaName: 'منطقة الجبل', financeAreaName: 'منطقة الجبل' },
        },
      ],
    });
    expect(await runOf('banque-du-caire')).toEqual({
      status: 'skipped',
      bank: 'banque-du-caire',
      rowsRead: 1,
      reason: 'severalBanks',
      banks: [
        { id: String(ids['cairo']), opsName: 'بنك القاهرة' },
        { id: String(ids['cairoTwin']), opsName: 'BDC' },
      ],
    });

    // The trail: the bank's add, the catalog's adds and edits — by nobody, marked with the run.
    const bankAdd = await AuditLogModel.findOne({
      'entityRef.entityType': 'bank',
      'entityRef.entityId': String(created?._id),
      action: 'create',
    })
      .lean()
      .exec();
    expect(bankAdd?.actor.userId).toBeNull();
    expect(bankAdd?.changes).toContainEqual({
      field: 'source',
      old: null,
      new: bankBranchesLoadMark('cib'),
    });
    const branchEdit = await AuditLogModel.findOne({
      'entityRef.entityType': 'bankBranch',
      'entityRef.entityId': String(ids['held']),
      action: 'update',
    })
      .lean()
      .exec();
    expect(branchEdit?.changes).toEqual(
      expect.arrayContaining([
        { field: 'code', old: '900', new: '084' },
        { field: 'source', old: null, new: bankBranchesLoadMark('banque-misr') },
      ]),
    );
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityType': 'bankBranch',
        action: 'create',
      }).exec(),
    ).toBe(3 + 2 + 1);
  });

  it('a later boot writes nothing — a branch deleted or edited since stays as it was left', async () => {
    const nakhla = await OperationsBankBranchModel.findOne({ name: 'فرع النخلة' }).lean().exec();
    await OperationsBankBranchModel.updateOne(
      { name: 'فرع السنديان' },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    ).exec();
    await OperationsBankBranchModel.updateOne(
      { _id: nakhla?._id },
      { $set: { code: 'X1', opsAreaName: null } },
    ).exec();
    await OperationsAreaModel.updateOne(
      { name: 'منطقة الجبل' },
      { $set: { isDeleted: true } },
    ).exec();
    const before = await counts();

    const outcomes = await runOperationsBankBranchesGoLive({ dataDir });
    expect(outcomes.map((o) => [o.bank, o.status])).toEqual([
      ['banque-misr', 'alreadyDone'],
      ['cib', 'alreadyDone'],
      ['nbe', 'alreadyDone'],
      ['banque-du-caire', 'alreadyDone'],
    ]);
    expect(await counts()).toEqual(before);
    expect(
      await OperationsBankBranchModel.countDocuments({ name: 'فرع السنديان', isDeleted: false }),
    ).toBe(0);
    expect(await OperationsBankBranchModel.findById(nakhla?._id).lean().exec()).toMatchObject({
      code: 'X1',
      opsAreaName: null,
    });
    expect(
      await OperationsAreaModel.countDocuments({ name: 'منطقة الجبل', isDeleted: false }),
    ).toBe(0);
  });

  it('a skip is final: settled since — one bank, started — a later boot still loads nothing', async () => {
    // Months later: the twin deleted, so one bank answers. The November sheet stays unloaded.
    await OperationsBankModel.updateOne(
      { _id: ids['cairoTwin'] },
      { $set: { isDeleted: true } },
    ).exec();
    const before = await counts();
    const outcomes = await runOperationsBankBranchesGoLive({
      dataDir,
      now: new Date(Date.now() + 120 * DAY_MS),
    });
    expect(outcomes[3]).toEqual({ status: 'alreadyDone', bank: 'banque-du-caire' });
    expect(await counts()).toEqual(before);
    expect(await liveBranches(ids['cairo'] as mongoose.Types.ObjectId)).toEqual([]);
    expect(await runOf('banque-du-caire')).toMatchObject({ status: 'skipped' });
  });

  it('a build without the files loads nothing and says so — in the database too', async () => {
    await OperationsGoLiveRunModel.deleteMany({ key: bankBranchesLoadMark('nbe') }).exec();
    const outcomes = await runOperationsBankBranchesGoLive({ dataDir: join(dataDir, 'missing') });
    expect(outcomes[2]).toEqual({
      status: 'skipped',
      bank: 'nbe',
      reason: 'notInThisBuild',
      banks: [],
    });
    expect(await failuresOf('nbe')).toMatchObject({
      status: 'failed',
      failures: 2,
      firstFailedAt,
      lastError: expect.stringMatching(/^notInThisBuild/u) as unknown,
    });
  });

  it(`a failure is tried again for ${String(BANK_BRANCHES_RETRY_DAYS)} days after the first, then never — whatever cleared it`, async () => {
    // An operator's edit a late load would undo.
    await OperationsBankBranchModel.updateOne(
      { bankId: ids['nbe'], name: 'فرع الشمال' },
      { $set: { code: 'N-1' } },
    ).exec();
    const lastDay = new Date(
      firstFailedAt.getTime() + (BANK_BRANCHES_RETRY_DAYS * DAY_MS - 60_000),
    );
    const tried = await runOperationsBankBranchesGoLive({
      dataDir: join(dataDir, 'missing'),
      now: lastDay,
    });
    expect(tried[2]).toMatchObject({ status: 'skipped', reason: 'notInThisBuild' });
    expect(await failuresOf('nbe')).toMatchObject({ failures: 3, firstFailedAt });

    // Its days past, the build that has the file: it gives up, for good, and loads nothing.
    const before = await counts();
    const pastDays = new Date(firstFailedAt.getTime() + BANK_BRANCHES_RETRY_DAYS * DAY_MS);
    const gaveUp = await runOperationsBankBranchesGoLive({ dataDir, now: pastDays });
    expect(gaveUp[2]).toEqual({
      status: 'gaveUp',
      bank: 'nbe',
      failures: 3,
      firstFailedAt,
      lastError: expect.stringMatching(/^notInThisBuild/u) as unknown,
    });
    expect(await runOf('nbe')).toMatchObject({ status: 'gaveUp', failures: 3 });
    expect(await counts()).toEqual({ ...before, runs: before.runs + 1 });
    expect(await liveBranches(ids['nbe'] as mongoose.Types.ObjectId)).toMatchObject([
      { name: 'فرع الشمال', code: 'N-1' },
    ]);

    const again = await runOperationsBankBranchesGoLive({ dataDir });
    expect(again.map((o) => o.status)).toEqual([
      'alreadyDone',
      'alreadyDone',
      'alreadyDone',
      'alreadyDone',
    ]);
  });
});

describe('a bank a person must settle — never created beside, never loaded into', () => {
  beforeAll(async () => {
    for (const { collection } of [
      OperationsBankModel,
      OperationsBankBranchModel,
      OperationsAreaModel,
      OperationsGoLiveRunModel,
    ]) {
      await collection.deleteMany({});
    }
    // No bank of the four by name: only look-alikes — and «BDC», stopped.
    await plantBank('midb', 1, 'بنك مصر إيران', 'MIDB');
    await plantBank('cibNear', 2, 'البنك التجاري الدولي (CIB)', 'CIB Egypt');
    await plantBank('forex', 3, 'NBE FOREX', 'NBE FOREX');
    await OperationsBankModel.updateOne(
      { _id: ids['forex'] },
      { $set: { 'name.ar': 'البنك الأهلي المصري' } },
    ).exec();
    await plantBank('bdc', 4, 'BDC', 'BDC', { isActive: false });
  });

  it('each skipped with why, its run row final — no bank, no branch, no area written', async () => {
    const before = await counts();
    const outcomes = await runOperationsBankBranchesGoLive({ dataDir });
    expect(outcomes).toEqual([
      {
        status: 'skipped',
        bank: 'banque-misr',
        reason: 'lookalikeBanks',
        banks: [{ id: String(ids['midb']), opsName: 'بنك مصر إيران' }],
      },
      {
        status: 'skipped',
        bank: 'cib',
        reason: 'lookalikeBanks',
        banks: [{ id: String(ids['cibNear']), opsName: 'البنك التجاري الدولي (CIB)' }],
      },
      {
        status: 'skipped',
        bank: 'nbe',
        reason: 'lookalikeBanks',
        banks: [{ id: String(ids['forex']), opsName: 'NBE FOREX' }],
      },
      {
        status: 'skipped',
        bank: 'banque-du-caire',
        reason: 'bankStopped',
        banks: [{ id: String(ids['bdc']), opsName: 'BDC' }],
      },
    ]);
    expect(await counts()).toEqual({ ...before, runs: 4 });
    expect(await OperationsBankModel.countDocuments({}).exec()).toBe(4);
    for (const bank of OPERATIONS_BRANCH_LOAD_BANKS) {
      expect(await runOf(bank.key), bank.key).toMatchObject({ status: 'skipped' });
    }

    // «BDC» started since: still nothing — the sheet goes through «استيراد من شيت».
    await OperationsBankModel.updateOne({ _id: ids['bdc'] }, { $set: { isActive: true } }).exec();
    const after = await counts();
    const again = await runOperationsBankBranchesGoLive({ dataDir });
    expect(again.map((o) => o.status)).toEqual([
      'alreadyDone',
      'alreadyDone',
      'alreadyDone',
      'alreadyDone',
    ]);
    expect(await counts()).toEqual(after);
  });
});
