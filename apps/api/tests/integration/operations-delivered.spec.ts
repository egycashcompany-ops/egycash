// Round 33 B — «الشحنات المسلَّمة» over real HTTP, real RBAC and a real database. The owner: «وعاوز
// اعمل شاشة جديدة زى شاشةاليوم التشغيلى بس يظهر بس اللى اتسلمت سواء يومى او كانت محصنة ف الخونة
// واسلمت ل بنك هتظهرلى لما تكون تم التسليم بس الاجراءات هيكون فيه علامة صح لما ادوس عليها لازم يكون
// فيه رقم الايصال ويفضل الصورة تكون مرفوعه و يحدد البنك من او الى اللى هيتحسب عليه تكلفة نقل الشحنة»;
// asked about the day board's ✓ — «الشاشة الجديدة حاجاتها لوحدها»; about the photo — «اختيارية مع
// تنبيه».
//
//   · `GET /operations/shipments/delivered?date=` — only what reached its bank on that CAIRO day: a
//     daily shipment its captain delivered, a محصنة out of the vault its delivery captain delivered;
//     never one undelivered, still in the vault, or out and not delivered yet.
//   · `POST` / `DELETE /operations/shipments/:id/delivery-confirmation` — the ✓ with its receipt
//     number and the side billed, its own record: the bank is the server's (the branch's on that
//     side), the person the token's, and nothing else on the shipment moves.
//   · the receipt photo stays the shipment's own; a محصنة that reached its bank takes a FIRST one
//     (Round 10's lock otherwise unchanged).
//
// The captain's legs are STAMPED in the database here — what his acts in the app write
// (`executionStatus`, `deliveredAt`); the app's own acts are driven end to end in operations.spec.ts
// («the captain's «تم التسليم»…»), and this screen reads the very field they write. So are the
// vault's statuses of the محصنات: the vault flow is driven in operations-distribution.spec.ts, and
// this screen reads only where a محصنة stands. This file boots its own database.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX,
  OperationsEvents,
  SettingKeys,
  addDaysYmd,
  cairoDayStart,
  cairoYmd,
  platformPermissions,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardDto,
  type OperationsDeliveredBoardDto,
  type OperationsDeliveryConfirmationResultDto,
  type OperationsExecutionStatus,
  type OperationsShipmentDto,
  type OperationsShipmentLeg,
  type OperationsShipmentLogDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { OperationsShipmentAssignmentModel } from '../../src/modules/operations/shipments/shipment-assignment.model';
import { OperationsShipmentModel } from '../../src/modules/operations/shipments/shipment.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId = '';
let adminToken = '';
let deskId = '';
let deskToken = ''; // the day board's desk: view, complete (the ✓), edit (the photo)
let viewerToken = ''; // operationsShipment.view only — reads the screen, may not press ✓
let vaultToken = ''; // operationsVault.view only — not the day board's reader
const seenEvents: { name: string; payload: unknown }[] = [];

/** TODAY on the Cairo calendar — the day the screen opens on. */
const D = cairoYmd(new Date());
const YESTERDAY = addDaysYmd(D, -1);
/** An instant `minutes` after Cairo's midnight that opens `ymd` (negative: before it). */
const cairoAt = (ymd: string, minutes: number): Date =>
  new Date(cairoDayStart(ymd).getTime() + minutes * 60_000);

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-delivered-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorOf = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; details?: { field?: string; code: string; message: string }[] };
    }
  ).error;

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

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const userWith = async (
  email: string,
  permissionKeys: string[],
): Promise<{ id: string; token: string }> => {
  const role = await rbacService.createRole(
    { name: { en: `R33 ${email}`, ar: `دور ${email}` }, permissionKeys },
    adminId,
  );
  const id = await mkUser(email);
  await rbacService.ensureAssignment(id, String(role._id), 'organization');
  return { id, token: await login(email) };
};

let bankA: OperationsBankDto;
let bankB: OperationsBankDto;
let branchA: OperationsBankBranchDto;
let branchA2: OperationsBankBranchDto;
let branchB: OperationsBankBranchDto;
let egp: OperationsCurrencyDto;

