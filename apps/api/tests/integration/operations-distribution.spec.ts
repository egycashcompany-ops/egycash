// Round 12 over real HTTP, real RBAC and a real database:
//
//   «توزيع المحصنات» — `GET`/`POST /operations/secured/distribution`: «المحصنة اللى يومها هتخرج هتظهر
//     تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى اتحط عليها القادة والاخصائين والاتجاه …
//     وهشد المحصنة احطها على العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ».
//   «تسليم المحصنات» — the same read for the vault, then the existing dispatch per van: «بس لما يدوس
//     تسليم المحصنات هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة».
//   «سجل الخزينة» — «سجل الشحنات» for the محصنات alone (`type=secured` on the history and the deleted
//     list), under «تقرير الخزينة»: what the vault holds NOW, per bank (`GET /reports/vault/held`).
//
// Every day here is RELATIVE and in the future (the boards refuse a past day, and the Fleet roster
// plans the future), far from every other suite's fixture days — each integration file boots its own
// database, so nothing here can collide with another file's rows anyway. The one exception is the
// OVERDUE fixtures: «متأخرة» means the delivery day has PASSED (before today), and nothing books or
// plans a past day, so they are booked and planned on EARLY and then the clock is played forward
// for them — their dates, and EARLY's operating day, moved to PAST in the database.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  OperationsEvents,
  SettingKeys,
  addDaysYmd,
  cairoYmd,
  platformPermissions,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCrewBoardDto,
  type OperationsCurrencyDto,
  type OperationsDeletedShipmentsDto,
  type OperationsSecuredDispatchBoardDto,
  type OperationsSecuredDistributionDto,
  type OperationsSecuredDistributionRowDto,
  type OperationsSecuredDistributionSaveDto,
  type OperationsShipmentDto,
  type OperationsShipmentHistoryDto,
  type OperationsShipmentLogDto,
  type OperationsVaultHeldReportDto,
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
let viewerToken = ''; // operationsShipment.view only — reads the screen, may not save it
let vaultToken = ''; // operationsVault.view + dispatch — «تسليم المحصنات», no crew plan, no save
let nobodyToken = ''; // an Operations grant that is neither of the screen's
const seenEvents: { name: string; payload: unknown }[] = [];

const shift = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const COLLECT = shift(40);
/** Where the overdue ones are booked and planned before their dates are moved to PAST. */
const EARLY = shift(41);
/**
 * YESTERDAY on the Cairo calendar — the day the overdue ones were due: it has passed, so on every
 * screen from today on they are «متأخرة».
 */
const PAST = addDaysYmd(cairoYmd(new Date()), -1);
/**
 * A day AFTER today and BEFORE DAY, with a van of its own. A shipment in the vault due on it is
 * NOT late on DAY's screen — it is SOON's, on SOON's van — and is not listed there.
 */
const SOON = shift(42);
/** THE distribution day. */
const DAY = shift(43);
/** Another day with its own vans — a crew row of it is refused on DAY's save. */
const OTHER = shift(44);
/** A day with no vans planned at all. */
const EMPTY = shift(46);
const iso = (ymd: string): string => `${ymd}T00:00:00.000Z`;

let branchId = '';
let departmentId = '';
let jobTitleId = '';
let typeId = '';
let bankA: OperationsBankDto;
let bankB: OperationsBankDto;
let branchA: OperationsBankBranchDto;
let branchB: OperationsBankBranchDto;
let egp: OperationsCurrencyDto;

