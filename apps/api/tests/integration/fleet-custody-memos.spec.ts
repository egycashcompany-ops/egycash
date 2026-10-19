// «المذكرات» against a real mongo — the custody memos over the custody receipts:
//
//   1. a memo takes its receipts (only live custody receipts of its kind that no memo holds), one
//      running number across the four kinds, its period from its receipts' days, a snapshot of its
//      paper's signatures; a refused memo uses up no number;
//   2. two memos at once: distinct consecutive numbers, and one receipt never lands on both;
//   3. an edit claims and frees receipts, keeps its kind and its signatures, is versioned;
//   4. a delete is soft — the row stays, its receipts come back, its number is never reused;
//   5. the editor's candidates, with «المأمورية» suggested from the roster, the crew, the car;
//   6. the receipts screen: a receipt on a memo keeps its kind and payment and stays; once the
//      memo is replenished its amount, date and car stay too — a driver change still goes through;
//   7. who may do what, over HTTP; 8. the audit trail; 9. rows from before memos existed.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  CreateFleetCustodyMemoSchema,
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  UpdateFleetCustodyMemoSchema,
  type FleetCustodyMemoCandidatesDto,
  type FleetCustodyMemoDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyMemoTotalsDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySource,
  type FleetReceiptDto,
  type Paginated,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetDutyAssignmentModel } from '../../src/modules/fleet/roster/duty-assignment.model';
import { FleetFixedCrewModel } from '../../src/modules/fleet/fixed-roster/fixed-crew.model';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import {
  CUSTODY_MEMO_COUNTER,
  FleetCustodyCounterModel,
} from '../../src/modules/fleet/custody/custody-counter.model';
import { fleetCustodyMemoRepository } from '../../src/modules/fleet/custody/custody-memo.repository';
import {
  ensureCustodyMemoCounter,
  fleetCustodyMemoService,
} from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyPapersService } from '../../src/modules/fleet/custody/custody-papers.service';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let actor = '';
const tokens: Record<
  'viewer' | 'creator' | 'editor' | 'deleter' | 'clerk' | 'receiptsOnly',
  string
> = { viewer: '', creator: '', editor: '', deleter: '', clerk: '', receiptsOnly: '' };
let typeId: Types.ObjectId;
let branchId: Types.ObjectId;
let carCounter = 300;

const MEMOS = '/api/v1/fleet/custody/memos';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-custody-memos-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

/** A user holding exactly `keys`, and a token signed for them (no login spent). */
const tokenWith = async (email: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: email, ar: email }, permissionKeys: keys },
    actor,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);
};

/** A registry car — written directly: the registry is not what this file is about. */
const mkCar = async (over: Record<string, unknown> = {}): Promise<Types.ObjectId> => {
  const n = carCounter++;
  const car = await FleetVehicleModel.create({
    code: String(n),
    typeId,
    plateNumber: `س ص ${n}`,
    chassisNumber: `CH-MEMO-${n}`,
    motorNumber: `MO-MEMO-${n}`,
    joinedAt: new Date('2024-01-01T00:00:00Z'),
    licenseExpiresAt: new Date('2028-01-01T00:00:00Z'),
    branchId,
    ...over,
  });
  return car._id as Types.ObjectId;
};

let sharedCar: Types.ObjectId | null = null;
const someCar = async (): Promise<Types.ObjectId> => {
  sharedCar ??= await mkCar();
  return sharedCar;
};

/** A receipt as the receipts screen writes it — directly, so each test sets exactly its facts. */
const mkReceipt = async (
  over: {
    kind?: FleetCustodySource;
    amount?: number;
    date?: string;
    source?: 'custody' | 'card';
    vehicleId?: Types.ObjectId;
    isDeleted?: boolean;
    driverName?: string | null;
  } = {},
): Promise<string> => {
  const kind = over.kind ?? 'tyres';
  const source = over.source ?? 'custody';
  const row = await FleetReceiptModel.create({
    date: new Date(`${over.date ?? '2026-09-10'}T00:00:00.000Z`),
    vehicleId: over.vehicleId ?? (await someCar()),
    driverEmployeeId: null,
    driverName: over.driverName ?? 'سائق',
    kind,
    source,
    cardId: source === 'card' ? new Types.ObjectId() : null,
    fuelType: kind === 'fuel' ? 'diesel' : null,
    pricePerLitre: null,
    litres: null,
    amount: over.amount ?? 100,
    image: null,
    isDeleted: over.isDeleted ?? false,
  });
  return String(row._id);
};

const lines = (ids: readonly string[]) => ids.map((receiptId) => ({ receiptId }));
const createMemo = (body: Record<string, unknown>) =>
  fleetCustodyMemoService.create(CreateFleetCustodyMemoSchema.parse(body), actor);
