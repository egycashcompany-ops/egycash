// The custody fund against a real mongo — «إجمالي العهدة» = Σ شحن − Σ custody receipts + Σ استعاضة
// − Σ تسوية; the three letters that move it; «سجل العهدة» folded over the whole history; and the
// licensing memos a settlement locks.
//
// His scenario is the samples' one, figure for figure:
//
//   01/09  شحن العهدة       +100,000.00                                   → 100,000.00
//   01/09–28/09  receipts  −82,508.00 (كاوتش 2,650 · وقود 49,844 · صيانة 29,414 · غسيل 600)
//                                                                          →  17,492.00
//   29/09  استعاضة العهدة   +81,908.00 (memos 1–5)                         →  99,400.00
//   05/10  شحن العهدة       +200,000.00                                   → 299,400.00
//   05/10  تسوية العهدة     −124,139.46 (3 licensing memos)                → 175,260.54
//   06/10–18/10  receipts  −15,286.00 in no memo yet                      → 159,974.54
//
// The cases run in order — the fund is one fund — and the races and grants come after the ledger
// has been checked against the sample.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  CreateFleetCustodyChargeSchema,
  CreateFleetCustodyMemoSchema,
  CreateFleetCustodyReplenishmentSchema,
  CreateFleetCustodySettlementSchema,
  CreateFleetLicenseExpenseSchema,
  FleetLicenseExpenseSummaryQuerySchema,
  ListFleetCustodyLedgerQuerySchema,
  ListFleetLicenseExpensesQuerySchema,
  SaveFleetCustodyPaperSettingsSchema,
  UpdateFleetLicenseExpenseSchema,
  type FleetCustodyCountAmountDto,
  type FleetCustodyDashboardDto,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyLedgerTotalsDto,
  type FleetCustodyOperationDto,
  type FleetCustodyReplenishCandidatesDto,
  type FleetCustodySettleCandidatesDto,
  type FleetCustodySource,
  type FleetCustodySummaryDto,
  type FleetLicenseExpenseDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { buildApp } from '../../src/app';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetCustodyOperationModel } from '../../src/modules/fleet/custody/custody-operation.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyPapersService } from '../../src/modules/fleet/custody/custody-papers.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';
import { readCustodyFundTerms } from '../../src/modules/fleet/custody/custody-fund';
import { custodyStaleCutoff } from '../../src/modules/fleet/custody/custody-memo-rules';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';
import { fleetLicenseExpenseService } from '../../src/modules/fleet/license-expenses/license-expense.service';
import { partMoney } from '../../src/modules/fleet/license-expenses/license-expense-money';

let replset: MongoMemoryReplSet | undefined;
let app: Express;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();
const PASSWORD = 'Str0ng#Pass!';
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
/** Σ in piastres, as the fund adds. */
const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;

// ── The cars ──────────────────────────────────────────────────────────────────────────────────

const cars = {
  a: new Types.ObjectId(),
  b: new Types.ObjectId(),
  c: new Types.ObjectId(),
};
const CODES: Record<keyof typeof cars, string> = { a: '207', b: '282', c: '177' };

const plantCars = async (): Promise<void> => {
  await FleetVehicleModel.collection.insertMany(
    (Object.keys(cars) as (keyof typeof cars)[]).map((key) => ({
      _id: cars[key],
      code: CODES[key],
      typeId: new Types.ObjectId(),
      plateNumber: `س ص ${CODES[key]}`,
      chassisNumber: `CH-${CODES[key]}`,
      motorNumber: `MO-${CODES[key]}`,
      joinedAt: day('2026-01-01'),
      licenseExpiresAt: day('2027-01-01'),
      licenseClassId: null,
      operationId: null,
      insuranceCompanyId: null,
      branchId: null,
      departmentId: null,
      radio: { issi: null, motorolaSn: null },
      status: 'active',
      statusReason: null,
      licenseImage: null,
      isDeleted: false,
      schemaVersion: 1,
      __v: 0,
      createdAt: day('2026-01-01'),
      updatedAt: day('2026-01-01'),
    })),
  );
};

// ── The receipts — written as rows from before memos existed: no `memoId` field at all ─────────

let written = 0;
const receiptRow = (
  iso: string,
  kind: FleetCustodySource,
  amount: number,
  extra: Record<string, unknown> = {},
) => {
  written += 1;
  const at = new Date(day(iso).getTime() + written * 1000);
  return {
    _id: new Types.ObjectId(),
    date: day(iso),
    vehicleId: cars.a,
    driverEmployeeId: null,
    driverName: 'سائق',
    kind,
    source: 'custody',
    cardId: null,
    fuelType: kind === 'fuel' ? 'diesel' : null,
    pricePerLitre: null,
    litres: null,
    amount,
    odometer: null,
    company: null,
    image: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    schemaVersion: 1,
    __v: 0,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
};
type ReceiptRow = ReturnType<typeof receiptRow>;
const plant = async (rows: ReceiptRow[]): Promise<string[]> => {
  await FleetReceiptModel.collection.insertMany(rows);
  return rows.map((row) => String(row._id));
};

// ── People and their grants ───────────────────────────────────────────────────────────────────

let userCount = 0;
const tokenWith = async (permissionKeys: string[]): Promise<string> => {
  userCount += 1;
  const role = await rbacService.createRole(
    { name: { en: `Fund role ${userCount}`, ar: `دور العهدة ${userCount}` }, permissionKeys },
    ACTOR,
  );
  const { user } = await userService.create(
    {
      email: `custody-fund-${userCount}@ecms.local`,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const userId = String(user._id);
  await userService.setPassword(userId, PASSWORD, 'passwordReset');
  await userService.forceActivate(userId);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);
};

let viewerToken: string; // fleetCustody.view only
let writerToken: string; // fleetCustody.view + fleetReceipt.create — and NO licensing grant
let receiptOnlyToken: string; // fleetReceipt.create without the custody grant
let licenceEditorToken: string; // the licensing screen's own grants

// ── The letters, through the service (the HTTP cases say the same through the routes) ─────────

const charge = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.charge(CreateFleetCustodyChargeSchema.parse(raw), ACTOR);
const replenish = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.replenish(CreateFleetCustodyReplenishmentSchema.parse(raw), ACTOR);
const settle = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.settle(CreateFleetCustodySettlementSchema.parse(raw), ACTOR);
const memo = async (kind: FleetCustodySource, receiptIds: string[], name = '') =>
  fleetCustodyMemoService.create(
    CreateFleetCustodyMemoSchema.parse({
      kind,
      name,
      lines: receiptIds.map((receiptId) => ({ receiptId })),
    }),
    ACTOR,
  );
const fundNow = async (): Promise<number> => (await readCustodyFundTerms()).fundTotal;
const ledgerAll = async (raw: Record<string, unknown> = {}) =>
  (
    await fleetCustodyFundService.ledger(
      ListFleetCustodyLedgerQuerySchema.parse({ pageSize: 100, ...raw }),
    )
  ).items;

/** A licensing memo of `cars` cars costing `visa` by the card and `cash` in cash. */
const half = (
  vehicles: { vehicleId: string | null; plate: string }[],
  visa: number,
  cash: number,
) => ({
  vehicles,
  items: [
    { itemId: null, label: 'تجديد', amount: visa, count: 1, paidBy: 'visa', receipt: true },
    { itemId: null, label: 'دمغة', amount: cash, count: 1, paidBy: 'cash', receipt: false },
  ],
});
const plates = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ vehicleId: null, plate: `ل ت ${i + 1}` }));
const licence = async (
  date: string,
  renewal: ReturnType<typeof half> | null,
  extension: ReturnType<typeof half> | null,
): Promise<FleetLicenseExpenseDto> =>
  fleetLicenseExpenseService.create(
    CreateFleetLicenseExpenseSchema.parse({
      date,
      renewal,
      extension,
      signatures: { agent: 'أ', director: 'ب', generalManager: 'ج' },
    }),
    ACTOR,
  );