let capA = '';
let capB = '';
let capC = '';
let spec1 = '';
let spec2 = '';
let van1 = ''; // OPS-D1 — two captains (A, B), «المعادي - حلوان»
let van2 = ''; // OPS-D2 — captain C, «الهرم»
let van3 = ''; // OPS-D3 — NO captain, «المعادي»: listed, never proposed, never placeable
let crew1 = '';
let crew2 = '';
let crew3 = '';
let earlyCrew = '';
let soonCrew = '';
let otherCrew = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-distribution-test-${Date.now()}`;
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

const waitFor = async (predicate: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

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

const tokenWith = async (email: string, permissionKeys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `R12 ${email}`, ar: `دور ${email}` }, permissionKeys },
    adminId,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

let nid = 0;
let phone = 61_000_000;
const mkEmployee = async (fullNameAr: string): Promise<string> => {
  nid += 1;
  phone += 1;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `290010101${String(80_000 + nid).padStart(5, '0')}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `011${String(phone).padStart(8, '0')}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

const mkVehicle = async (code: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code,
      typeId,
      plateNumber: `ت ز ${code.slice(-1)}`,
      chassisNumber: `${code}-CH`,
      motorNumber: `${code}-MO`,
      joinedAt: '2024-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-01-01T00:00:00.000Z',
      branchId,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetVehicleDto>(res).id;
};

/** Put vans on the Fleet roster for a day, then plan their cash crews; the crew row id per van. */
const planDay = async (
  date: string,
  rows: {
    vehicleId: string;
    captainEmployeeIds?: string[];
    specialist1EmployeeIds?: string[];
    specialist2EmployeeIds?: string[];
    direction?: string;
    plannedTime?: string;
  }[],
): Promise<Map<string, string>> => {
  const roster = await request(app)
    .post('/api/v1/fleet/roster')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ date, rows: rows.map((r) => ({ vehicleId: r.vehicleId, notes: 'round 12 seed' })) });
  expect(roster.status, JSON.stringify(roster.body)).toBe(200);
  const plan = await request(app)
    .post('/api/v1/operations/crew-board')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ date, rows });
  expect(plan.status, JSON.stringify(plan.body)).toBe(200);
  const ids = new Map<string, string>();
  for (const row of data<OperationsCrewBoardDto>(plan).rows) {
    if (row.crew !== null) ids.set(row.vehicleId, row.crew.id);
  }
  return ids;
};

let booked = 0;
/** A محصنة of bank A (or another), due out on `deliveryDate`, in the area given. */
const book = async (
  deliveryDate: string,
  areaName: string | null,
  over: Record<string, unknown> = {},
): Promise<OperationsShipmentDto> => {
  booked += 1;
  const res = await request(app)
    .post('/api/v1/operations/shipments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      shipmentType: 'secured',
      mainBankId: bankA.id,
      originBranchId: branchA.id,
      destinationBranchId: branchA.id,
      areaName,
      lines: [{ currencyId: egp.id, amount: 1000 + booked }],
      collectionDate: COLLECT,
      deliveryDate,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<OperationsShipmentDto>(res);
};

const read = async (id: string): Promise<OperationsShipmentDto> =>
  data<OperationsShipmentDto>(
    await request(app)
      .get(`/api/v1/operations/shipments/${id}`)
      .set('Authorization', `Bearer ${adminToken}`),
  );

/** The desk's pickup ✓ then the vault's ✓ — the shipment is IN THE VAULT. */
const intoVault = async (id: string, bags = 2): Promise<void> => {
  const picked = await request(app)
    .post(`/api/v1/operations/secured/${id}/pickup`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: (await read(id)).version });
  expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  const received = await request(app)
    .post(`/api/v1/operations/secured/${id}/receive`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      receiptNumber: `R12-${id.slice(-6)}`,
      bagCount: bags,
      receivedByPrimaryId: spec1,
      receivedBySecondaryId: spec2,
      version: (await read(id)).version,
    });
  expect(received.status, JSON.stringify(received.body)).toBe(200);
};

const assignDelivery = async (id: string, crewAssignmentId: string, captainEmployeeId: string) => {
  const res = await request(app)
    .post(`/api/v1/operations/secured/${id}/assign-delivery`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ crewAssignmentId, captainEmployeeId, version: 0 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const distribution = (query = '', token = adminToken): Promise<request.Response> =>
  request(app)
    .get(`/api/v1/operations/secured/distribution${query}`)
    .set('Authorization', `Bearer ${token}`);
const viewOf = async (
  date = DAY,
  token = adminToken,
): Promise<OperationsSecuredDistributionDto> => {
  const res = await distribution(`?date=${date}`, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsSecuredDistributionDto>(res);
};
const rowOf = async (id: string): Promise<OperationsSecuredDistributionRowDto | undefined> =>
  (await viewOf()).shipments.find((s) => s.id === id);

interface Change {
  shipmentId: string;
  crewAssignmentId: string | null;
  captainEmployeeId: string | null;
  version: number | null;
}
const save = (changes: Change[], date = DAY, token = adminToken): Promise<request.Response> =>
  request(app)
    .post('/api/v1/operations/secured/distribution')
    .set('Authorization', `Bearer ${token}`)
    .send({ date, changes });
/** A change as the screen sends it: the row's own `deliveryLegVersion` read just now. */
const place = async (
  shipmentId: string,
  crewAssignmentId: string | null,
  captainEmployeeId: string | null,
): Promise<Change> => ({
  shipmentId,
  crewAssignmentId,
  captainEmployeeId,
  version: (await rowOf(shipmentId))?.deliveryLegVersion ?? null,
});

const logOf = async (id: string): Promise<OperationsShipmentLogDto> =>
  data<OperationsShipmentLogDto>(
    await request(app)
      .get(`/api/v1/operations/shipments/${id}/log`)
      .set('Authorization', `Bearer ${adminToken}`),
  );
const deliveryLegOf = (shipmentId: string) =>
  OperationsShipmentAssignmentModel.findOne({ shipmentId, leg: 'delivery', isDeleted: false })
    .lean()
    .exec();

// The shipments of DAY's screen and around it.
let dueDraft = ''; // draft, due on DAY, «المعادى» → proposed onto van 1 only (van 3 has no captain)
let dueVault = ''; // in the vault, due on DAY, «الهرم» → van 2
let dueVault2 = ''; // in the vault, due on DAY, «حلوان» → van 1
let dueNowhere = ''; // in the vault, due on DAY, «الدقي» → no van
let overdueWithLeg = ''; // in the vault, due on PAST, its leg on PAST's van — «متأخرة»
let overdueNoLeg = ''; // in the vault, due on PAST, no leg — «متأخرة»
let overdueDraft = ''; // draft due on PAST — not in the vault, so not DAY's: never listed, refused
let heldSoon = ''; // in the vault, due on SOON, on SOON's van — not late: SOON's, never DAY's
let otherDayDraft = ''; // draft due on OTHER — not DAY's
let alreadyOut = ''; // due on DAY, dispatched on van 2 — gone from the vault
let daily = ''; // a daily shipment — not a محصنة at all

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  for (const name of Object.values(OperationsEvents)) {
    subscribe(name, `test.r12.${name}`, (envelope) => {
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
  adminId = await mkUser('ops-r12-admin@ecms.local');
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
  adminToken = await login('ops-r12-admin@ecms.local');
  viewerToken = await tokenWith('ops-r12-viewer@ecms.local', ['operationsShipment.view']);
  vaultToken = await tokenWith('ops-r12-vault@ecms.local', [
    'operationsVault.view',
    'operationsVault.dispatch',
  ]);
  nobodyToken = await tokenWith('ops-r12-crew@ecms.local', ['operationsCrew.view']);

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '81', name: { ar: 'فرع التوزيع', en: 'Distribution Branch' } });
  expect(branchRes.status).toBe(201);
  branchId = data<{ id: string }>(branchRes).id;
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-R12', name: { ar: 'نقل الأموال', en: 'Cash Transfer' }, branchId });
  expect(dept.status).toBe(201);
  departmentId = data<{ id: string }>(dept).id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-R12', name: { ar: 'أخصائي عمليات', en: 'Ops Specialist' }, jobGrade: 'G1' });
  expect(title.status).toBe(201);
  jobTitleId = data<{ id: string }>(title).id;
  const type = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: { ar: 'مصفحة توزيع', en: 'Distribution Armored' },
      maintenanceIntervalKm: 10_000,
    });
  expect(type.status).toBe(201);
  typeId = data<FleetVehicleTypeDto>(type).id;

  // Created out of code order, so the screen's van-code order is the server's doing.
  van3 = await mkVehicle('OPS-D3');
  van1 = await mkVehicle('OPS-D1');
  van2 = await mkVehicle('OPS-D2');
  capA = await mkEmployee('قائد أول');
  capB = await mkEmployee('قائد ثان');
  capC = await mkEmployee('قائد ثالث');
  spec1 = await mkEmployee('أخصائي أول');
  spec2 = await mkEmployee('أخصائي ثان');

  const dayCrews = await planDay(DAY, [
    {
      vehicleId: van1,
      captainEmployeeIds: [capA, capB],
      specialist1EmployeeIds: [spec1],
      direction: 'المعادي - حلوان',
      plannedTime: '08:00',
    },
    { vehicleId: van2, captainEmployeeIds: [capC], direction: 'الهرم' },
    { vehicleId: van3, specialist2EmployeeIds: [spec2], direction: 'المعادي' },
  ]);
  crew1 = dayCrews.get(van1) ?? '';
  crew2 = dayCrews.get(van2) ?? '';
  crew3 = dayCrews.get(van3) ?? '';
  expect([crew1, crew2, crew3].every((id) => id !== '')).toBe(true);
  earlyCrew =
    (await planDay(EARLY, [{ vehicleId: van1, captainEmployeeIds: [capA] }])).get(van1) ?? '';
  soonCrew =
    (
      await planDay(SOON, [{ vehicleId: van2, captainEmployeeIds: [capC], direction: 'الهرم' }])
    ).get(van2) ?? '';
  otherCrew =
    (await planDay(OTHER, [{ vehicleId: van2, captainEmployeeIds: [capC] }])).get(van2) ?? '';

  const bankRes = await request(app)
    .post('/api/v1/operations/banks')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 1, name: { ar: 'البنك الأهلي', en: 'NBE' }, opsName: 'الأهلي' });
  bankA = data<OperationsBankDto>(bankRes);
  const bankBRes = await request(app)
    .post('/api/v1/operations/banks')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 2, name: { ar: 'بنك مصر', en: 'Banque Misr' }, opsName: 'مصر' });
  bankB = data<OperationsBankDto>(bankBRes);
  branchA = data<OperationsBankBranchDto>(
    await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: bankA.id, name: 'فرع المعادي', code: 'A-1', opsAreaName: 'المعادي' }),
  );
  branchB = data<OperationsBankBranchDto>(
    await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: bankB.id, name: 'فرع الهرم', code: 'B-1', opsAreaName: 'الهرم' }),
  );
  egp = data<OperationsCurrencyDto>(
    await request(app)
      .post('/api/v1/operations/currencies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'EGP', name: 'مصري', legacyAliases: ['مصري', 'جنيه', 'EGP'] }),
  );

  dueDraft = (await book(DAY, 'المعادى')).id;
  dueVault = (await book(DAY, 'الهرم')).id;
  await intoVault(dueVault);
  dueVault2 = (await book(DAY, 'حلوان')).id;
  await intoVault(dueVault2);
  dueNowhere = (await book(DAY, 'الدقي')).id;
  await intoVault(dueNowhere);
  overdueWithLeg = (await book(EARLY, 'المعادي')).id;
  await intoVault(overdueWithLeg);
  await assignDelivery(overdueWithLeg, earlyCrew, capA);
  overdueNoLeg = (await book(EARLY, 'الهرم')).id;
  await intoVault(overdueNoLeg);
  overdueDraft = (await book(EARLY, 'المعادي')).id;
  // …and their day passes: due on PAST (collected then too), EARLY's operating day — the van
  // overdueWithLeg was put on — becoming PAST's. The API books and plans no past day, so the clock
  // is played forward here, in the database.
  await OperationsShipmentModel.updateMany(
    { _id: { $in: [overdueWithLeg, overdueNoLeg, overdueDraft] } },
    { $set: { collectionDate: new Date(iso(PAST)), deliveryDate: new Date(iso(PAST)) } },
  ).exec();
  await OperationsShipmentModel.db
    .collection('operations_days')
    .updateOne({ date: new Date(iso(EARLY)) }, { $set: { date: new Date(iso(PAST)) } });
  heldSoon = (await book(SOON, 'الهرم')).id;
  await intoVault(heldSoon);
  await assignDelivery(heldSoon, soonCrew, capC);
  otherDayDraft = (await book(OTHER, 'الهرم')).id;
  alreadyOut = (await book(DAY, 'الهرم')).id;
  await intoVault(alreadyOut);
  await assignDelivery(alreadyOut, crew2, capC);
  const out = await request(app)
    .post('/api/v1/operations/secured/dispatch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ crewAssignmentId: crew2, shipmentIds: [alreadyOut] });
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  const dailyRes = await request(app)
    .post('/api/v1/operations/shipments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      shipmentType: 'daily',
      mainBankId: bankA.id,
      originBranchId: branchA.id,
      destinationBranchId: branchA.id,
      lines: [{ currencyId: egp.id, amount: 500 }],
      collectionDate: DAY,
    });
  expect(dailyRes.status, JSON.stringify(dailyRes.body)).toBe(201);
  daily = data<OperationsShipmentDto>(dailyRes).id;
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('«توزيع المحصنات» — GET /operations/secured/distribution', () => {
  it('opens on TODAY in Cairo, and refuses a day that has passed', async () => {
    const today = cairoYmd(new Date());
    const res = await distribution();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = data<OperationsSecuredDistributionDto>(res);
    expect(view.date).toBe(iso(today));
    expect(view.today).toBe(iso(today));

    const past = await distribution(`?date=${addDaysYmd(today, -1)}`);
    expect(past.status).toBe(422);
    expect(errorOf(past).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_DAY_IN_PAST);
    expect(errorOf(past).details).toEqual([{ field: 'date', code: 'MIN_DATE', message: today }]);
    for (const bad of ['?date=', '?date=not-a-day', '?from=2026-11-01']) {
      expect((await distribution(bad)).status, bad).toBe(400);
    }
  });

  it('lists EVERY van of the day, in van-code order, with its crew and direction', async () => {
    const view = await viewOf();
    expect(view.date).toBe(iso(DAY));
    expect(view.crewPlanVisible).toBe(true);
    expect(view.crews.map((c) => c.vehicleCode)).toEqual(['OPS-D1', 'OPS-D2', 'OPS-D3']);
    const first = view.crews[0];
    expect(first).toMatchObject({
      crewAssignmentId: crew1,
      vehicleId: van1,
      direction: 'المعادي - حلوان',
      plannedTime: '08:00',
    });
    expect(first?.captains.map((p) => [p.employeeId, p.fullNameAr])).toEqual([
      [capA, 'قائد أول'],
      [capB, 'قائد ثان'],
    ]);
    expect(first?.specialist1.map((p) => p.employeeId)).toEqual([spec1]);
    expect(view.crews[2]).toMatchObject({ crewAssignmentId: crew3, captains: [] });
    // A day nobody planned has no vans, and still answers.
    expect((await viewOf(EMPTY)).crews).toEqual([]);
  });

  it('lists the day’s محصنات at any stage before dispatch, and the OVERDUE ones still in the vault', async () => {
    const view = await viewOf();
    const ids = view.shipments.map((s) => s.id);
    expect(ids.sort()).toEqual(
      [dueDraft, dueVault, dueVault2, dueNowhere, overdueWithLeg, overdueNoLeg].sort(),
    );
    // Never: a draft due on another day (overdue or not), a dispatched one, a daily one — nor one
    // in the vault due between today and DAY: it is not late, it is its own day's.
    for (const out of [overdueDraft, otherDayDraft, alreadyOut, daily, heldSoon]) {
      expect(ids).not.toContain(out);
    }
    // The overdue lead.
    expect(
      view.shipments
        .slice(0, 2)
        .map((s) => s.id)
        .sort(),
    ).toEqual([overdueWithLeg, overdueNoLeg].sort());
    const draft = view.shipments.find((s) => s.id === dueDraft);
    expect(draft).toMatchObject({
      status: 'draft',
      securedStage: 'awaitingPickup',
      overdue: false,
      vaultReceivedAt: null,
      delivery: null,
      deliveryLegVersion: null,
      placedCrewAssignmentId: null,
      origin: expect.objectContaining({ bankName: 'الأهلي' }) as unknown,
    });
    const late = view.shipments.find((s) => s.id === overdueWithLeg);
    expect(late).toMatchObject({
      status: 'inVault',
      overdue: true,
      deliveryDate: iso(PAST),
      // Its leg rides its own (passed) day's van — not a van of this day, so it is unplaced here.
      delivery: {
        crewAssignmentId: earlyCrew,
        captainEmployeeId: capA,
        executionStatus: 'pending',
      },
      deliveryLegVersion: 0,
      placedCrewAssignmentId: null,
    });
    expect(late?.vaultReceivedAt).not.toBeNull();
  });

  it('calls «متأخرة» only a day that has PASSED — one due between today and the day is its own day’s', async () => {
    // heldSoon is in the vault, due on SOON (after today, before DAY) and on SOON's van. On DAY's
    // screen it is not late and not listed (above); were it, it would sit unplaced (its van is
    // SOON's), its area would propose it onto DAY's «الهرم» van, and one «حفظ» would pull it off
    // SOON's van and push its delivery to DAY.
    const onSoon = (await viewOf(SOON)).shipments;
    expect(onSoon.find((s) => s.id === heldSoon)).toMatchObject({
      status: 'inVault',
      overdue: false,
      deliveryDate: iso(SOON),
      placedCrewAssignmentId: soonCrew,
    });
    // The ones whose day has passed are late on every screen from today on — today's included.
    const late = (view: OperationsSecuredDistributionDto) =>
      view.shipments
        .filter((s) => s.overdue)
        .map((s) => s.id)
        .sort();
    const passed = [overdueWithLeg, overdueNoLeg].sort();
    expect(late(await viewOf(SOON))).toEqual(passed);
    expect(late(await viewOf(cairoYmd(new Date())))).toEqual(passed);
    expect(late(await viewOf())).toEqual(passed);

    // …and the save agrees with the read: DAY's van cannot take it.
    const res = await save([
      {
        shipmentId: heldSoon,
        crewAssignmentId: crew2,
        captainEmployeeId: capC,
        version: onSoon.find((s) => s.id === heldSoon)?.deliveryLegVersion ?? null,
      },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_NOT_ON_DAY);
    expect(errorOf(res).details).toEqual([
      { field: 'shipmentId', code: 'SHIPMENT', message: heldSoon },
    ]);
    expect((await read(heldSoon)).deliveryDate).toBe(iso(SOON));
    expect(String((await deliveryLegOf(heldSoon))?.crewAssignmentId)).toBe(soonCrew);

    // It goes out on its own day's van — and so leaves the vault the reports below count.
    const out = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: soonCrew, shipmentIds: [heldSoon] });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
  });

  it('points each shipment at the vans its area’s direction names — a captainless van never', async () => {
    const view = await viewOf();
    const vansOf = (id: string) =>
      view.shipments.find((s) => s.id === id)?.directionCrewAssignmentIds;
    // «المعادى» folds to van 1's «المعادي»; van 3 says «المعادي» too but has no captain.
    expect(vansOf(dueDraft)).toEqual([crew1]);
    expect(vansOf(dueVault)).toEqual([crew2]);
    expect(vansOf(dueVault2)).toEqual([crew1]);
    expect(vansOf(dueNowhere)).toEqual([]);
  });

  it('opens for the vault too — vans and captains, the rest of the crew plan withheld', async () => {
    const view = await viewOf(DAY, vaultToken);
    expect(view.crewPlanVisible).toBe(false);
    expect(view.crews.map((c) => c.crewAssignmentId)).toEqual([crew1, crew2, crew3]);
    expect(view.crews[0]?.captains.map((p) => p.employeeId)).toEqual([capA, capB]);
    expect(view.crews[0]?.direction).toBe('المعادي - حلوان');
    for (const van of view.crews) {
      expect(van.specialist1).toEqual([]);
      expect(van.specialist2).toEqual([]);
      expect(van.drivers).toEqual([]);
    }
    expect(view.shipments).toHaveLength(6);
    // The shipment grant alone reads it too; a grant that is neither of the screen's does not.
    expect((await distribution(`?date=${DAY}`, viewerToken)).status).toBe(200);
    expect((await distribution(`?date=${DAY}`, nobodyToken)).status).toBe(403);
  });
});

describe('«حفظ» — POST /operations/secured/distribution', () => {
  it('is operationsShipment.edit’s — a reader of the screen, or the vault, may not save it', async () => {
    const change = await place(dueVault, crew2, capC);
    for (const token of [viewerToken, vaultToken, nobodyToken]) {
      expect((await save([change], DAY, token)).status).toBe(403);
    }
    expect(await deliveryLegOf(dueVault)).toBeNull();
  });

  it('places shipments on vans — a draft one too — in one request, each at the end of its captain’s route', async () => {
    const before = seenEvents.length;
    const res = await save([
      await place(dueVault, crew2, capC),
      await place(dueVault2, crew1, capA),
      // The van carries two captains; this one goes with the second.
      await place(dueDraft, crew1, capB),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(res)).toEqual({
      date: iso(DAY),
      changed: 3,
      rescheduled: 0,
    });

    const view = await viewOf();
    const row = (id: string) => view.shipments.find((s) => s.id === id);
    expect(row(dueVault)).toMatchObject({
      placedCrewAssignmentId: crew2,
      delivery: { crewAssignmentId: crew2, captainEmployeeId: capC, vehicleId: van2 },
      deliveryLegVersion: 0,
    });
    expect(row(dueVault2)?.delivery?.captainEmployeeId).toBe(capA);
    expect(row(dueDraft)).toMatchObject({
      status: 'draft',
      placedCrewAssignmentId: crew1,
      delivery: { captainEmployeeId: capB },
    });
    // The van a board row prints for an in-vault shipment is its delivery leg's.
    expect(row(dueVault)?.crew).toMatchObject({
      crewAssignmentId: crew2,
      captainName: 'قائد ثالث',
    });

    const legA = await deliveryLegOf(dueVault2);
    const legB = await deliveryLegOf(dueDraft);
    expect(legA?.sequence).toBe(1);
    expect(legB?.sequence).toBe(1); // capB's own list on the day

    await waitFor(
      () =>
        seenEvents.slice(before).filter((e) => e.name === OperationsEvents.SecuredLegAssigned)
          .length >= 3,
    );
    expect(
      seenEvents
        .slice(before)
        .filter((e) => e.name === OperationsEvents.SecuredLegAssigned)
        .map((e) => (e.payload as { shipmentId: string }).shipmentId)
        .sort(),
    ).toEqual([dueVault, dueVault2, dueDraft].sort());

    // «السجل» — the crew assigned on the delivery leg.
    const entry = (await logOf(dueVault2)).entries.find((e) => e.kind === 'crewAssigned');
    expect(entry).toMatchObject({
      leg: 'delivery',
      changes: expect.arrayContaining([
        { field: 'captain', old: null, new: 'قائد أول' },
      ]) as unknown,
    });
  });

  it('switches the captain on a two-captain van, and re-seats the stop in the new captain’s route', async () => {
    const res = await save([await place(dueDraft, crew1, capA)]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(res).changed).toBe(1);
    const leg = await deliveryLegOf(dueDraft);
    expect(String(leg?.captainEmployeeId)).toBe(capA);
    // capA already carries dueVault2 at 1 → this one lands at 2.
    expect(leg?.sequence).toBe(2);
    expect((await rowOf(dueDraft))?.deliveryLegVersion).toBe(1);
    const changed = (await logOf(dueDraft)).entries.filter((e) => e.kind === 'crewChanged');
    expect(changed.at(-1)?.changes).toEqual(
      expect.arrayContaining([{ field: 'captain', old: 'قائد ثان', new: 'قائد أول' }]),
    );
  });

  it('moves a shipment to another van, and writes nothing for a change that changes nothing', async () => {
    const moved = await save([await place(dueDraft, crew2, capC)]);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await rowOf(dueDraft))?.placedCrewAssignmentId).toBe(crew2);

    const version = (await rowOf(dueVault))?.deliveryLegVersion;
    const same = await save([await place(dueVault, crew2, capC)]);
    expect(same.status).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(same).changed).toBe(0);
    expect((await rowOf(dueVault))?.deliveryLegVersion).toBe(version);
  });

  it('refuses a stale version — and writes NOTHING of the save, the good changes included', async () => {
    const good = await place(dueNowhere, crew1, capA);
    const stale = { ...(await place(dueDraft, crew1, capA)), version: 0 };
    const res = await save([good, stale]);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe(ErrorCodes.STALE_DOCUMENT);
    expect(errorOf(res).details).toEqual([
      { field: 'shipmentId', code: 'SHIPMENT', message: dueDraft },
    ]);
    expect(await deliveryLegOf(dueNowhere)).toBeNull();
    expect((await rowOf(dueDraft))?.placedCrewAssignmentId).toBe(crew2);
    // A never-placed shipment sent with a version, or a placed one with null, is stale too.
    const ghost = await save([{ ...(await place(dueNowhere, crew1, capA)), version: 0 }]);
    expect(errorOf(ghost).code).toBe(ErrorCodes.STALE_DOCUMENT);
    const blind = await save([{ ...(await place(dueVault, crew1, capA)), version: null }]);
    expect(errorOf(blind).code).toBe(ErrorCodes.STALE_DOCUMENT);
  });

  it('refuses a van of another day, a captain not on the van, and a van with no captain', async () => {
    const otherDay = await save([await place(dueNowhere, otherCrew, capC)]);
    expect(otherDay.status).toBe(422);
    expect(errorOf(otherDay).code).toBe(ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH);
    expect(errorOf(otherDay).details?.[0]).toMatchObject({
      field: 'shipmentId',
      message: dueNowhere,
    });

    const notHis = await save([await place(dueNowhere, crew1, capC)]);
    expect(notHis.status).toBe(422);
    expect(errorOf(notHis).code).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);
    const noCaptain = await save([await place(dueNowhere, crew3, capA)]);
    expect(errorOf(noCaptain).code).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);

    const noVan = await save([await place(dueNowhere, '0000000000000000000000ff', capA)]);
    expect(noVan.status).toBe(404);
    expect(errorOf(noVan).details?.[0]).toMatchObject({ message: dueNowhere });
    expect(await deliveryLegOf(dueNowhere)).toBeNull();
  });

  it('refuses a shipment that has left the vault, one that is not the day’s, and a daily one', async () => {
    const out = await save([
      { shipmentId: alreadyOut, crewAssignmentId: crew2, captainEmployeeId: capC, version: 0 },
    ]);
    expect(out.status).toBe(409);
    expect(errorOf(out).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED);
    expect(errorOf(out).details).toEqual([
      { field: 'shipmentId', code: 'SHIPMENT', message: alreadyOut },
    ]);
    for (const notToday of [otherDayDraft, overdueDraft]) {
      const res = await save([
        { shipmentId: notToday, crewAssignmentId: crew1, captainEmployeeId: capA, version: null },
      ]);
      expect(res.status, notToday).toBe(422);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_NOT_ON_DAY);
    }
    const notSecured = await save([
      { shipmentId: daily, crewAssignmentId: crew1, captainEmployeeId: capA, version: null },
    ]);
    expect(notSecured.status).toBe(422);
    expect(errorOf(notSecured).code).toBe(ErrorCodes.OPERATIONS_NOT_A_SECURED_SHIPMENT);
    const missing = await save([
      {
        shipmentId: '0000000000000000000000aa',
        crewAssignmentId: crew1,
        captainEmployeeId: capA,
        version: null,
      },
    ]);
    expect(missing.status).toBe(404);
  });

  it('refuses a past day, a van without its captain, and a shipment twice', async () => {
    const yesterday = addDaysYmd(cairoYmd(new Date()), -1);
    const past = await save([await place(dueNowhere, crew1, capA)], yesterday);
    expect(past.status).toBe(422);
    expect(errorOf(past).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_DAY_IN_PAST);
    const half = await save([
      { shipmentId: dueNowhere, crewAssignmentId: crew1, captainEmployeeId: null, version: null },
    ]);
    expect(half.status).toBe(400);
    const twice = await save([
      await place(dueNowhere, crew1, capA),
      await place(dueNowhere, crew2, capC),
    ]);
    expect(twice.status).toBe(400);
    expect((await save([])).status).toBe(400);
  });

  it('places an OVERDUE shipment on a van of the day — and moves its delivery date there, logged as such', async () => {
    const before = seenEvents.length;
    const res = await save([
      await place(overdueWithLeg, crew1, capA),
      await place(overdueNoLeg, crew2, capC),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(res)).toEqual({
      date: iso(DAY),
      changed: 2,
      rescheduled: 2,
    });

    for (const [id, crew] of [
      [overdueWithLeg, crew1],
      [overdueNoLeg, crew2],
    ] as const) {
      const shipment = await read(id);
      expect(shipment).toMatchObject({ status: 'inVault', deliveryDate: iso(DAY) });
      const row = await rowOf(id);
      expect(row).toMatchObject({ overdue: false, placedCrewAssignmentId: crew });
    }
    // The leg left PAST's van for a van of DAY — on DAY's operating day.
    const leg = await deliveryLegOf(overdueWithLeg);
    expect(String(leg?.crewAssignmentId)).toBe(crew1);
    const dayCrew =
      leg === null
        ? null
        : await OperationsShipmentAssignmentModel.db
            .collection('operations_crew_assignments')
            .findOne({ _id: leg.crewAssignmentId });
    expect(dayCrew).not.toBeNull();
    expect(String(leg?.operationsDayId)).toBe(String(dayCrew?.operationsDayId));

    // «السجل»: the date moved on distribution — its own entry, not an edit — and the crew moved.
    const entries = (await logOf(overdueWithLeg)).entries;
    const moved = entries.find((e) => e.kind === 'deliveryRescheduled');
    expect(moved?.changes).toEqual([{ field: 'deliveryDate', old: PAST, new: DAY }]);
    expect(entries.some((e) => e.kind === 'edited')).toBe(false);
    expect(entries.filter((e) => e.kind === 'crewChanged').at(-1)?.leg).toBe('delivery');

    await waitFor(() =>
      seenEvents
        .slice(before)
        .some(
          (e) =>
            e.name === OperationsEvents.ShipmentUpdated &&
            (e.payload as { shipmentId: string }).shipmentId === overdueNoLeg,
        ),
    );

    // Still locked for everything else: the vault's ✓ stands.
    const edit = await request(app)
      .patch(`/api/v1/operations/shipments/${overdueWithLeg}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'تعديل', version: (await read(overdueWithLeg)).version });
    expect(edit.status).toBe(409);
    expect(errorOf(edit).code).toBe(ErrorCodes.OPERATIONS_SECURED_LOCKED);
  });

  it('takes a shipment off its van — the leg retired, its story kept — and off nothing is no change', async () => {
    const before = seenEvents.length;
    const res = await save([await place(dueVault2, null, null)]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(res).changed).toBe(1);
    expect(await deliveryLegOf(dueVault2)).toBeNull();
    expect(await rowOf(dueVault2)).toMatchObject({
      delivery: null,
      deliveryLegVersion: null,
      placedCrewAssignmentId: null,
    });
    // Its delivery date did not move.
    expect((await read(dueVault2)).deliveryDate).toBe(iso(DAY));

    const kinds = (await logOf(dueVault2)).entries
      .filter((e) => e.leg === 'delivery')
      .map((e) => e.kind);
    expect(kinds).toEqual(['crewAssigned', 'crewRemoved']);
    const removed = (await logOf(dueVault2)).entries.find((e) => e.kind === 'crewRemoved');
    expect(removed?.changes).toEqual([
      { field: 'captain', old: 'قائد أول', new: null },
      { field: 'vehicle', old: 'OPS-D1', new: null },
    ]);
    await waitFor(() =>
      seenEvents.slice(before).some((e) => e.name === OperationsEvents.SecuredLegRemoved),
    );
    expect(
      seenEvents.slice(before).find((e) => e.name === OperationsEvents.SecuredLegRemoved)?.payload,
    ).toMatchObject({
      shipmentId: dueVault2,
      leg: 'delivery',
      captainEmployeeId: capA,
      vehicleId: van1,
    });

    const nothing = await save([await place(dueVault2, null, null)]);
    expect(nothing.status).toBe(200);
    expect(data<OperationsSecuredDistributionSaveDto>(nothing).changed).toBe(0);

    // …and it can be placed again, as a new leg.
    const again = await save([await place(dueVault2, crew1, capB)]);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await rowOf(dueVault2))?.delivery?.captainEmployeeId).toBe(capB);
    expect(
      (await logOf(dueVault2)).entries.filter((e) => e.leg === 'delivery').map((e) => e.kind),
    ).toEqual(['crewAssigned', 'crewRemoved', 'crewAssigned']);
  });

  it('leaves a leg its captain has started alone', async () => {
    await OperationsShipmentAssignmentModel.updateOne(
      { shipmentId: dueVault2, leg: 'delivery', isDeleted: false },
      { $set: { executionStatus: 'active' } },
    ).exec();
    const row = await rowOf(dueVault2);
    expect(row?.delivery?.executionStatus).toBe('active');
    for (const target of [
      [crew2, capC],
      [null, null],
    ] as const) {
      const res = await save([await place(dueVault2, target[0], target[1])]);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_LEG_STARTED);
    }
    await OperationsShipmentAssignmentModel.updateOne(
      { shipmentId: dueVault2, leg: 'delivery', isDeleted: false },
      { $set: { executionStatus: 'pending' } },
    ).exec();
  });
});