const memoOf = async (receiptId: string) =>
  (await FleetReceiptModel.findById(receiptId).lean().exec())?.memoId ?? null;

/** What a «استعاضة عهدة» does to its memos — the fund's own call, in a transaction of its own. */
const replenish = async (memoId: string, day: string): Promise<number> => {
  const session = await FleetCustodyMemoModel.startSession();
  try {
    let marked = 0;
    await session.withTransaction(async () => {
      marked = await fleetCustodyMemoRepository.markReplenished(
        [memoId],
        new Types.ObjectId(),
        new Date(`${day}T00:00:00.000Z`),
        actor,
        session,
      );
    });
    return marked;
  } finally {
    await session.endSession();
  }
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  actor = await mkUser('memos-actor@ecms.local');
  typeId = new Types.ObjectId();
  branchId = new Types.ObjectId();
  tokens.viewer = await tokenWith('memos-viewer@ecms.local', ['fleetCustody.view']);
  tokens.creator = await tokenWith('memos-creator@ecms.local', [
    'fleetCustody.view',
    'fleetReceipt.create',
  ]);
  tokens.editor = await tokenWith('memos-editor@ecms.local', [
    'fleetCustody.view',
    'fleetReceipt.edit',
  ]);
  tokens.deleter = await tokenWith('memos-deleter@ecms.local', [
    'fleetCustody.view',
    'fleetReceipt.delete',
  ]);
  tokens.clerk = await tokenWith('memos-clerk@ecms.local', [
    'fleetCustody.view',
    'fleetReceipt.view',
    'fleetReceipt.create',
    'fleetReceipt.edit',
    'fleetReceipt.delete',
  ]);
  tokens.receiptsOnly = await tokenWith('memos-receipts@ecms.local', [
    'fleetReceipt.view',
    'fleetReceipt.create',
    'fleetReceipt.edit',
    'fleetReceipt.delete',
  ]);
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the database side is in place at boot', () => {
  it('builds the memo indexes and seeds the counter after them', async () => {
    const names = (await FleetCustodyMemoModel.collection.indexes()).map((index) => index.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'ux_custody_memo_no',
        'ux_custody_memo_receipt',
        'ix_custody_memo_period',
        'ix_custody_memo_replenishment',
      ]),
    );
    const counterIndexes = (await FleetCustodyCounterModel.collection.indexes()).map((i) => i.name);
    expect(counterIndexes).toContain('ux_custody_counter_key');
    const receiptIndexes = (await FleetReceiptModel.collection.indexes()).map((i) => i.name);
    expect(receiptIndexes).toContain('ix_receipt_custody_memo');
    expect(
      await FleetCustodyCounterModel.countDocuments({ key: CUSTODY_MEMO_COUNTER }).exec(),
    ).toBe(1);
  });
});