/** A rejection's HTTP status, as the error handler would send it. */
const statusOf = (result: PromiseSettledResult<unknown>): number | 'ok' =>
  result.status === 'fulfilled'
    ? 'ok'
    : ((result.reason as { httpStatus?: number }).httpStatus ?? 500);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  await plantCars();
  viewerToken = await tokenWith(['fleetCustody.view']);
  writerToken = await tokenWith(['fleetCustody.view', 'fleetReceipt.create']);
  receiptOnlyToken = await tokenWith(['fleetReceipt.create']);
  licenceEditorToken = await tokenWith([
    'fleetLicenseExpense.view',
    'fleetLicenseExpense.edit',
    'fleetLicenseExpense.delete',
  ]);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

// Everything the scenario writes, by name, for the cases after it.
const ids = {
  memos: [] as string[],
  wash: [] as string[],
  october: [] as string[],
  charge1: '',
  replenish: '',
  settle: '',
  lx: {} as Record<'lx1' | 'lx2' | 'lx3' | 'lx4' | 'lx5', string>,
};

describe('«إجمالي العهدة» — the formula, before and as the letters move it', () => {
  it('starts at nothing, and every figure is a number', async () => {
    expect(await readCustodyFundTerms()).toEqual({
      charged: { count: 0, amount: 0 },
      spent: { count: 0, amount: 0 },
      replenished: { count: 0, amount: 0, memos: 0 },
      settled: { count: 0, amount: 0, parts: 0 },
      fundTotal: 0,
    });
    expect(await ledgerAll()).toEqual([]);
  });

  it('a charge needs its amount and nothing else; its reason is kept without «نظير»', async () => {
    expect(CreateFleetCustodyChargeSchema.safeParse({}).success, 'no amount').toBe(false);
    expect(CreateFleetCustodyChargeSchema.safeParse({ amount: 0 }).success, 'zero').toBe(false);
    const first = await charge({
      date: '2026-09-01',
      amount: 100000,
      reason: 'نظير تشغيل السيارات لشهر سبتمبر',
    });
    ids.charge1 = first.id;
    expect(first).toMatchObject({
      kind: 'charge',
      date: '2026-09-01',
      from: null,
      to: null,
      amount: 100000,
      reason: 'تشغيل السيارات لشهر سبتمبر',
      memos: [],
      parts: [],
      fundBefore: 0,
      chargedTotal: 0,
      letterFigure: null,
      ledger: { before: 0, after: 100000 },
      version: 0,
    });
    // His names, as the set-up holds them now — the defaults, nobody saved yet.
    expect(first.signatures).toEqual((await fleetCustodyPapersService.getSettings()).papers.charge);
    expect(await fundNow()).toBe(100000);
  });

  it('a later set-up save leaves a recorded letter’s signatures as they were', async () => {
    const settings = await fleetCustodyPapersService.getSettings();
    const before = await fleetCustodyFundService.operation(ids.charge1);
    const renamed = structuredClone(settings.papers);
    renamed.charge.blocks[0]!.name = 'اللواء / اسم آخر';
    await fleetCustodyPapersService.saveSettings(
      SaveFleetCustodyPaperSettingsSchema.parse({ papers: renamed }),
      ACTOR,
    );
    const after = await fleetCustodyFundService.operation(ids.charge1);
    expect(after.signatures).toEqual(before.signatures);
    expect(after.signatures.blocks[0]?.name).not.toBe('اللواء / اسم آخر');
  });

  it('every live custody receipt is spent from the fund — a card’s fuel and a deleted one never', async () => {
    const tyres1 = await plant([
      receiptRow('2026-09-01', 'tyres', 500),
      receiptRow('2026-09-05', 'tyres', 690),
      receiptRow('2026-09-10', 'tyres', 500),
    ]);
    const tyres2 = await plant([
      receiptRow('2026-09-16', 'tyres', 460),
      receiptRow('2026-09-27', 'tyres', 500),
    ]);
    const fuel3 = await plant([
      receiptRow('2026-09-01', 'fuel', 20000),
      receiptRow('2026-09-14', 'fuel', 15000),
      receiptRow('2026-09-28', 'fuel', 14844),
    ]);
    const maintenance4 = await plant([
      receiptRow('2026-09-02', 'maintenance', 5230),
      receiptRow('2026-09-03', 'maintenance', 490),
    ]);
    const maintenance5 = await plant([
      receiptRow('2026-09-15', 'maintenance', 20000),
      receiptRow('2026-09-27', 'maintenance', 3694),
    ]);
    ids.wash = await plant([
      receiptRow('2026-09-12', 'wash', 150),
      receiptRow('2026-09-19', 'wash', 150),
      receiptRow('2026-09-26', 'wash', 300),
    ]);
    // Never the fund's: a card paid it, or it was deleted.
    await plant([
      receiptRow('2026-09-03', 'fuel', 999, { source: 'card', cardId: new Types.ObjectId() }),
      receiptRow('2026-09-04', 'tyres', 777, { isDeleted: true, deletedAt: new Date() }),
    ]);
    const terms = await readCustodyFundTerms();
    expect(terms.spent).toEqual({ count: 15, amount: 82508 });
    expect(terms.fundTotal).toBe(17492);

    for (const [kind, receipts, name] of [
      ['tyres', tyres1, 'كاوتش النصف الأول من سبتمبر'],
      ['tyres', tyres2, ''],
      ['fuel', fuel3, 'وقود سبتمبر'],
      ['maintenance', maintenance4, ''],
      ['maintenance', maintenance5, 'صيانة آخر سبتمبر'],
    ] as const) {
      ids.memos.push((await memo(kind, receipts, name)).id);
    }
  });

  it('carries the fund, Σ شحن and Σ spent on the custody figures and dashboard — no filter moves them', async () => {
    for (const path of ['summary', 'dashboard']) {
      for (const query of [
        {},
        { vehicleCodes: 'لا-سيارة' },
        { from: '2001-01-01', to: '2001-01-31' },
      ]) {
        const res = await request(app)
          .get(`/api/v1/fleet/custody/${path}`)
          .query(query)
          .set('Authorization', `Bearer ${viewerToken}`);
        expect(res.status, `${path} ${JSON.stringify(query)}`).toBe(200);
        expect(data<FleetCustodySummaryDto>(res), `${path} ${JSON.stringify(query)}`).toMatchObject(
          {
            fundTotal: 17492,
            fundCharged: 100000,
            fundSpent: 82508,
          },
        );
      }
    }
  });
});