describe('«تسليم المحصنات» — the vault hands each van its load with the existing dispatch', () => {
  it('sends out a van’s IN-VAULT shipments; a draft on the van stays (the vault does not hold it)', async () => {
    const view = await viewOf(DAY, vaultToken);
    const onVan2 = view.shipments.filter((s) => s.placedCrewAssignmentId === crew2);
    expect(onVan2.map((s) => s.id).sort()).toEqual([dueDraft, dueVault, overdueNoLeg].sort());
    const inVault = onVan2.filter((s) => s.status === 'inVault').map((s) => s.id);
    expect(inVault.sort()).toEqual([dueVault, overdueNoLeg].sort());

    // The draft one is refused by the dispatch — the screen does not send it.
    const withDraft = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${vaultToken}`)
      .send({ crewAssignmentId: crew2, shipmentIds: [...inVault, dueDraft] });
    expect(withDraft.status).toBe(422);
    expect(errorOf(withDraft).code).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);

    const out = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${vaultToken}`)
      .send({ crewAssignmentId: crew2, shipmentIds: inVault });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(data<{ dispatched: number }>(out).dispatched).toBe(2);

    // «هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة» — off the screen, out of the vault.
    const after = (await viewOf(DAY, vaultToken)).shipments.map((s) => s.id);
    expect(after).not.toContain(dueVault);
    expect(after).not.toContain(overdueNoLeg);
    expect(after).toContain(dueDraft);
    for (const id of inVault) expect((await read(id)).status).toBe('dispatched');
    // …and a dispatched shipment cannot be placed again.
    const late = await save([
      { shipmentId: dueVault, crewAssignmentId: crew1, captainEmployeeId: capA, version: 0 },
    ]);
    expect(errorOf(late).code).toBe(ErrorCodes.OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED);
  });
});