describe('creating a memo', () => {
  it('one running number across the kinds; the receipts are taken; the period is their days', async () => {
    const t1 = await mkReceipt({ kind: 'tyres', amount: 600, date: '2026-09-03' });
    const t2 = await mkReceipt({ kind: 'tyres', amount: 1090.5, date: '2026-09-01' });
    const w1 = await mkReceipt({ kind: 'wash', amount: 150, date: '2026-09-02' });

    const tyres = await createMemo({ kind: 'tyres', name: '   ', lines: lines([t1, t2]) });
    const wash = await createMemo({ kind: 'wash', name: 'غسيل سبتمبر', lines: lines([w1]) });

    expect(wash.no).toBe(tyres.no + 1);
    expect(tyres).toMatchObject({
      kind: 'tyres',
      name: '',
      from: '2026-09-01',
      to: '2026-09-03',
      receipts: 2,
      total: 1690.5,
      replenishment: null,
      version: 0,
    });
    expect(tyres.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    // Paper order: the receipts' day ascending.
    expect(tyres.lines.map((line) => line.receiptId)).toEqual([t2, t1]);
    expect(tyres.lines[0]).toMatchObject({ date: '2026-09-01', amount: 1090.5, mission: '' });
    expect(wash.name).toBe('غسيل سبتمبر');
    expect(String(await memoOf(t1))).toBe(tyres.id);
    expect(String(await memoOf(w1))).toBe(wash.id);

    // The signatures it prints with are the set-up's, as they stand.
    const settings = await fleetCustodyPapersService.getSettings();
    expect(tyres.signatures).toEqual(settings.papers.tyres);
    expect(wash.signatures).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.wash);
  });

  it('keeps a typed date and period, and the typed cells of its kind', async () => {
    const f1 = await mkReceipt({ kind: 'fuel', amount: 410, date: '2026-09-20' });
    const memo = await createMemo({
      kind: 'fuel',
      date: '2026-10-01',
      from: '2026-09-01',
      to: '2026-09-30',
      lines: [{ receiptId: f1, mission: 'نقل اموال', note: 'ملاحظة' }],
    });
    expect(memo).toMatchObject({ date: '2026-10-01', from: '2026-09-01', to: '2026-09-30' });
    expect(memo.lines[0]).toMatchObject({ mission: 'نقل اموال', note: 'ملاحظة', statement: '' });
    // The cells are the memo's: the receipt itself is not touched beyond its link.
    const receipt = await FleetReceiptModel.findById(f1).lean().exec();
    expect(receipt).toMatchObject({ amount: 410, __v: 0 });
  });

  it('refuses receipts of another kind, card-paid, deleted or held — and uses up no number', async () => {
    const before = await fleetCustodyMemoRepository.maxNo();
    const wash = await mkReceipt({ kind: 'wash' });
    const card = await mkReceipt({ kind: 'fuel', source: 'card' });
    const gone = await mkReceipt({ kind: 'tyres', isDeleted: true });
    const fine = await mkReceipt({ kind: 'tyres' });

    await expect(createMemo({ kind: 'tyres', lines: lines([fine, wash]) })).rejects.toMatchObject({
      httpStatus: 400,
      details: [expect.objectContaining({ field: 'body.lines.1.receiptId' })],
    });
    await expect(createMemo({ kind: 'fuel', lines: lines([card]) })).rejects.toMatchObject({
      httpStatus: 400,
    });
    await expect(createMemo({ kind: 'tyres', lines: lines([gone]) })).rejects.toMatchObject({
      httpStatus: 400,
    });
    // Nothing was taken by the refused memos.
    expect(await memoOf(fine)).toBeNull();

    const held = await createMemo({ kind: 'tyres', lines: lines([fine]) });
    // Refused memos rolled their number back: no gap.
    expect(held.no).toBe(before + 1);
    const other = await mkReceipt({ kind: 'tyres' });
    await expect(createMemo({ kind: 'tyres', lines: lines([other, fine]) })).rejects.toMatchObject({
      httpStatus: 409,
    });
    expect(await memoOf(other)).toBeNull();
  });

  it('refuses no lines and the same receipt twice (the contract)', async () => {
    const r = await mkReceipt();
    expect(CreateFleetCustodyMemoSchema.safeParse({ kind: 'tyres', lines: [] }).success).toBe(
      false,
    );
    expect(
      CreateFleetCustodyMemoSchema.safeParse({ kind: 'tyres', lines: lines([r, r]) }).success,
    ).toBe(false);
  });
});

describe('two memos at the same moment', () => {
  it('get distinct, consecutive numbers', async () => {
    const a = await mkReceipt();
    const b = await mkReceipt();
    const before = await fleetCustodyMemoRepository.maxNo();
    const [x, y] = await Promise.all([
      createMemo({ kind: 'tyres', lines: lines([a]) }),
      createMemo({ kind: 'tyres', lines: lines([b]) }),
    ]);
    expect([x.no, y.no].sort((m, n) => m - n)).toEqual([before + 1, before + 2]);
  });

  it('reaching for one receipt: exactly one gets it', async () => {
    const r = await mkReceipt();
    const results = await Promise.allSettled([
      createMemo({ kind: 'tyres', lines: lines([r]) }),
      createMemo({ kind: 'tyres', lines: lines([r]) }),
    ]);
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ httpStatus: 409 });
    expect(String(await memoOf(r))).toBe(
      (won[0] as PromiseFulfilledResult<FleetCustodyMemoDto>).value.id,
    );
  });

  it('the database itself refuses one receipt on two live memos; a deleted memo frees it', async () => {
    const r = new Types.ObjectId();
    const doc = (no: number) => ({
      no,
      kind: 'tyres',
      name: '',
      date: new Date(),
      from: new Date(),
      to: new Date(),
      lines: [{ receiptId: r, mission: '', statement: '', note: '' }],
      signatures: { blocks: [], note: '' },
    });
    const first = await FleetCustodyMemoModel.create(doc(900_001));
    await expect(FleetCustodyMemoModel.create(doc(900_002))).rejects.toMatchObject({ code: 11000 });
    await FleetCustodyMemoModel.updateOne({ _id: first._id }, { $set: { isDeleted: true } }).exec();
    await expect(FleetCustodyMemoModel.create(doc(900_003))).resolves.toBeTruthy();
    // …and a number is unique over deleted memos too.
    await expect(
      FleetCustodyMemoModel.create({ ...doc(900_001), lines: [] }),
    ).rejects.toMatchObject({ code: 11000 });
    // These hand-written rows raised the highest number; the counter follows it, never below.
    await ensureCustodyMemoCounter();
    const next = await createMemo({ kind: 'tyres', lines: lines([await mkReceipt()]) });
    expect(next.no).toBe(900_004);
  });
});