describe('«استعاضة عهدة»', () => {
  const candidatesCase = async (): Promise<void> => {
    // Late past 30 days by today's clock — the same cutoff the API reads, so the case ages well.
    const cutoff = custodyStaleCutoff(new Date());
    const candidates = await fleetCustodyFundService.replenishCandidates();
    expect(candidates.memos.map((row) => [row.no, row.kind, row.total])).toEqual([
      [1, 'tyres', 1690],
      [2, 'tyres', 960],
      [3, 'fuel', 49844],
      [4, 'maintenance', 5720],
      [5, 'maintenance', 23694],
    ]);
    const late = (
      [
        ['2026-09-12', 150],
        ['2026-09-19', 150],
        ['2026-09-26', 300],
      ] as const
    ).filter(([iso]) => day(iso).getTime() < cutoff.getTime());
    expect(candidates.outside.find((row) => row.kind === 'wash')).toEqual({
      kind: 'wash',
      count: 3,
      total: 600,
      oldest: '2026-09-12',
      stale: { count: late.length, total: sum(late.map(([, amount]) => amount)) },
    });
    expect(candidates).toMatchObject({ fundTotal: 17492, chargedTotal: 100000 });
  };

  it('offers the memos not replenished yet, oldest first, and the receipts in none', async () => {
    // The clock held still for the case, and the cutoff read before the service's: the case and
    // the service age the receipts from one and the same UTC day.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date() });
    try {
      await candidatesCase();
    } finally {
      vi.useRealTimers();
    }
  });

  it('brings the memos back with their totals, marks them with the letter’s day, and the fund rises', async () => {
    const op = await replenish({ date: '2026-09-29', memoIds: [...ids.memos].reverse() });
    ids.replenish = op.id;
    expect(op).toMatchObject({
      kind: 'replenish',
      date: '2026-09-29',
      // No period typed: whole months over the memos' periods.
      from: '2026-09-01',
      to: '2026-09-30',
      amount: 81908,
      reason: '',
      parts: [],
      fundBefore: 17492,
      chargedTotal: 100000,
      // «عهده اداره الحركه ( 100,000 )» — everything charged into the fund.
      letterFigure: 100000,
      ledger: { before: 17492, after: 99400 },
    });
    // The memos by number, as they were, whatever order they were picked in.
    expect(op.memos.map((row) => [row.no, row.kind, row.name, row.receipts, row.amount])).toEqual([
      [1, 'tyres', 'كاوتش النصف الأول من سبتمبر', 3, 1690],
      [2, 'tyres', '', 2, 960],
      [3, 'fuel', 'وقود سبتمبر', 3, 49844],
      [4, 'maintenance', '', 2, 5720],
      [5, 'maintenance', 'صيانة آخر سبتمبر', 2, 23694],
    ]);
    expect(op.memos[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-10' });
    expect(op.signatures).toEqual((await fleetCustodyPapersService.getSettings()).papers.replenish);
    for (const memoId of ids.memos) {
      const row = await fleetCustodyMemoService.get(memoId);
      expect(row.replenishment).toEqual({ id: op.id, date: '2026-09-29' });
    }
    expect(await fundNow()).toBe(99400);
  });

  it('freezes a replenished memo: no edit, no delete (422)', async () => {
    const one = await fleetCustodyMemoService.get(ids.memos[0]!);
    await expect(
      fleetCustodyMemoService.update(
        one.id,
        {
          kind: one.kind,
          name: 'اسم جديد',
          lines: one.lines.map((line) => ({
            receiptId: line.receiptId,
            mission: '',
            statement: '',
            note: '',
          })),
          version: one.version,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });
    await expect(fleetCustodyMemoService.remove(one.id, ACTOR)).rejects.toMatchObject({
      httpStatus: 422,
    });
  });

  it('refuses a memo already replenished (409) — and the whole letter with it', async () => {
    const wash = await memo('wash', ids.wash, 'غسيل سبتمبر');
    const operations = await FleetCustodyOperationModel.countDocuments().exec();
    const fund = await fundNow();
    await expect(replenish({ memoIds: [wash.id, ids.memos[0]] })).rejects.toMatchObject({
      httpStatus: 409,
    });
    expect(await FleetCustodyOperationModel.countDocuments().exec(), 'no operation').toBe(
      operations,
    );
    expect((await fleetCustodyMemoService.get(wash.id)).replenishment, 'nothing marked').toBeNull();
    expect(await fundNow()).toBe(fund);
    // A memo that does not exist is 404.
    await expect(replenish({ memoIds: [new Types.ObjectId().toString()] })).rejects.toMatchObject({
      httpStatus: 404,
    });
    // The washing memo stays pending for the cases below.
    ids.memos.push(wash.id);
  });
});

describe('«تسوية عهدة» and the licensing memos it locks', () => {
  beforeAll(async () => {
    const lx1 = await licence(
      '2026-09-08',
      half(
        [
          { vehicleId: String(cars.a), plate: 'س ص 207' },
          { vehicleId: String(cars.b), plate: 'س ص 282' },
          ...plates(3),
        ],
        33450,
        6282.19,
      ),
      null,
    );
    const lx2 = await licence('2026-09-17', half(plates(5), 30900, 5868.85), null);
    const lx3 = await licence('2026-09-28', half(plates(5), 40125, 7513.42), null);
    const lx4 = await licence('2026-10-01', null, half(plates(23), 34500, 6750));
    const lx5 = await licence(
      '2026-10-03',
      half([{ vehicleId: String(cars.c), plate: '' }, ...plates(3)], 24000, 4410.75),
      half(plates(2), 1000, 250),
    );
    ids.lx = { lx1: lx1.id, lx2: lx2.id, lx3: lx3.id, lx4: lx4.id, lx5: lx5.id };
    // A second «شحن العهدة» on 05/10, before the settlement that day.
    await charge({
      date: '2026-10-05',
      amount: 200000,
      reason: '24 سياره تجديد + 23 سياره مد مده',
    });
  });

  it('offers every memo not settled yet — one row per memo, day ascending, renewal first — with no licensing grant', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/custody/fund/settle/candidates')
      .set('Authorization', `Bearer ${writerToken}`);
    expect(res.status).toBe(200);
    const candidates = data<FleetCustodySettleCandidatesDto>(res);
    expect(candidates.parts.map((row) => [row.expenseId, row.part, row.date])).toEqual([
      [ids.lx.lx1, 'renewal', '2026-09-08'],
      [ids.lx.lx2, 'renewal', '2026-09-17'],
      [ids.lx.lx3, 'renewal', '2026-09-28'],
      [ids.lx.lx4, 'extension', '2026-10-01'],
      [ids.lx.lx5, 'renewal', '2026-10-03'],
      [ids.lx.lx5, 'extension', '2026-10-03'],
    ]);
    expect(candidates.parts[0]).toMatchObject({
      cars: 5,
      // The registry's codes, a hand-typed plate where there is none.
      codes: ['207', '282', 'ل ت 1', 'ل ت 2', 'ل ت 3'],
      visaTotal: 33450,
      cashTotal: 6282.19,
      total: 39732.19,
    });
    expect(candidates.parts[0]?.expense).toMatchObject({ id: ids.lx.lx1, date: '2026-09-08' });
    expect(candidates.parts[4]?.codes, 'a car with no plate typed').toEqual([
      '177',
      'ل ت 1',
      'ل ت 2',
      'ل ت 3',
    ]);
    expect(candidates.fundTotal).toBe(299400);
  });

  it('takes the memos off with what they cost, and settles each memo on its own', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/custody/fund/settle')
      .set('Authorization', `Bearer ${writerToken}`)
      .send({
        date: '2026-10-05',
        parts: [
          { expenseId: ids.lx.lx3, part: 'renewal' },
          { expenseId: ids.lx.lx1, part: 'renewal' },
          { expenseId: ids.lx.lx2, part: 'renewal' },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const op = data<FleetCustodyOperationDto>(res);
    ids.settle = op.id;
    expect(op).toMatchObject({
      kind: 'settle',
      date: '2026-10-05',
      from: '2026-09-01',
      to: '2026-09-30',
      amount: 124139.46,
      fundBefore: 299400,
      chargedTotal: 300000,
      // «من العهده ( X )» — the fund just before it.
      letterFigure: 299400,
      ledger: { before: 299400, after: 175260.54 },
    });
    expect(op.parts.map((row) => [row.expenseId, row.date, row.cars, row.amount])).toEqual([
      [ids.lx.lx1, '2026-09-08', 5, 39732.19],
      [ids.lx.lx2, '2026-09-17', 5, 36768.85],
      [ids.lx.lx3, '2026-09-28', 5, 47638.42],
    ]);
    expect(await fundNow()).toBe(175260.54);

    const settled = await fleetLicenseExpenseService.get(ids.lx.lx1);
    expect(settled.renewal?.settlement).toEqual({ operationId: op.id, date: '2026-10-05' });
    expect(settled.extension).toBeNull();
    const waiting = await fleetLicenseExpenseService.get(ids.lx.lx5);
    expect(waiting.renewal?.settlement).toBeNull();
    expect(waiting.extension?.settlement).toBeNull();
  });

  it('filters by «التسوية», with and without «النوع»', async () => {
    const list = async (raw: Record<string, unknown>) =>
      (
        await fleetLicenseExpenseService.list(
          ListFleetLicenseExpensesQuerySchema.parse({
            from: '2026-09-01',
            to: '2026-10-31',
            ...raw,
          }),
        )
      ).items
        .map((row) => row.id)
        .sort();
    const sorted = (...values: string[]) => [...values].sort();
    expect(await list({ status: 'settled' })).toEqual(sorted(ids.lx.lx1, ids.lx.lx2, ids.lx.lx3));
    expect(await list({ status: 'waiting' })).toEqual(sorted(ids.lx.lx4, ids.lx.lx5));
    expect(await list({ status: 'waiting', kind: 'renewal' })).toEqual(sorted(ids.lx.lx5));
    expect(await list({ status: 'settled', kind: 'extension' })).toEqual([]);
    // The figures read the same rows.
    const totals = await fleetLicenseExpenseService.summary(
      FleetLicenseExpenseSummaryQuerySchema.parse({ status: 'settled' }),
    );
    expect(totals).toMatchObject({ count: 3, visaTotal: 104475, cashTotal: 19664.46 });
  });

  it('locks a settled record — no edit, no delete (422)', async () => {
    const before = await fleetLicenseExpenseService.get(ids.lx.lx1);
    await expect(
      fleetLicenseExpenseService.update(
        ids.lx.lx1,
        UpdateFleetLicenseExpenseSchema.parse({
          date: before.date,
          renewal: { vehicles: [], items: [] },
          extension: null,
          signatures: before.signatures,
          version: before.version,
        }),
        ACTOR,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });
    await expect(fleetLicenseExpenseService.remove(ids.lx.lx1, ACTOR)).rejects.toMatchObject({
      httpStatus: 422,
    });
    const raw = await FleetLicenseExpenseModel.findById(ids.lx.lx1).lean().exec();
    expect(raw?.isDeleted).toBe(false);
    expect(raw?.renewal?.items).toHaveLength(2);
  });

  it('refuses a memo already settled (409) — and the whole letter with it', async () => {
    const fund = await fundNow();
    await expect(
      settle({
        parts: [
          { expenseId: ids.lx.lx4, part: 'extension' },
          { expenseId: ids.lx.lx1, part: 'renewal' },
        ],
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect((await fleetLicenseExpenseService.get(ids.lx.lx4)).extension?.settlement).toBeNull();
    expect(await fundNow()).toBe(fund);
    // A memo the record does not hold is 404.
    await expect(
      settle({ parts: [{ expenseId: ids.lx.lx1, part: 'extension' }] }),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('«سجل العهدة» — his scenario, row for row', () => {
  beforeAll(async () => {
    ids.october = await plant([
      receiptRow('2026-10-06', 'tyres', 900),
      receiptRow('2026-10-18', 'tyres', 790),
      receiptRow('2026-10-06', 'fuel', 7876),
      receiptRow('2026-10-08', 'maintenance', 5720),
    ]);
  });

  it('folds the six rows of the sample, newest first, «بعدها» over the whole history', async () => {
    const rows = await ledgerAll();
    expect(rows.map((row) => [row.op, row.date, row.dateTo, row.amount, row.after])).toEqual([
      ['spend', '2026-10-06', '2026-10-18', -15286, 159974.54],
      ['settle', '2026-10-05', null, -124139.46, 175260.54],
      ['charge', '2026-10-05', null, 200000, 299400],
      ['replenish', '2026-09-29', null, 81908, 99400],
      ['spend', '2026-09-01', '2026-09-28', -82508, 17492],
      ['charge', '2026-09-01', null, 100000, 100000],
    ]);
    expect(rows.map((row) => row.latest)).toEqual([true, false, false, false, false, false]);
    // The top row's «بعدها» IS the fund.
    expect(rows[0]?.after).toBe(await fundNow());
    expect(rows[4]).toMatchObject({
      receipts: 15,
      memoNos: [1, 2, 3, 4, 5, 6],
      byKind: {
        maintenance: { count: 4, amount: 29414, outside: 0 },
        fuel: { count: 3, amount: 49844, outside: 0 },
        tyres: { count: 5, amount: 2650, outside: 0 },
        wash: { count: 3, amount: 600, outside: 0 },
      },
    });
    expect(rows[0]?.byKind?.tyres).toEqual({ count: 2, amount: 1690, outside: 2 });
    expect(rows[3]).toMatchObject({ memos: { count: 5, kinds: ['maintenance', 'fuel', 'tyres'] } });
    expect(rows[1]?.licence).toEqual({
      renewal: { count: 3, cars: 15 },
      extension: { count: 0, cars: 0 },
    });
    expect(rows[5]?.reason).toBe('تشغيل السيارات لشهر سبتمبر');
  });

  it('filters and pages over HTTP without changing a row, and counts the same rows', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/custody/fund/ledger')
      .query({ op: 'charge,settle', sort: 'date:asc', pageSize: '2' })
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetCustodyLedgerRowDto[]>(res).map((row) => [row.op, row.after])).toEqual([
      ['charge', 100000],
      ['charge', 299400],
    ]);
    expect((res.body as { meta: { totalItems: number } }).meta.totalItems).toBe(3);
    const window = await ledgerAll({ from: '2026-09-20', to: '2026-09-30' });
    expect(window.map((row) => row.op)).toEqual(['replenish', 'spend']);
    const summary = await request(app)
      .get('/api/v1/fleet/custody/fund/ledger/summary')
      .query({ from: '2026-10-01' })
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(summary.status).toBe(200);
    expect(data<FleetCustodyLedgerTotalsDto>(summary)).toEqual({ operations: 2, spendLines: 1 });
  });

  it('places each operation in the fund, and the fund summary adds up', async () => {
    expect((await fleetCustodyFundService.operation(ids.replenish)).ledger).toEqual({
      before: 17492,
      after: 99400,
    });
    const res = await request(app)
      .get('/api/v1/fleet/custody/fund/summary')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetCustodyFundSummaryDto>(res)).toMatchObject({
      fundTotal: 159974.54,
      charged: { count: 2, amount: 300000 },
      spent: { count: 19, amount: 97794 },
      replenished: { count: 1, amount: 81908, memos: 5 },
      settled: { count: 1, amount: 124139.46, parts: 3 },
      operations: 4,
      // Memo 6 (washing) waits for its replenishment.
      memos: { count: 6, pending: 1, pendingTotal: 600 },
    });
    // October's receipts are in no memo: each kind's oldest day; washing has none left outside.
    expect(
      data<FleetCustodyFundSummaryDto>(res).outside.map((row) => [
        row.kind,
        row.count,
        row.total,
        row.oldest,
      ]),
    ).toEqual([
      ['maintenance', 1, 5720, '2026-10-08'],
      ['fuel', 1, 7876, '2026-10-06'],
      ['tyres', 2, 1690, '2026-10-06'],
      ['wash', 0, 0, null],
    ]);
    expect(data<FleetCustodyFundSummaryDto>(res).outside[3]?.stale).toEqual({ count: 0, total: 0 });
  });
});

describe('the dashboard’s spend against the memos — «تمت الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات»', () => {
  const board = async (query: Record<string, string> = {}): Promise<FleetCustodyDashboardDto> => {
    const res = await request(app)
      .get('/api/v1/fleet/custody/dashboard')
      .query(query)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status, JSON.stringify(query)).toBe(200);
    return data<FleetCustodyDashboardDto>(res);
  };
  const pair = (count: number, amount: number): FleetCustodyCountAmountDto => ({ count, amount });
  const none = pair(0, 0);
  const kinds = ['maintenance', 'fuel', 'tyres', 'wash'] as const;
  /** Every way the states are cut adds up to the board's own figures for the same filters. */
  const addsUp = (dto: FleetCustodyDashboardDto, label: string): void => {
    const states = Object.values(dto.memoStates);
    expect(
      states.reduce((n, state) => n + state.count, 0),
      label,
    ).toBe(dto.count);
    expect(sum(states.map((state) => state.amount)), label).toBe(dto.total);
    for (const kind of kinds) {
      expect(
        states.reduce((n, state) => n + state.byKind[kind].count, 0),
        `${label} ${kind}`,
      ).toBe(dto.counts[kind]);
      expect(sum(states.map((state) => state.byKind[kind].amount)), `${label} ${kind}`).toBe(
        dto[kind],
      );
    }
  };
  /** Over no filter, the three are the fund's own figures. */
  const matchesFund = async (): Promise<void> => {
    const [whole, fund] = await Promise.all([board(), fleetCustodyFundService.summary()]);
    expect(whole.memoStates.replenished.amount).toBe(fund.replenished.amount);
    expect(whole.memoStates.pending.amount).toBe(fund.memos.pendingTotal);
    expect(whole.memoStates.outside.amount).toBe(sum(fund.outside.map((row) => row.total)));
    expect(whole.memoStates.outside.count).toBe(fund.outside.reduce((n, row) => n + row.count, 0));
    addsUp(whole, 'no filter');
  };

  it('over no filter: Σ «استعاضة», the memo waiting, and October in no memo — the fund’s figures', async () => {
    expect((await board()).memoStates).toEqual({
      replenished: {
        count: 12,
        amount: 81908,
        byKind: {
          maintenance: pair(4, 29414),
          fuel: pair(3, 49844),
          tyres: pair(5, 2650),
          wash: none,
        },
      },
      pending: {
        count: 3,
        amount: 600,
        byKind: { maintenance: none, fuel: none, tyres: none, wash: pair(3, 600) },
      },
      outside: {
        count: 4,
        amount: 15286,
        byKind: {
          maintenance: pair(1, 5720),
          fuel: pair(1, 7876),
          tyres: pair(2, 1690),
          wash: none,
        },
      },
    });
    await matchesFund();
  });

  it('follows the board’s filters like every other spend figure — the kinds, the dates, the cars', async () => {
    const kindsOnly = await board({ source: 'tyres,wash' });
    expect(
      Object.fromEntries(
        Object.entries(kindsOnly.memoStates).map(([state, line]) => [
          state,
          [line.count, line.amount],
        ]),
      ),
    ).toEqual({ replenished: [5, 2650], pending: [3, 600], outside: [2, 1690] });
    expect(kindsOnly.memoStates.replenished.byKind.fuel).toEqual(none);
    addsUp(kindsOnly, 'tyres,wash');

    const october = await board({ from: '2026-10-01' });
    expect(october.memoStates.replenished).toMatchObject({ count: 0, amount: 0 });
    expect(october.memoStates.pending).toMatchObject({ count: 0, amount: 0 });
    expect(october.memoStates.outside).toMatchObject({ count: 4, amount: 15286 });
    addsUp(october, 'October');

    // 10/09–19/09: tyres 500 and 460, fuel 15000, maintenance 20000 — all replenished; two washes.
    const window = await board({ from: '2026-09-10', to: '2026-09-19' });
    expect(window.memoStates.replenished).toMatchObject({ count: 4, amount: 35960 });
    expect(window.memoStates.pending).toMatchObject({
      count: 2,
      amount: 300,
      byKind: { wash: pair(2, 300) },
    });
    expect(window.memoStates.outside).toMatchObject({ count: 0, amount: 0 });
    addsUp(window, '10/09–19/09');

    // A car with no receipts: every state there, all zeros.
    const empty = await board({ vehicleCodes: CODES.b });
    for (const state of ['replenished', 'pending', 'outside'] as const) {
      expect(empty.memoStates[state], state).toEqual({
        count: 0,
        amount: 0,
        byKind: { maintenance: none, fuel: none, tyres: none, wash: none },
      });
    }
  });

  it('moves a receipt as its memo moves: outside → waiting → back on a delete → replenished', async () => {
    const fuel = ids.october[2]!; // 06/10, fuel 7,876.00 — in no memo
    const states = async () => (await board({ source: 'fuel', from: '2026-10-01' })).memoStates;
    expect(await states()).toMatchObject({
      replenished: { count: 0 },
      pending: { count: 0 },
      outside: { count: 1, amount: 7876 },
    });

    const waiting = await memo('fuel', [fuel]);
    expect(await states()).toMatchObject({
      replenished: { count: 0 },
      pending: { count: 1, amount: 7876, byKind: { fuel: pair(1, 7876) } },
      outside: { count: 0, amount: 0 },
    });
    await matchesFund();

    // A soft delete frees the receipt: outside again.
    await fleetCustodyMemoService.remove(waiting.id, ACTOR);
    expect(await states()).toMatchObject({
      pending: { count: 0 },
      outside: { count: 1, amount: 7876 },
    });

    const again = await memo('fuel', [fuel]);
    await replenish({ memoIds: [again.id] });
    expect(await states()).toMatchObject({
      replenished: { count: 1, amount: 7876, byKind: { fuel: pair(1, 7876) } },
      pending: { count: 0, amount: 0 },
      outside: { count: 0, amount: 0 },
    });
    await matchesFund();
  });
});

describe('races — the second of two at once always sees the first', () => {
  it('two replenishments of one memo: exactly one is recorded', async () => {
    const wash = ids.memos[5]!;
    const operations = await FleetCustodyOperationModel.countDocuments().exec();
    const results = await Promise.allSettled([
      replenish({ memoIds: [wash] }),
      replenish({ memoIds: [wash] }),
    ]);
    expect(results.map(statusOf).sort()).toEqual([409, 'ok']);
    expect(await FleetCustodyOperationModel.countDocuments().exec()).toBe(operations + 1);
    const ops = await FleetCustodyOperationModel.find({ 'memos.memoId': new Types.ObjectId(wash) })
      .lean()
      .exec();
    expect(ops).toHaveLength(1);
  });

  it('two settlements of one memo: exactly one is recorded', async () => {
    const before = await fundNow();
    const results = await Promise.allSettled([
      settle({ parts: [{ expenseId: ids.lx.lx5, part: 'renewal' }] }),
      settle({ parts: [{ expenseId: ids.lx.lx5, part: 'renewal' }] }),
    ]);
    expect(results.map(statusOf).sort()).toEqual([409, 'ok']);
    expect(await fundNow()).toBe(sum([before, -28410.75]));
    const ops = await FleetCustodyOperationModel.find({
      'parts.expenseId': new Types.ObjectId(ids.lx.lx5),
    })
      .lean()
      .exec();
    expect(ops).toHaveLength(1);
    // The extension of the same record is still offered — each memo settles on its own…
    const candidates = await fleetCustodyFundService.settleCandidates();
    expect(
      candidates.parts.filter((row) => row.expenseId === ids.lx.lx5).map((row) => row.part),
    ).toEqual(['extension']);
    // …while the record itself is locked, and reads as both waiting and settled.
    const list = async (status: 'waiting' | 'settled', kind?: 'extension') =>
      (
        await fleetLicenseExpenseService.list(
          ListFleetLicenseExpensesQuerySchema.parse({ status, ...(kind ? { kind } : {}) }),
        )
      ).items.map((row) => row.id);
    expect(await list('waiting')).toContain(ids.lx.lx5);
    expect(await list('settled')).toContain(ids.lx.lx5);
    expect(await list('waiting', 'extension')).toContain(ids.lx.lx5);
    await expect(fleetLicenseExpenseService.remove(ids.lx.lx5, ACTOR)).rejects.toMatchObject({
      httpStatus: 422,
    });
  });

  it('deleting a memo while it is replenished: one wins, and the other is refused', async () => {
    const lone = await memo('tyres', [ids.october[0]!]);
    const results = await Promise.allSettled([
      fleetCustodyMemoService.remove(lone.id, ACTOR),
      replenish({ memoIds: [lone.id] }),
    ]);
    const [removed, replenished] = results.map(statusOf);
    const raw = await FleetCustodyMemoModel.findById(lone.id).lean().exec();
    const ops = await FleetCustodyOperationModel.find({
      'memos.memoId': new Types.ObjectId(lone.id),
    })
      .lean()
      .exec();
    if (removed === 'ok') {
      expect(replenished, 'a deleted memo is not found').toBe(404);
      expect(raw?.isDeleted).toBe(true);
      expect(ops).toHaveLength(0);
      // Its receipt is free again.
      const receipt = await FleetReceiptModel.findById(ids.october[0]).lean().exec();
      expect(receipt?.memoId ?? null).toBeNull();
    } else {
      expect(replenished).toBe('ok');
      expect(removed, 'a replenished memo stays').toBe(422);
      expect(raw?.isDeleted).toBe(false);
      expect(raw?.replenishmentId).not.toBeNull();
      expect(ops).toHaveLength(1);
    }
  });

  it('a licensing edit racing its settlement: the letter always prints what is stored', async () => {
    const record = await licence('2026-10-10', half(plates(2), 500, 50), null);
    const edit = UpdateFleetLicenseExpenseSchema.parse({
      date: record.date,
      renewal: half(plates(3), 700, 70),
      extension: null,
      signatures: record.signatures,
      version: record.version,
    });
    const results = await Promise.allSettled([
      fleetLicenseExpenseService.update(record.id, edit, ACTOR),
      settle({ parts: [{ expenseId: record.id, part: 'renewal' }] }),
    ]);
    const [edited, settled] = results.map(statusOf);
    expect(settled).toBe('ok');
    // The edit landed first (200) or met the lock (422) / a moved version (409) — never a lost write.
    expect([200, 'ok', 409, 422]).toContain(edited);
    const stored = await FleetLicenseExpenseModel.findById(record.id).lean().exec();
    const op = (results[1] as PromiseFulfilledResult<FleetCustodyOperationDto>).value;
    expect(op.amount).toBe(partMoney(stored?.renewal).total);
    expect(op.parts[0]?.cars).toBe(stored?.renewal?.vehicles.length);
    expect(edited === 'ok' ? 770 : 550).toBe(op.amount);
  });

  it('a settlement larger than the fund goes through, and the fund goes negative', async () => {
    const big = await licence('2026-10-12', half(plates(1), 900000, 0), null);
    const before = await fundNow();
    const op = await settle({ parts: [{ expenseId: big.id, part: 'renewal' }] });
    expect(op.letterFigure).toBe(before);
    expect(await fundNow()).toBe(sum([before, -900000]));
    expect(await fundNow()).toBeLessThan(0);
    const rows = await ledgerAll();
    expect(rows[0]).toMatchObject({ latest: true, after: await fundNow() });
  });

  it('two charges at once never print the same «إجمالي العهدة قبلها»', async () => {
    const results = await Promise.all([charge({ amount: 10 }), charge({ amount: 20 })]);
    const [first, second] = [...results].sort((a, b) => a.fundBefore - b.fundBefore);
    expect(second!.fundBefore).toBe(sum([first!.fundBefore, first!.amount]));
    expect(second!.chargedTotal).toBe(sum([first!.chargedTotal, first!.amount]));
  });
});

describe('the routes and their grants', () => {
  it('reads with the custody grant alone; a letter needs the receipts’ create grant too', async () => {
    for (const path of [
      '/summary',
      '/ledger',
      '/ledger/summary',
      '/replenish/candidates',
      '/settle/candidates',
      `/operations/${ids.charge1}`,
    ]) {
      const res = await request(app)
        .get(`/api/v1/fleet/custody/fund${path}`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status, path).toBe(200);
      const without = await request(app)
        .get(`/api/v1/fleet/custody/fund${path}`)
        .set('Authorization', `Bearer ${receiptOnlyToken}`);
      expect(without.status, `${path} without the custody grant`).toBe(403);
    }
    const replenishCandidates = await request(app)
      .get('/api/v1/fleet/custody/fund/replenish/candidates')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(data<FleetCustodyReplenishCandidatesDto>(replenishCandidates).memos).toEqual([]);

    for (const [path, body] of [
      ['/charge', { amount: 5 }],
      ['/replenish', { memoIds: [ids.memos[0]] }],
      ['/settle', { parts: [{ expenseId: ids.lx.lx4, part: 'extension' }] }],
    ] as const) {
      for (const token of [viewerToken, receiptOnlyToken]) {
        const res = await request(app)
          .post(`/api/v1/fleet/custody/fund${path}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body);
        expect(res.status, path).toBe(403);
      }
    }
    const refused = await request(app)
      .post('/api/v1/fleet/custody/fund/charge')
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ reason: 'بلا مبلغ' });
    expect(refused.status, 'the amount is required').toBe(400);
    const res = await request(app)
      .post('/api/v1/fleet/custody/fund/charge')
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ amount: 1250.5 });
    expect(res.status).toBe(201);
    const op = data<FleetCustodyOperationDto>(res);
    // No date typed: today; no reason: ''. Its names are the set-up's as saved above.
    expect(op).toMatchObject({
      amount: 1250.5,
      reason: '',
      date: new Date().toISOString().slice(0, 10),
    });
    expect(op.signatures.blocks[0]?.name).toBe('اللواء / اسم آخر');
    expect(op.ledger !== null && sum([op.ledger.after, -op.ledger.before])).toBe(1250.5);
    const missing = await request(app)
      .get(`/api/v1/fleet/custody/fund/operations/${new Types.ObjectId().toString()}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(missing.status).toBe(404);
  });

  it('a settled licensing record answers 422 to its own routes’ edit and delete', async () => {
    const record = await fleetLicenseExpenseService.get(ids.lx.lx1);
    const patch = await request(app)
      .patch(`/api/v1/fleet/license-expenses/${ids.lx.lx1}`)
      .set('Authorization', `Bearer ${licenceEditorToken}`)
      .send({
        date: record.date,
        renewal: null,
        extension: { vehicles: [], items: [] },
        signatures: record.signatures,
        version: record.version,
      });
    expect(patch.status, JSON.stringify(patch.body)).toBe(422);
    const remove = await request(app)
      .delete(`/api/v1/fleet/license-expenses/${ids.lx.lx1}`)
      .set('Authorization', `Bearer ${licenceEditorToken}`);
    expect(remove.status).toBe(422);
    // A record not settled answers as it always did.
    const open = await fleetLicenseExpenseService.get(ids.lx.lx4);
    const fine = await request(app)
      .patch(`/api/v1/fleet/license-expenses/${ids.lx.lx4}`)
      .set('Authorization', `Bearer ${licenceEditorToken}`)
      .send({
        date: open.date,
        renewal: null,
        extension: half(plates(23), 34500, 6750),
        signatures: open.signatures,
        version: open.version,
      });
    expect(fine.status, JSON.stringify(fine.body)).toBe(200);
    expect(data<FleetLicenseExpenseDto>(fine).extension?.settlement).toBeNull();
  });
});

describe('the audit trail', () => {
  it('records each operation, each replenished memo and each settled record', async () => {
    const operations = await AuditLogModel.find({
      'entityRef.entityType': 'custodyOperation',
      action: 'create',
    })
      .lean()
      .exec();
    expect(operations.length).toBe(await FleetCustodyOperationModel.countDocuments().exec());
    const memoChange = await AuditLogModel.findOne({
      'entityRef.entityType': 'custodyMemo',
      'entityRef.entityId': ids.memos[0],
      action: 'statusChange',
    })
      .lean()
      .exec();
    expect(memoChange?.changes).toEqual([
      { field: 'replenishmentId', old: null, new: ids.replenish },
      { field: 'replenishedAt', old: null, new: '2026-09-29' },
    ]);
    const settled = await AuditLogModel.findOne({
      'entityRef.entityType': 'licenseExpense',
      'entityRef.entityId': ids.lx.lx1,
      action: 'statusChange',
    })
      .lean()
      .exec();
    expect(settled?.changes).toEqual([
      {
        field: 'renewalSettlement',
        old: null,
        new: { operationId: ids.settle, settledAt: '2026-10-05' },
      },
    ]);
  });
});

describe('no migration', () => {
  it('a licensing record from before settlements reads as waiting, is offered, and stays writable', async () => {
    const id = new Types.ObjectId();
    await FleetLicenseExpenseModel.collection.insertOne({
      _id: id,
      date: day('2025-05-05'),
      renewal: { vehicles: [], items: [] },
      extension: null,
      signatures: { agent: '', director: '', generalManager: '' },
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      schemaVersion: 1,
      __v: 0,
      createdAt: day('2025-05-05'),
      updatedAt: day('2025-05-05'),
    });
    const dto = await fleetLicenseExpenseService.get(String(id));
    expect(dto.renewal?.settlement).toBeNull();
    const waiting = await fleetLicenseExpenseService.list(
      ListFleetLicenseExpensesQuerySchema.parse({
        status: 'waiting',
        from: '2025-05-01',
        to: '2025-05-31',
      }),
    );
    expect(waiting.items.map((row) => row.id)).toEqual([String(id)]);
    expect(
      (await fleetCustodyFundService.settleCandidates()).parts.some(
        (row) => row.expenseId === String(id),
      ),
    ).toBe(true);
    const edited = await fleetLicenseExpenseService.update(
      String(id),
      UpdateFleetLicenseExpenseSchema.parse({
        date: '2025-05-06',
        renewal: { vehicles: [], items: [] },
        extension: null,
        signatures: dto.signatures,
        version: dto.version,
      }),
      ACTOR,
    );
    expect(edited.date).toBe('2025-05-06');
  });
});