describe('«سجل الخزينة» — the history and the deleted list of the محصنات alone', () => {
  const range = `from=${COLLECT}&to=${OTHER}`;
  const history = async (query: string): Promise<OperationsShipmentHistoryDto> => {
    const res = await request(app)
      .get(`/api/v1/operations/shipments/history?${query}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return data<OperationsShipmentHistoryDto>(res);
  };
  const deleted = async (query: string): Promise<OperationsDeletedShipmentsDto> => {
    const res = await request(app)
      .get(`/api/v1/operations/shipments/deleted?${query}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return data<OperationsDeletedShipmentsDto>(res);
  };

  it('keeps one type with `type`, both without it', async () => {
    const all = (await history(range)).shipments;
    expect(all.some((s) => s.shipmentType === 'daily')).toBe(true);
    expect(all.some((s) => s.shipmentType === 'secured')).toBe(true);

    const secured = (await history(`${range}&type=secured`)).shipments;
    expect(secured.every((s) => s.shipmentType === 'secured')).toBe(true);
    expect(secured.map((s) => s.id)).toEqual(
      expect.arrayContaining([dueDraft, otherDayDraft, alreadyOut]),
    );
    expect(secured.map((s) => s.id)).not.toContain(daily);
    // Collected OR delivered in the range, any stage — a dispatched one included.
    expect(secured).toHaveLength(all.filter((s) => s.shipmentType === 'secured').length);

    const dailies = (await history(`${range}&type=daily`)).shipments;
    expect(dailies.map((s) => s.id)).toEqual([daily]);
    expect(
      (
        await request(app)
          .get(`/api/v1/operations/shipments/history?${range}&type=vault`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(400);
  });

  it('lists the deleted محصنات alone, and brings one back onto it', async () => {
    const gone = (await book(OTHER, 'الهرم')).id;
    for (const id of [gone, daily]) {
      const res = await request(app)
        .delete(`/api/v1/operations/shipments/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    }
    expect((await deleted(range)).shipments.map((s) => s.id).sort()).toEqual([gone, daily].sort());
    expect((await deleted(`${range}&type=secured`)).shipments.map((s) => s.id)).toEqual([gone]);
    expect((await deleted(`${range}&type=daily`)).shipments.map((s) => s.id)).toEqual([daily]);

    const back = await request(app)
      .post(`/api/v1/operations/shipments/${gone}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(back.status).toBe(200);
    expect((await history(`${range}&type=secured`)).shipments.map((s) => s.id)).toContain(gone);
    expect((await deleted(`${range}&type=secured`)).shipments).toEqual([]);
  });

  it('counts the row cap AFTER the type — a range too large for the whole history may serve its محصنات', async () => {
    const HEAVY = shift(60);
    const MARK = 'r12-history-cap-fixture';
    const row = (over: Record<string, unknown> = {}) => ({
      shipmentType: 'daily',
      status: 'draft',
      mainBankId: bankA.id,
      secondaryBankId: null,
      originBranchId: branchA.id,
      destinationBranchId: branchA.id,
      areaName: null,
      lines: [{ currencyId: egp.id, amountMinor: 100 }],
      collectionDate: new Date(iso(HEAVY)),
      deliveryDate: null,
      receiptNumber: null,
      vaultReceiptNumber: null,
      serialTracked: false,
      notes: MARK,
      receivedById: null,
      receivedAt: null,
      ...over,
    });
    try {
      await OperationsShipmentModel.insertMany([
        ...Array.from({ length: OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS }, () => row()),
        row({ shipmentType: 'secured', deliveryDate: new Date(iso(HEAVY)) }),
      ]);
      const whole = await request(app)
        .get(`/api/v1/operations/shipments/history?from=${HEAVY}&to=${HEAVY}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(whole.status).toBe(422);
      expect(errorOf(whole).code).toBe(ErrorCodes.OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE);
      const secured = await history(`from=${HEAVY}&to=${HEAVY}&type=secured`);
      expect(secured.shipments).toHaveLength(1);
      // Exactly the cap of dailies, the one محصنة filtered out: served whole.
      const dailies = await history(`from=${HEAVY}&to=${HEAVY}&type=daily`);
      expect(dailies.shipments).toHaveLength(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS);
    } finally {
      await OperationsShipmentModel.deleteMany({ notes: MARK }).exec();
    }
  });
});

describe('«تقرير الخزينة» — GET /operations/reports/vault/held, what the vault holds NOW', () => {
  const held = async (token = adminToken): Promise<OperationsVaultHeldReportDto> => {
    const res = await request(app)
      .get('/api/v1/operations/reports/vault/held')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return data<OperationsVaultHeldReportDto>(res);
  };
  const inVaultNow = async (): Promise<string[]> =>
    data<OperationsSecuredDispatchBoardDto>(
      await request(app)
        .get('/api/v1/operations/secured/dispatch-board')
        .set('Authorization', `Bearer ${adminToken}`),
    ).shipments.map((s) => s.id);

  it('rolls up per bank exactly the set «محصنات الخزينة» lists — held only', async () => {
    // A bank B shipment held, and a bank A one whose receipt is then cancelled (back to draft).
    const misr = (
      await book(OTHER, 'الهرم', {
        mainBankId: bankB.id,
        originBranchId: branchB.id,
        destinationBranchId: branchB.id,
        lines: [{ currencyId: egp.id, amount: 250 }],
      })
    ).id;
    await intoVault(misr, 5);
    const cancelled = (await book(OTHER, 'الهرم')).id;
    await intoVault(cancelled, 7);
    const undone = await request(app)
      .post(`/api/v1/operations/secured/${cancelled}/cancel-receipt`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'استلام بالخطأ', version: (await read(cancelled)).version });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);

    const report = await held();
    expect(Number.isNaN(Date.parse(report.asOf))).toBe(false);
    const holding = await inVaultNow();
    expect(report.grandTotal.shipmentCount).toBe(holding.length);
    expect(holding).toContain(misr);
    expect(holding).not.toContain(cancelled);
    // The dispatched ones (van 2 above, and the one sent before the screen) are not held.
    for (const out of [dueVault, overdueNoLeg, alreadyOut]) expect(holding).not.toContain(out);

    const rowB = report.rows.find((r) => r.bankId === bankB.id);
    expect(rowB).toMatchObject({ bankName: 'مصر' });
    expect(rowB?.totals).toMatchObject({ shipmentCount: 1, bagCount: 5 });
    expect(rowB?.totals.currencies).toEqual([
      { currencyId: egp.id, currencyName: 'مصري', amount: 250 },
    ]);
    const rowA = report.rows.find((r) => r.bankId === bankA.id);
    // Bank A holds: dueVault2, dueNowhere and overdueWithLeg — 2 bags each.
    expect(rowA?.totals).toMatchObject({ shipmentCount: 3, bagCount: 6 });
    expect(report.rows.reduce((n, r) => n + r.totals.shipmentCount, 0)).toBe(
      report.grandTotal.shipmentCount,
    );
    expect(report.grandTotal.bagCount).toBe(11);
  });

  it('is the vault’s — and takes no period', async () => {
    expect((await held(vaultToken)).grandTotal.shipmentCount).toBeGreaterThan(0);
    const viewer = await request(app)
      .get('/api/v1/operations/reports/vault/held')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewer.status).toBe(403);
    const period = await request(app)
      .get(`/api/v1/operations/reports/vault/held?from=${COLLECT}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(period.status).toBe(400);
  });
});

describe('«إضافة محصنة» on «استلام الخزينة» — the form’s pickers answer the vault', () => {
  it('lists the branches and areas for the vault’s grant, as the banks and currencies already do', async () => {
    for (const url of [
      `/api/v1/operations/bank-branches?bankId=${bankA.id}&search=${encodeURIComponent('المعادي')}`,
      `/api/v1/operations/bank-branches/${branchA.id}`,
      '/api/v1/operations/areas?page=1&pageSize=100',
      '/api/v1/operations/banks?page=1&pageSize=100',
      '/api/v1/operations/currencies?page=1&pageSize=100',
    ]) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${vaultToken}`);
      expect(res.status, url).toBe(200);
      // …and stay closed to an Operations grant that is neither.
      const closed = await request(app).get(url).set('Authorization', `Bearer ${nobodyToken}`);
      expect(closed.status, url).toBe(403);
    }
    // Booking is still `operationsShipment.create`'s.
    const booked = await request(app)
      .post('/api/v1/operations/shipments')
      .set('Authorization', `Bearer ${vaultToken}`)
      .send({
        shipmentType: 'secured',
        mainBankId: bankA.id,
        originBranchId: branchA.id,
        destinationBranchId: branchA.id,
        lines: [{ currencyId: egp.id, amount: 1 }],
        collectionDate: COLLECT,
        deliveryDate: OTHER,
      });
    expect(booked.status).toBe(403);
  });
});

describe('the shipment’s own record is untouched by distribution', () => {
  it('a placed draft keeps its pickup state and its version — only the leg moved', async () => {
    const shipment = await OperationsShipmentModel.findById(dueDraft).lean().exec();
    expect(shipment?.status).toBe('draft');
    expect(shipment?.pickup ?? null).toBeNull();
    // Created at version 0; distributing it three times never wrote the shipment.
    expect(shipment?.__v).toBe(0);
  });
});