describe('editing a memo', () => {
  it('adds and drops receipts, keeps the typed cells, recomputes the period; versioned', async () => {
    const a = await mkReceipt({ kind: 'maintenance', amount: 1000, date: '2026-08-05' });
    const b = await mkReceipt({ kind: 'maintenance', amount: 2000, date: '2026-08-10' });
    const c = await mkReceipt({ kind: 'maintenance', amount: 2720, date: '2026-08-20' });
    const memo = await createMemo({ kind: 'maintenance', name: 'صيانة', lines: lines([a, b]) });
    expect(memo).toMatchObject({ from: '2026-08-05', to: '2026-08-10', total: 3000 });
    const date = memo.date;

    const edited = await fleetCustodyMemoService.update(
      memo.id,
      UpdateFleetCustodyMemoSchema.parse({
        kind: 'maintenance',
        name: 'صيانة أغسطس',
        lines: [
          { receiptId: b, statement: 'تغيير زيت', note: 'عاجل' },
          { receiptId: c, statement: 'فرامل' },
        ],
        version: memo.version,
      }),
      actor,
    );
    expect(edited).toMatchObject({
      name: 'صيانة أغسطس',
      from: '2026-08-10',
      to: '2026-08-20',
      receipts: 2,
      total: 4720,
      version: memo.version + 1,
      // An absent date keeps the stored one.
      date,
    });
    expect(edited.lines.map((line) => [line.receiptId, line.statement, line.note])).toEqual([
      [b, 'تغيير زيت', 'عاجل'],
      [c, 'فرامل', ''],
    ]);
    expect(await memoOf(a)).toBeNull();
    expect(String(await memoOf(c))).toBe(memo.id);

    // A stale version is 409, and nothing moved.
    await expect(
      fleetCustodyMemoService.update(
        memo.id,
        UpdateFleetCustodyMemoSchema.parse({
          kind: 'maintenance',
          lines: lines([a]),
          version: memo.version,
        }),
        actor,
      ),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(await memoOf(a)).toBeNull();
    expect(String(await memoOf(b))).toBe(memo.id);
  });

  it('keeps its kind (422), and its signatures whatever the set-up says later', async () => {
    const r = await mkReceipt({ kind: 'wash' });
    const memo = await createMemo({ kind: 'wash', lines: lines([r]) });
    await expect(
      fleetCustodyMemoService.update(
        memo.id,
        UpdateFleetCustodyMemoSchema.parse({ kind: 'tyres', lines: lines([r]), version: 0 }),
        actor,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });

    const papers = structuredClone(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    papers.wash.blocks[0] = { ...papers.wash.blocks[0]!, name: 'اسم بعد المذكرة' };
    const current = await fleetCustodyPapersService.getSettings();
    await fleetCustodyPapersService.saveSettings(
      { papers, ...(current.version === null ? {} : { version: current.version }) },
      actor,
    );
    const edited = await fleetCustodyMemoService.update(
      memo.id,
      UpdateFleetCustodyMemoSchema.parse({ kind: 'wash', lines: lines([r]), version: 0 }),
      actor,
    );
    expect(edited.signatures).toEqual(memo.signatures);
    expect(edited.signatures.blocks[0]?.name).not.toBe('اسم بعد المذكرة');
    // A NEW memo takes the set-up as it is now.
    const later = await createMemo({
      kind: 'wash',
      lines: lines([await mkReceipt({ kind: 'wash' })]),
    });
    expect(later.signatures.blocks[0]?.name).toBe('اسم بعد المذكرة');
  });
});

describe('deleting a memo', () => {
  it('is soft; its receipts come back; its number is never handed out again', async () => {
    const r1 = await mkReceipt({ kind: 'fuel', amount: 77, date: '2026-07-01' });
    const r2 = await mkReceipt({ kind: 'fuel', amount: 23, date: '2026-07-02' });
    const memo = await createMemo({ kind: 'fuel', lines: lines([r1, r2]) });
    const outsideBefore = await fleetCustodyMemoService.outside();
    const fuelBefore = outsideBefore.find((row) => row.kind === 'fuel')!;

    const res = await request(app)
      .delete(`${MEMOS}/${memo.id}`)
      .set(...auth(tokens.deleter));
    expect(res.status).toBe(204);

    const row = await FleetCustodyMemoModel.findById(memo.id).lean().exec();
    expect(row).toMatchObject({ isDeleted: true, no: memo.no });
    expect(row?.deletedBy).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await memoOf(r1)).toBeNull();
    expect(await memoOf(r2)).toBeNull();

    const outside = await fleetCustodyMemoService.outside();
    expect(outside.find((x) => x.kind === 'fuel')).toEqual({
      kind: 'fuel',
      count: fuelBefore.count + 2,
      total: Math.round((fuelBefore.total + 100) * 100) / 100,
    });
    const candidates = await fleetCustodyMemoService.candidates({ kind: 'fuel' });
    expect(candidates.receipts.map((x) => x.id)).toEqual(expect.arrayContaining([r1, r2]));

    const top = await fleetCustodyMemoRepository.maxNo();
    expect(candidates.nextNo).toBe(top + 1);
    const next = await createMemo({ kind: 'fuel', lines: lines([r1]) });
    expect(next.no).toBe(top + 1);
    expect(next.no).not.toBe(memo.no);

    expect(
      (
        await request(app)
          .get(`${MEMOS}/${memo.id}`)
          .set(...auth(tokens.viewer))
      ).status,
    ).toBe(404);
  });
});

describe('the editor’s candidates', () => {
  it('only waiting custody receipts of the kind; on an edit, the memo’s own as well', async () => {
    const car = await mkCar();
    const mine = await mkReceipt({ kind: 'wash', vehicleId: car, date: '2026-06-02' });
    const waiting = await mkReceipt({ kind: 'wash', vehicleId: car, date: '2026-06-01' });
    const otherKind = await mkReceipt({ kind: 'tyres', vehicleId: car, date: '2026-06-01' });
    const card = await mkReceipt({ kind: 'fuel', source: 'card', vehicleId: car });
    const memo = await createMemo({ kind: 'wash', lines: lines([mine]) });

    const fresh = await fleetCustodyMemoService.candidates({ kind: 'wash' });
    const freshIds = fresh.receipts.map((x) => x.id);
    expect(freshIds).toContain(waiting);
    expect(freshIds).not.toContain(mine);
    expect(freshIds).not.toContain(otherKind);
    expect(freshIds).not.toContain(card);
    expect(fresh.truncated).toBe(false);
    expect(fresh.missionOptions).toEqual([]);
    const waitingRow = fresh.receipts.find((x) => x.id === waiting);
    expect(waitingRow).toMatchObject({
      date: '2026-06-01',
      vehicleCode: expect.any(String),
      inThisMemo: false,
      suggestedMission: null,
    });

    const editing = await fleetCustodyMemoService.candidates({ kind: 'wash', memoId: memo.id });
    expect(editing.receipts.find((x) => x.id === mine)).toMatchObject({ inThisMemo: true });
    expect(editing.receipts.find((x) => x.id === waiting)).toMatchObject({ inThisMemo: false });
    // Day ascending.
    const days = editing.receipts.map((x) => x.date);
    expect([...days].sort()).toEqual(days);
  });

  it('suggests «المأمورية»: the day’s roster, else the fixed crew, else the car’s «التشغيل»', async () => {
    const item = async (kind: string, ar: string) =>
      (await FleetCatalogItemModel.create({ kind, name: { ar, en: ar } }))._id;
    const duty = await item('missionType', 'مأمورية الجدول');
    const crew = await item('missionType', 'مأمورية الطاقم');
    const operation = await item('operation', 'تشغيل السيارة');
    const carDuty = await mkCar({ operationId: operation });
    const carCrew = await mkCar({ operationId: operation });
    const carOperation = await mkCar({ operationId: operation });
    const carNothing = await mkCar();
    await FleetDutyAssignmentModel.create({
      vehicleId: carDuty,
      date: new Date('2026-05-10T00:00:00.000Z'),
      missionTypeId: duty,
    });
    await FleetFixedCrewModel.create({ vehicleId: carDuty, missionTypeId: crew });
    await FleetFixedCrewModel.create({ vehicleId: carCrew, missionTypeId: crew });

    const onDutyDay = await mkReceipt({ kind: 'fuel', vehicleId: carDuty, date: '2026-05-10' });
    const offDutyDay = await mkReceipt({ kind: 'fuel', vehicleId: carDuty, date: '2026-05-11' });
    const byCrew = await mkReceipt({ kind: 'fuel', vehicleId: carCrew, date: '2026-05-10' });
    const byOperation = await mkReceipt({
      kind: 'fuel',
      vehicleId: carOperation,
      date: '2026-05-10',
    });
    const none = await mkReceipt({ kind: 'fuel', vehicleId: carNothing, date: '2026-05-10' });

    // A mission typed on an earlier fuel memo comes back as an option.
    await createMemo({
      kind: 'fuel',
      lines: [{ receiptId: await mkReceipt({ kind: 'fuel' }), mission: 'اسيوط' }],
    });

    const result = await fleetCustodyMemoService.candidates({ kind: 'fuel' });
    const suggested = (id: string) => result.receipts.find((x) => x.id === id)?.suggestedMission;
    expect(suggested(onDutyDay)).toBe('مأمورية الجدول');
    expect(suggested(offDutyDay)).toBe('مأمورية الطاقم');
    expect(suggested(byCrew)).toBe('مأمورية الطاقم');
    expect(suggested(byOperation)).toBe('تشغيل السيارة');
    expect(suggested(none)).toBeNull();
    expect(result.missionOptions).toEqual(
      expect.arrayContaining(['مأمورية الجدول', 'مأمورية الطاقم', 'تشغيل السيارة', 'اسيوط']),
    );
    expect(new Set(result.missionOptions).size).toBe(result.missionOptions.length);
  });
});

describe('the list and its figures', () => {
  it('filters by kind, status and period overlap; figures over the whole filtered set', async () => {
    const a = await mkReceipt({ kind: 'tyres', amount: 0.1, date: '2025-01-05' });
    const b = await mkReceipt({ kind: 'tyres', amount: 0.2, date: '2025-01-25' });
    const c = await mkReceipt({ kind: 'wash', amount: 5, date: '2025-02-10' });
    const jan = await createMemo({ kind: 'tyres', lines: lines([a, b]) });
    const feb = await createMemo({ kind: 'wash', lines: lines([c]) });
    expect(await replenish(feb.id, '2025-03-01')).toBe(1);

    const list = await request(app)
      .get(MEMOS)
      .query({ from: '2025-01-20', to: '2025-02-28', pageSize: 50 })
      .set(...auth(tokens.viewer));
    expect(list.status).toBe(200);
    const rows = data<FleetCustodyMemoRowDto[]>(list);
    expect(rows.map((row) => row.no)).toEqual([feb.no, jan.no]);
    expect(rows[1]).toMatchObject({
      receipts: 2,
      total: 0.3,
      from: '2025-01-05',
      to: '2025-01-25',
    });
    expect(rows[0]?.replenishment).toMatchObject({ date: '2025-03-01' });

    const pending = await request(app)
      .get(MEMOS)
      .query({ from: '2025-01-01', to: '2025-02-28', status: 'pending', kind: 'tyres,wash' })
      .set(...auth(tokens.viewer));
    expect(data<FleetCustodyMemoRowDto[]>(pending).map((row) => row.no)).toEqual([jan.no]);

    const asc = await request(app)
      .get(MEMOS)
      .query({ from: '2025-01-01', to: '2025-02-28', sort: 'no:asc' })
      .set(...auth(tokens.viewer));
    expect(data<FleetCustodyMemoRowDto[]>(asc).map((row) => row.no)).toEqual([jan.no, feb.no]);

    const summary = await request(app)
      .get(`${MEMOS}/summary`)
      .query({ from: '2025-01-01', to: '2025-02-28' })
      .set(...auth(tokens.viewer));
    expect(data<FleetCustodyMemoTotalsDto>(summary)).toEqual({ count: 2, receipts: 3, total: 5.3 });
  });
});

describe('the receipts screen, for a receipt on a memo', () => {
  const patch = (id: string, receipt: FleetReceiptDto, over: Record<string, unknown> = {}) =>
    request(app)
      .patch(`/api/v1/fleet/receipts/${id}`)
      .set(...auth(tokens.clerk))
      // The whole body, as the receipts dialog sends it on every save.
      .send({
        date: `${receipt.date.slice(0, 10)}T00:00:00.000Z`,
        vehicleId: receipt.vehicleId,
        driverEmployeeId: receipt.driverEmployeeId,
        driverName: receipt.driverName,
        kind: receipt.kind,
        cardId: receipt.cardId,
        fuelType: receipt.fuelType,
        amount: receipt.amount,
        odometer: receipt.odometer,
        company: receipt.company,
        version: receipt.version,
        ...over,
      });
  const read = async (id: string): Promise<FleetReceiptDto> =>
    data<FleetReceiptDto>(
      await request(app)
        .get(`/api/v1/fleet/receipts/${id}`)
        .set(...auth(tokens.clerk)),
    );

  it('a pending memo: the amount may change (the memo follows); the kind and the bin may not', async () => {
    const r = await mkReceipt({ kind: 'tyres', amount: 500 });
    const memo = await createMemo({ kind: 'tyres', lines: lines([r]) });
    const receipt = await read(r);
    expect(receipt.memo).toEqual({ id: memo.id, no: memo.no, replenishedAt: null });

    const amount = await patch(r, receipt, { amount: 650 });
    expect(amount.status, JSON.stringify(amount.body)).toBe(200);
    expect((await fleetCustodyMemoService.get(memo.id)).total).toBe(650);

    const kind = await patch(r, await read(r), { kind: 'wash' });
    expect(kind.status).toBe(422);
    const removed = await request(app)
      .delete(`/api/v1/fleet/receipts/${r}`)
      .set(...auth(tokens.clerk));
    expect(removed.status).toBe(422);
    expect((await FleetReceiptModel.findById(r).lean().exec())?.isDeleted).toBe(false);
  });

  it('a replenished memo: amount, date and car stay; the bin stays; the driver may change', async () => {
    const r = await mkReceipt({ kind: 'maintenance', amount: 900, date: '2026-04-04' });
    const memo = await createMemo({ kind: 'maintenance', lines: lines([r]) });
    expect(await replenish(memo.id, '2026-05-01')).toBe(1);
    // Once only.
    expect(await replenish(memo.id, '2026-05-02')).toBe(0);
    const receipt = await read(r);
    expect(receipt.memo).toEqual({ id: memo.id, no: memo.no, replenishedAt: '2026-05-01' });

    for (const over of [
      { amount: 901 },
      { date: '2026-04-05T00:00:00.000Z' },
      { vehicleId: String(await mkCar()) },
      { kind: 'tyres' },
    ]) {
      const res = await patch(r, receipt, over);
      expect(res.status, JSON.stringify(over)).toBe(422);
    }
    expect(
      (
        await request(app)
          .delete(`/api/v1/fleet/receipts/${r}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(422);

    const driver = await patch(r, receipt, { driverName: 'سائق آخر' });
    expect(driver.status, JSON.stringify(driver.body)).toBe(200);
    expect(data<FleetReceiptDto>(driver)).toMatchObject({ driverName: 'سائق آخر', amount: 900 });

    // The memo itself is frozen too.
    const current = await fleetCustodyMemoService.get(memo.id);
    const edit = await request(app)
      .patch(`${MEMOS}/${memo.id}`)
      .set(...auth(tokens.editor))
      .send({ kind: 'maintenance', lines: lines([r]), version: current.version });
    expect(edit.status).toBe(422);
    expect(
      (
        await request(app)
          .delete(`${MEMOS}/${memo.id}`)
          .set(...auth(tokens.deleter))
      ).status,
    ).toBe(422);
    expect((await FleetCustodyMemoModel.findById(memo.id).lean().exec())?.isDeleted).toBe(false);
  });

  it('a receipt on no memo is edited and deleted as before', async () => {
    const r = await mkReceipt({ kind: 'wash', amount: 40 });
    const receipt = await read(r);
    expect(receipt.memo).toBeNull();
    expect((await patch(r, receipt, { amount: 45, kind: 'tyres' })).status).toBe(200);
    expect(
      (
        await request(app)
          .delete(`/api/v1/fleet/receipts/${r}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(204);
  });
});

describe('who may do what', () => {
  it('reading needs `fleetCustody.view`; writing needs the receipts’ write grant as well', async () => {
    const r1 = await mkReceipt({ kind: 'tyres' });
    const r2 = await mkReceipt({ kind: 'tyres' });
    const body = { kind: 'tyres', lines: lines([r1]) };

    for (const path of ['', '/summary', '/outside', '/candidates?kind=tyres']) {
      const res = await request(app)
        .get(`${MEMOS}${path}`)
        .set(...auth(tokens.viewer));
      expect(res.status, path).toBe(200);
    }
    expect(
      data<FleetCustodyOutsideKindDto[]>(
        await request(app)
          .get(`${MEMOS}/outside`)
          .set(...auth(tokens.viewer)),
      ).map((row) => row.kind),
    ).toEqual(['maintenance', 'fuel', 'tyres', 'wash']);
    expect(
      data<FleetCustodyMemoCandidatesDto>(
        await request(app)
          .get(`${MEMOS}/candidates?kind=tyres`)
          .set(...auth(tokens.viewer)),
      ).nextNo,
    ).toBeGreaterThan(0);

    expect(
      (
        await request(app)
          .post(MEMOS)
          .set(...auth(tokens.viewer))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(MEMOS)
          .set(...auth(tokens.editor))
          .send(body)
      ).status,
    ).toBe(403);
    const created = await request(app)
      .post(MEMOS)
      .set(...auth(tokens.creator))
      .send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const memo = data<FleetCustodyMemoDto>(created);
    expect(
      (
        await request(app)
          .get(`${MEMOS}/${memo.id}`)
          .set(...auth(tokens.viewer))
      ).status,
    ).toBe(200);

    const edit = { kind: 'tyres', name: 'اسم', lines: lines([r1, r2]), version: memo.version };
    for (const token of [tokens.viewer, tokens.creator, tokens.deleter]) {
      expect(
        (
          await request(app)
            .patch(`${MEMOS}/${memo.id}`)
            .set(...auth(token))
            .send(edit)
        ).status,
      ).toBe(403);
    }
    const edited = await request(app)
      .patch(`${MEMOS}/${memo.id}`)
      .set(...auth(tokens.editor))
      .send(edit);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<FleetCustodyMemoDto>(edited)).toMatchObject({ name: 'اسم', receipts: 2 });

    for (const token of [tokens.viewer, tokens.creator, tokens.editor]) {
      expect(
        (
          await request(app)
            .delete(`${MEMOS}/${memo.id}`)
            .set(...auth(token))
        ).status,
      ).toBe(403);
    }

    // The receipts' grants alone open nothing here.
    for (const path of ['', '/summary', '/outside', '/candidates?kind=tyres', `/${memo.id}`]) {
      const res = await request(app)
        .get(`${MEMOS}${path}`)
        .set(...auth(tokens.receiptsOnly));
      expect(res.status, path).toBe(403);
    }
    expect(
      (
        await request(app)
          .post(MEMOS)
          .set(...auth(tokens.receiptsOnly))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`${MEMOS}/${memo.id}`)
          .set(...auth(tokens.receiptsOnly))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`${MEMOS}/${memo.id}`)
          .set(...auth(tokens.deleter))
      ).status,
    ).toBe(204);
  });

  it('a body the contract refuses is 400 — over HTTP too', async () => {
    const res = await request(app)
      .post(MEMOS)
      .set(...auth(tokens.creator))
      .send({ kind: 'tyres', lines: [] });
    expect(res.status).toBe(400);
  });
});

describe('the audit trail', () => {
  it('records a memo’s create, update and delete', async () => {
    const r = await mkReceipt({ kind: 'wash' });
    const memo = await createMemo({ kind: 'wash', lines: lines([r]) });
    await fleetCustodyMemoService.update(
      memo.id,
      UpdateFleetCustodyMemoSchema.parse({
        kind: 'wash',
        name: 'جديد',
        lines: lines([r]),
        version: 0,
      }),
      actor,
    );
    await fleetCustodyMemoService.remove(memo.id, actor);
    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'fleet',
      'entityRef.entityType': 'custodyMemo',
      'entityRef.entityId': memo.id,
    })
      .sort({ _id: 1 })
      .lean()
      .exec();
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(rows[1]?.changes).toEqual([
      expect.objectContaining({ field: 'name', old: '', new: 'جديد' }),
    ]);
  });
});