let booked = 0;
const book = async (over: Record<string, unknown> = {}): Promise<OperationsShipmentDto> => {
  booked += 1;
  const res = await request(app)
    .post('/api/v1/operations/shipments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      shipmentType: 'daily',
      mainBankId: bankA.id,
      originBranchId: branchA.id,
      destinationBranchId: branchA2.id,
      areaName: 'المعادي',
      lines: [{ currencyId: egp.id, amount: 1000 + booked }],
      collectionDate: D,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<OperationsShipmentDto>(res);
};
const bookSecured = (over: Record<string, unknown> = {}) =>
  book({ shipmentType: 'secured', deliveryDate: D, ...over });

let sequence = 0;
/** The leg as the captain's app leaves it: `executionStatus`, and `deliveredAt` once delivered. */
const stampLeg = async (
  shipmentId: string,
  leg: OperationsShipmentLeg,
  executionStatus: OperationsExecutionStatus,
  deliveredAt: Date | null,
): Promise<void> => {
  sequence += 1;
  await OperationsShipmentAssignmentModel.create({
    shipmentId: new Types.ObjectId(shipmentId),
    leg,
    operationsDayId: new Types.ObjectId(),
    captainEmployeeId: new Types.ObjectId(),
    vehicleId: null,
    crewAssignmentId: new Types.ObjectId(),
    sequence,
    executionStatus,
    deliveredAt,
  });
};
/** Where a محصنة stands since the vault — what its receive and dispatch wrote. */
const standAt = async (shipmentId: string, status: 'inVault' | 'dispatched'): Promise<void> => {
  await OperationsShipmentModel.updateOne({ _id: shipmentId }, { $set: { status } }).exec();
};

const read = async (id: string): Promise<OperationsShipmentDto> =>
  data<OperationsShipmentDto>(
    await request(app)
      .get(`/api/v1/operations/shipments/${id}`)
      .set('Authorization', `Bearer ${adminToken}`),
  );
const delivered = (query = '', token = deskToken): request.Test =>
  request(app)
    .get(`/api/v1/operations/shipments/delivered${query}`)
    .set('Authorization', `Bearer ${token}`);
const boardOf = async (ymd: string): Promise<OperationsDeliveredBoardDto> => {
  const res = await delivered(`?date=${ymd}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsDeliveredBoardDto>(res);
};
const confirm = (id: string, body: Record<string, unknown>, token = deskToken): request.Test =>
  request(app)
    .post(`/api/v1/operations/shipments/${id}/delivery-confirmation`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const undo = (id: string, body: Record<string, unknown>, token = deskToken): request.Test =>
  request(app)
    .delete(`/api/v1/operations/shipments/${id}/delivery-confirmation`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const logOf = async (id: string): Promise<OperationsShipmentLogDto> =>
  data<OperationsShipmentLogDto>(
    await request(app)
      .get(`/api/v1/operations/shipments/${id}/log`)
      .set('Authorization', `Bearer ${adminToken}`),
  );
/** A 1×1 PNG — a real image, so the category's mime check passes on its true bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (id: string, token = deskToken): request.Test =>
  request(app)
    .post(`/api/v1/operations/shipments/${id}/receipt-image`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', PNG, 'receipt.png');

// The shipments of the day (D) and around it.
let dailyDelivered = ''; // daily, its captain delivered it at 10:00 — listed
let dailyCompleted = ''; // daily, delivered at 11:00 and then the desk's ✓ — listed
let crossBank = ''; // daily, bank A's branch → bank B's branch, delivered at 12:00 — listed
let dailyPickedUp = ''; // daily, picked up, not delivered — NOT listed
let dailyNoLeg = ''; // daily, nobody on it — NOT listed
let securedDelivered = ''; // محصنة out of the vault, its delivery captain delivered it — listed
let securedInVault = ''; // محصنة IN the vault whose delivery leg says delivered — NOT listed
let securedOut = ''; // محصنة out for delivery, not delivered yet — NOT listed
let securedToVault = ''; // محصنة whose PICKUP leg delivered it into the vault — NOT listed
let justAfterMidnight = ''; // daily delivered one minute into D (Cairo) — D's, never yesterday's
let justBeforeMidnight = ''; // daily delivered one minute before D (Cairo) — yesterday's
let deletedDelivered = ''; // daily delivered on D, then deleted — NOT listed

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  for (const name of Object.values(OperationsEvents)) {
    subscribe(name, `test.r33.${name}`, (envelope) => {
      seenEvents.push({ name: envelope.name, payload: envelope.payload });
    });
  }
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...operationsPermissions].map(
      (p) => p.key,
    ),
  );
  adminId = await mkUser('ops-r33-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('ops-r33-admin@ecms.local');
  const desk = await userWith('ops-r33-desk@ecms.local', [
    'operationsShipment.view',
    'operationsShipment.complete',
    'operationsShipment.edit',
  ]);
  deskId = desk.id;
  deskToken = desk.token;
  viewerToken = (await userWith('ops-r33-viewer@ecms.local', ['operationsShipment.view'])).token;
  vaultToken = (await userWith('ops-r33-vault@ecms.local', ['operationsVault.view'])).token;

  bankA = data<OperationsBankDto>(
    await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 1, name: { ar: 'البنك الأهلي', en: 'NBE' }, opsName: 'الأهلي' }),
  );
  bankB = data<OperationsBankDto>(
    await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 2, name: { ar: 'بنك مصر', en: 'Banque Misr' }, opsName: 'مصر' }),
  );
  const branch = async (bankId: string, name: string, code: string) =>
    data<OperationsBankBranchDto>(
      await request(app)
        .post('/api/v1/operations/bank-branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId, name, code, opsAreaName: 'المعادي' }),
    );
  branchA = await branch(bankA.id, 'فرع المعادي', 'A-1');
  branchA2 = await branch(bankA.id, 'فرع حلوان', 'A-2');
  branchB = await branch(bankB.id, 'فرع الهرم', 'B-1');
  egp = data<OperationsCurrencyDto>(
    await request(app)
      .post('/api/v1/operations/currencies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'EGP', name: 'مصري', legacyAliases: ['مصري', 'جنيه', 'EGP'] }),
  );

  dailyDelivered = (await book()).id;
  await stampLeg(dailyDelivered, 'pickup', 'delivered', cairoAt(D, 10 * 60));
  dailyCompleted = (await book()).id;
  await stampLeg(dailyCompleted, 'pickup', 'completed', cairoAt(D, 11 * 60));
  const completed = await request(app)
    .post(`/api/v1/operations/shipments/${dailyCompleted}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: (await read(dailyCompleted)).version });
  expect(completed.status, JSON.stringify(completed.body)).toBe(200);
  // From a branch of bank A to a branch of bank B: the destination's bank is the secondary bank.
  crossBank = (
    await book({ secondaryBankId: bankB.id, destinationBranchId: branchB.id, areaName: 'الهرم' })
  ).id;
  await stampLeg(crossBank, 'pickup', 'delivered', cairoAt(D, 12 * 60));
  dailyPickedUp = (await book()).id;
  await stampLeg(dailyPickedUp, 'pickup', 'pickedUp', null);
  dailyNoLeg = (await book()).id;

  securedDelivered = (await bookSecured()).id;
  // Its collection run delivered it INTO THE VAULT in the morning — that is no bank's delivery.
  await stampLeg(securedDelivered, 'pickup', 'completed', cairoAt(D, 8 * 60));
  await standAt(securedDelivered, 'dispatched');
  await stampLeg(securedDelivered, 'delivery', 'delivered', cairoAt(D, 13 * 60));
  securedInVault = (await bookSecured()).id;
  await standAt(securedInVault, 'inVault');
  await stampLeg(securedInVault, 'delivery', 'delivered', cairoAt(D, 13 * 60 + 5));
  securedOut = (await bookSecured()).id;
  await standAt(securedOut, 'dispatched');
  await stampLeg(securedOut, 'delivery', 'active', null);
  securedToVault = (await bookSecured()).id;
  await stampLeg(securedToVault, 'pickup', 'completed', cairoAt(D, 9 * 60));
  await standAt(securedToVault, 'inVault');

  justAfterMidnight = (await book()).id;
  await stampLeg(justAfterMidnight, 'pickup', 'delivered', cairoAt(D, 1));
  justBeforeMidnight = (await book()).id;
  await stampLeg(justBeforeMidnight, 'pickup', 'delivered', cairoAt(D, -1));
  deletedDelivered = (await book()).id;
  await stampLeg(deletedDelivered, 'pickup', 'delivered', cairoAt(D, 14 * 60));
  const removed = await request(app)
    .delete(`/api/v1/operations/shipments/${deletedDelivered}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(removed.status).toBe(204);
});

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('Round 33 B — «الشحنات المسلَّمة»: only what reached its bank, by the Cairo day', () => {
  it('lists the day’s deliveries — daily and out of the vault — and nothing undelivered', async () => {
    const board = await boardOf(D);
    expect(board.date).toBe(D);
    // Oldest delivery first: one minute past midnight, 10:00, 11:00, 12:00, 13:00.
    expect(board.shipments.map((row) => row.id)).toEqual([
      justAfterMidnight,
      dailyDelivered,
      dailyCompleted,
      crossBank,
      securedDelivered,
    ]);
    for (const absent of [
      dailyPickedUp,
      dailyNoLeg,
      securedInVault,
      securedOut,
      securedToVault,
      justBeforeMidnight,
      deletedDelivered,
    ]) {
      expect(
        board.shipments.some((row) => row.id === absent),
        absent,
      ).toBe(false);
    }
    const row = (id: string) => board.shipments.find((r) => r.id === id);
    // The captain's «تم التسليم», the day board's own field — the destination leg's.
    expect(row(dailyDelivered)?.captainDeliveredAt).toBe(cairoAt(D, 10 * 60).toISOString());
    expect(row(securedDelivered)?.captainDeliveredAt).toBe(cairoAt(D, 13 * 60).toISOString());
    expect(row(securedDelivered)?.securedStage).toBe('dispatched');
    // The desk's ✓ is the day board's; the row is listed whatever it says, unconfirmed here.
    expect(row(dailyCompleted)?.status).toBe('completed');
    for (const r of board.shipments) expect(r.deliveryConfirmation).toBeNull();
    // The day board's names come with every row.
    expect(row(crossBank)?.destination).toMatchObject({ id: branchB.id, bankName: 'مصر' });
    expect(row(crossBank)?.origin).toMatchObject({ id: branchA.id, bankName: 'الأهلي' });
  });

  it('cuts the day at CAIRO midnight, not UTC’s', async () => {
    // One minute before D's Cairo midnight is yesterday's — although on the UTC calendar it may be D.
    const yesterday = await boardOf(YESTERDAY);
    expect(yesterday.shipments.map((row) => row.id)).toEqual([justBeforeMidnight]);
    // A day nobody delivered on is empty, not refused — a past or a later day alike.
    expect((await boardOf(addDaysYmd(D, -30))).shipments).toEqual([]);
    expect((await boardOf(addDaysYmd(D, 3))).shipments).toEqual([]);
  });

  it('opens on today in Cairo, and takes only a real day', async () => {
    const res = await delivered('');
    expect(res.status).toBe(200);
    expect(data<OperationsDeliveredBoardDto>(res).date).toBe(D);
    expect((await delivered('?date=2026-02-30')).status).toBe(400);
    expect((await delivered('?date=today')).status).toBe(400);
  });

  it('says ITS OWN Cairo today beside the day answered — the screen trusts it over a PC’s clock (Round 33 critic)', async () => {
    // Asked for no day, a past day or a later one: `today` is the server's, whatever was asked.
    const opened = data<OperationsDeliveredBoardDto>(await delivered(''));
    expect(opened).toMatchObject({ date: D, today: D });
    expect(await boardOf(YESTERDAY)).toMatchObject({ date: YESTERDAY, today: D });
    expect(await boardOf(addDaysYmd(D, 1))).toMatchObject({ date: addDaysYmd(D, 1), today: D });
  });

  it('reads on the day board’s grant, and nobody else’s', async () => {
    expect((await delivered(`?date=${D}`, viewerToken)).status).toBe(200);
    expect((await delivered(`?date=${D}`, vaultToken)).status).toBe(403);
    expect((await request(app).get('/api/v1/operations/shipments/delivered')).status).toBe(401);
  });
});

describe('Round 33 B — the ✓: «لازم يكون فيه رقم الايصال … و يحدد البنك من او الى»', () => {
  it('stores its own record — the origin’s bank, the token’s person — and moves NOTHING else', async () => {
    const before = await read(dailyDelivered);
    const res = await confirm(dailyDelivered, {
      receiptNumber: '  RC-1001  ',
      billedSide: 'origin',
      version: before.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const answer = data<OperationsDeliveryConfirmationResultDto>(res);
    expect(answer.shipmentId).toBe(dailyDelivered);
    expect(answer.version).toBe(before.version + 1);
    expect(answer.deliveryConfirmation).toMatchObject({
      receiptNumber: 'RC-1001',
      billedSide: 'origin',
      billedBranchId: branchA.id,
      billedBankId: bankA.id,
      billedBankName: 'الأهلي',
      // The desk user who pressed ✓ — from the token, never the admin who booked it.
      confirmedById: deskId,
    });
    expect(Number.isNaN(Date.parse(answer.deliveryConfirmation?.confirmedAt ?? ''))).toBe(false);

    // «الشاشة الجديدة حاجاتها لوحدها»: the shipment is what it was, version apart.
    const after = await read(dailyDelivered);
    expect({ ...after, version: before.version, updatedAt: before.updatedAt }).toEqual(before);
    expect(after.status).toBe('draft');
    expect(after.receivedAt).toBeNull();
    expect(after.mainBankId).toBe(bankA.id);
    expect(after.receiptNumber).toBeNull();
    expect(after.vaultReceiptNumber).toBeNull();

    const row = (await boardOf(D)).shipments.find((r) => r.id === dailyDelivered);
    expect(row?.deliveryConfirmation).toEqual(answer.deliveryConfirmation);

    // «السجل»: its own act, with the number and the bank billed — never the desk's «received».
    const entries = (await logOf(dailyDelivered)).entries;
    const entry = entries.at(-1);
    expect(entry?.kind).toBe('deliveryConfirmed');
    expect(entry?.changes).toEqual([
      { field: 'deliveryReceiptNumber', old: null, new: 'RC-1001' },
      { field: 'billedBank', old: null, new: 'الأهلي' },
    ]);
    expect(entries.some((e) => e.kind === 'received')).toBe(false);

    const event = seenEvents.find(
      (e) =>
        e.name === OperationsEvents.ShipmentDeliveryConfirmed &&
        (e.payload as { shipmentId: string }).shipmentId === dailyDelivered,
    );
    expect(event?.payload).toMatchObject({
      shipmentType: 'daily',
      status: 'draft',
      receiptNumber: 'RC-1001',
      billedSide: 'origin',
      billedBankId: bankA.id,
    });
  });

  it('bills the DESTINATION branch’s bank when «إلى» is chosen — the billed main bank untouched', async () => {
    const before = await read(crossBank);
    const res = await confirm(crossBank, {
      receiptNumber: 'RC-2002',
      billedSide: 'destination',
      version: before.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsDeliveryConfirmationResultDto>(res).deliveryConfirmation).toMatchObject({
      billedSide: 'destination',
      billedBranchId: branchB.id,
      billedBankId: bankB.id,
      billedBankName: 'مصر',
    });
    const after = await read(crossBank);
    expect(after.mainBankId).toBe(bankA.id);
    expect(after.secondaryBankId).toBe(bankB.id);
  });

  it('confirms a محصنة out of the vault, and leaves the day board’s ✓ to the day board', async () => {
    const before = await read(securedDelivered);
    const res = await confirm(securedDelivered, {
      receiptNumber: 'RC-3003',
      billedSide: 'destination',
      version: before.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await read(securedDelivered)).status).toBe('dispatched');

    // The day board's ✓ still completes it — and its undo still reopens it — as before, and the
    // delivery confirmation stays through both: two acts, two records.
    const done = await request(app)
      .post(`/api/v1/operations/shipments/${securedDelivered}/complete`)
      .set('Authorization', `Bearer ${deskToken}`)
      .send({ version: (await read(securedDelivered)).version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(data<OperationsShipmentDto>(done).status).toBe('completed');
    const reopened = await request(app)
      .post(`/api/v1/operations/shipments/${securedDelivered}/reopen`)
      .set('Authorization', `Bearer ${deskToken}`)
      .send({ version: data<OperationsShipmentDto>(done).version });
    expect(reopened.status).toBe(200);
    expect(data<OperationsShipmentDto>(reopened).status).toBe('dispatched');
    const row = (await boardOf(D)).shipments.find((r) => r.id === securedDelivered);
    expect(row?.deliveryConfirmation?.receiptNumber).toBe('RC-3003');

    // …and the day board reads the shipment as it always did.
    const dayBoard = await request(app)
      .get(`/api/v1/operations/shipments/day-board?date=${D}`)
      .set('Authorization', `Bearer ${deskToken}`);
    expect(dayBoard.status).toBe(200);
    const onBoard = data<OperationsDayBoardDto>(dayBoard).shipments.find(
      (r) => r.id === securedDelivered,
    );
    expect(onBoard?.status).toBe('dispatched');
    expect(onBoard?.captainDeliveredAt).toBe(cairoAt(D, 13 * 60).toISOString());
    expect(onBoard).not.toHaveProperty('deliveryConfirmation');
  });

  it('refuses what has not reached its bank — 409, nothing written', async () => {
    for (const id of [dailyPickedUp, dailyNoLeg, securedInVault, securedOut, securedToVault]) {
      const before = await read(id);
      const res = await confirm(id, {
        receiptNumber: 'RC-9',
        billedSide: 'origin',
        version: before.version,
      });
      expect(res.status, id).toBe(409);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_SHIPMENT_NOT_DELIVERED);
      expect(await read(id)).toEqual(before);
    }
  });

  it('refuses a confirmation already there — 409', async () => {
    const res = await confirm(dailyDelivered, {
      receiptNumber: 'RC-again',
      billedSide: 'destination',
      version: (await read(dailyDelivered)).version,
    });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_ALREADY_CONFIRMED);
    const row = (await boardOf(D)).shipments.find((r) => r.id === dailyDelivered);
    expect(row?.deliveryConfirmation?.receiptNumber).toBe('RC-1001');
  });

  it('refuses no receipt number, a number too long and no side — 422, the box named', async () => {
    const before = await read(dailyCompleted);
    const version = before.version;
    for (const receiptNumber of [undefined, null, '', '    ']) {
      const res = await confirm(dailyCompleted, { receiptNumber, billedSide: 'origin', version });
      expect(res.status, String(receiptNumber)).toBe(422);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED);
      expect(errorOf(res).details?.[0]).toMatchObject({ field: 'receiptNumber', code: 'REQUIRED' });
    }
    const long = await confirm(dailyCompleted, {
      receiptNumber: 'x'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX + 1),
      billedSide: 'origin',
      version,
    });
    expect(long.status).toBe(422);
    expect(errorOf(long).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG);
    expect(errorOf(long).details?.[0]).toEqual({
      field: 'receiptNumber',
      code: 'MAX_LENGTH',
      message: String(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX),
    });
    for (const billedSide of [undefined, null]) {
      const res = await confirm(dailyCompleted, { receiptNumber: 'RC-4', billedSide, version });
      expect(res.status, String(billedSide)).toBe(422);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED);
      expect(errorOf(res).details?.[0]).toMatchObject({ field: 'billedSide', code: 'REQUIRED' });
    }
    // A side that is neither, or a bank or person the client names, is not this endpoint's body.
    for (const body of [
      { receiptNumber: 'RC-4', billedSide: 'middle', version },
      { receiptNumber: 'RC-4', billedSide: 'origin', billedBankId: bankB.id, version },
      { receiptNumber: 'RC-4', billedSide: 'origin', confirmedById: adminId, version },
    ]) {
      expect((await confirm(dailyCompleted, body)).status).toBe(400);
    }
    expect(await read(dailyCompleted)).toEqual(before);
  });

  it('refuses a stale version — 409 — and a deleted shipment — 404', async () => {
    const before = await read(dailyCompleted);
    const stale = await confirm(dailyCompleted, {
      receiptNumber: 'RC-5',
      billedSide: 'origin',
      version: before.version - 1,
    });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe(ErrorCodes.STALE_DOCUMENT);
    expect(await read(dailyCompleted)).toEqual(before);
    const gone = await confirm(deletedDelivered, {
      receiptNumber: 'RC-6',
      billedSide: 'origin',
      version: 1,
    });
    expect(gone.status).toBe(404);
    expect((await undo(deletedDelivered, { version: 1 })).status).toBe(404);
  });

  it('is the ✓ grant’s alone — a reader may not press it', async () => {
    const before = await read(dailyCompleted);
    const res = await confirm(
      dailyCompleted,
      { receiptNumber: 'RC-7', billedSide: 'origin', version: before.version },
      viewerToken,
    );
    expect(res.status).toBe(403);
    expect((await undo(dailyDelivered, { version: 0 }, viewerToken)).status).toBe(403);
    expect(await read(dailyCompleted)).toEqual(before);
  });
});

describe('Round 33 B — «إلغاء التأكيد»', () => {
  it('takes the confirmation back, records it, and leaves nothing else changed', async () => {
    const before = await read(crossBank);
    const stale = await undo(crossBank, { version: before.version - 1 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe(ErrorCodes.STALE_DOCUMENT);

    const res = await undo(crossBank, { version: before.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsDeliveryConfirmationResultDto>(res)).toEqual({
      shipmentId: crossBank,
      version: before.version + 1,
      deliveryConfirmation: null,
    });
    const after = await read(crossBank);
    expect({ ...after, version: before.version, updatedAt: before.updatedAt }).toEqual(before);
    const row = (await boardOf(D)).shipments.find((r) => r.id === crossBank);
    expect(row?.deliveryConfirmation).toBeNull();

    const entry = (await logOf(crossBank)).entries.at(-1);
    expect(entry?.kind).toBe('deliveryUnconfirmed');
    expect(entry?.changes).toEqual([
      { field: 'deliveryReceiptNumber', old: 'RC-2002', new: null },
      { field: 'billedBank', old: 'مصر', new: null },
    ]);
    expect(
      seenEvents.some(
        (e) =>
          e.name === OperationsEvents.ShipmentDeliveryUnconfirmed &&
          (e.payload as { shipmentId: string }).shipmentId === crossBank,
      ),
    ).toBe(true);

    // Nothing left to take back — 409; and it may be confirmed again, the other side this time.
    const again = await undo(crossBank, { version: after.version });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_NOT_CONFIRMED);
    const reconfirmed = await confirm(crossBank, {
      receiptNumber: 'RC-2003',
      billedSide: 'origin',
      version: after.version,
    });
    expect(reconfirmed.status).toBe(200);
    expect(
      data<OperationsDeliveryConfirmationResultDto>(reconfirmed).deliveryConfirmation?.billedBankId,
    ).toBe(bankA.id);
  });
});

describe('Round 33 B — the receipt photo: «اختيارية مع تنبيه»', () => {
  it('takes a FIRST photo on a محصنة that reached its bank — and keeps Round 10’s lock otherwise', async () => {
    // Out of the vault and delivered, no photo yet: the bank's receipt may be photographed.
    const first = await upload(securedDelivered);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(data<OperationsShipmentDto>(first).receiptImage?.fileName).toBe('receipt.png');
    const row = (await boardOf(D)).shipments.find((r) => r.id === securedDelivered);
    expect(row?.receiptImage).not.toBeNull();
    // …once: what is there now is not replaced or deleted on a locked row.
    const replaced = await upload(securedDelivered);
    expect(replaced.status).toBe(409);
    expect(errorOf(replaced).code).toBe(ErrorCodes.OPERATIONS_SECURED_LOCKED);
    const removed = await request(app)
      .delete(`/api/v1/operations/shipments/${securedDelivered}/receipt-image`)
      .set('Authorization', `Bearer ${deskToken}`);
    expect(removed.status).toBe(409);
    expect(errorOf(removed).code).toBe(ErrorCodes.OPERATIONS_SECURED_LOCKED);

    // In the vault, or out and not delivered yet: locked as since Round 10.
    for (const id of [securedInVault, securedOut]) {
      const res = await upload(id);
      expect(res.status, id).toBe(409);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_SECURED_LOCKED);
      expect((await read(id)).receiptImage).toBeNull();
    }
    // A daily row takes its photo as on the day board, confirmed or not.
    const daily = await upload(dailyDelivered);
    expect(daily.status).toBe(200);
    expect((await read(dailyDelivered)).receiptImage).not.toBeNull();
  });
});

describe('Round 33 critic — a confirmed delivery keeps the two branches it was billed between', () => {
  const edit = (id: string, body: Record<string, unknown>): request.Test =>
    request(app)
      .patch(`/api/v1/operations/shipments/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  it('refuses moving «من فرع» or «إلى فرع» while confirmed — 409, nothing written — and edits the rest', async () => {
    // Bank A's branch → bank B's branch, delivered on D, confirmed «من»: bank A billed.
    const id = (
      await book({ secondaryBankId: bankB.id, destinationBranchId: branchB.id, areaName: 'الهرم' })
    ).id;
    await stampLeg(id, 'pickup', 'delivered', cairoAt(D, 15 * 60));
    const confirmed = await confirm(id, {
      receiptNumber: 'RC-8008',
      billedSide: 'origin',
      version: (await read(id)).version,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const record = data<OperationsDeliveryConfirmationResultDto>(confirmed).deliveryConfirmation;
    expect(record).toMatchObject({ billedBranchId: branchA.id, billedBankId: bankA.id });

    // Either branch moved — as the day board's or the history's edit form would send it — is refused,
    // and neither the shipment nor «السجل» moves.
    const before = await read(id);
    const logBefore = (await logOf(id)).entries.length;
    for (const body of [
      { originBranchId: branchA2.id },
      { destinationBranchId: branchA2.id, secondaryBankId: null },
      { originBranchId: branchB.id, destinationBranchId: branchA.id },
    ]) {
      const res = await edit(id, { ...body, version: before.version });
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED);
      expect(await read(id)).toEqual(before);
    }
    expect((await logOf(id)).entries).toHaveLength(logBefore);
    const row = (await boardOf(D)).shipments.find((r) => r.id === id);
    expect(row?.deliveryConfirmation).toEqual(record);

    // The form sends every field back: the two branches UNCHANGED are no move, and the rest edits
    // as before — the notes, and the billed main bank, which the confirmation does not read.
    const kept = await edit(id, {
      originBranchId: branchA.id,
      destinationBranchId: branchB.id,
      mainBankId: bankB.id,
      notes: 'تصحيح الملاحظة',
      version: before.version,
    });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    const edited = data<OperationsShipmentDto>(kept);
    expect(edited.notes).toBe('تصحيح الملاحظة');
    expect(edited.mainBankId).toBe(bankB.id);
    expect((await boardOf(D)).shipments.find((r) => r.id === id)?.deliveryConfirmation).toEqual(
      record,
    );

    // «إلغاء التأكيد» first, then the edit, then the ✓ again — on the branch it has now.
    const undone = await undo(id, { version: edited.version });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    const moved = await edit(id, {
      mainBankId: bankA.id,
      destinationBranchId: branchA2.id,
      secondaryBankId: null,
      version: data<OperationsDeliveryConfirmationResultDto>(undone).version,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(data<OperationsShipmentDto>(moved).destinationBranchId).toBe(branchA2.id);
    const again = await confirm(id, {
      receiptNumber: 'RC-8009',
      billedSide: 'destination',
      version: data<OperationsShipmentDto>(moved).version,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(data<OperationsDeliveryConfirmationResultDto>(again).deliveryConfirmation).toMatchObject(
      {
        billedSide: 'destination',
        billedBranchId: branchA2.id,
        billedBankId: bankA.id,
      },
    );
  });
});