describe('rows from before memos existed', () => {
  it('a receipt with no `memoId` field at all counts as outside, is a candidate, and can be taken', async () => {
    const car = await someCar();
    const { insertedId } = await FleetReceiptModel.collection.insertOne({
      date: new Date('2026-03-03T00:00:00.000Z'),
      vehicleId: car,
      driverEmployeeId: null,
      driverName: null,
      kind: 'tyres',
      source: 'custody',
      cardId: null,
      fuelType: null,
      pricePerLitre: null,
      litres: null,
      amount: 333,
      image: null,
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    const id = String(insertedId);
    const before = (await fleetCustodyMemoService.outside()).find((x) => x.kind === 'tyres')!;
    expect(before.count).toBeGreaterThan(0);
    expect(
      (await fleetCustodyMemoService.candidates({ kind: 'tyres' })).receipts.map((x) => x.id),
    ).toContain(id);
    const memo = await createMemo({ kind: 'tyres', lines: lines([id]) });
    expect(memo.total).toBe(333);
    const after = (await fleetCustodyMemoService.outside()).find((x) => x.kind === 'tyres')!;
    expect(after.count).toBe(before.count - 1);
    // Its receipts screen row reads as it always did, plus the memo.
    const res = await request(app)
      .get(`/api/v1/fleet/receipts/${id}`)
      .set(...auth(tokens.clerk));
    expect(data<FleetReceiptDto>(res).memo).toMatchObject({ id: memo.id, no: memo.no });
  });

  it('the list reads a memo page', async () => {
    const res = await request(app)
      .get(MEMOS)
      .set(...auth(tokens.viewer));
    const page = res.body as { data: FleetCustodyMemoRowDto[]; meta: Paginated<unknown>['meta'] };
    expect(page.meta.totalItems).toBeGreaterThan(0);
    // Default order: newest number first.
    const nos = page.data.map((row) => row.no);
    expect([...nos].sort((a, b) => b - a)).toEqual(nos);
  });
});
