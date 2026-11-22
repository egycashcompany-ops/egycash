// Round 32 — «لوحة التشغيلة» and «الطاقم الثابت», over real HTTP, real RBAC and a real database.
//
//   A. «دى مشكلة بيظهر عربيات ايه الاصفار دى» — the two van pickers opened on «0», «00», «000», «0000»,
//      «00000», then «61». Cars whose Fleet code names nothing were typed by hand in the registry
//      (no legacy export the go-live import read holds such a code); Fleet holds a plate on each.
//      Both lists now put such a car LAST, named by its plate and its make (`uncoded`), leave out
//      and COUNT one whose plate names nothing either, never hide a van already on the roster or in
//      the standing crew, and order codes NATURALLY — 61, 101, 150, 213 (the standing crew's own
//      rows and list were ordered as text: «101» before «61»).
//   B. «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط» — a past day is the board's
//      RECORD: the read says so (`past`), and the save refuses it (422 `OPERATIONS_CREW_DAY_IN_PAST`)
//      before anything is read or written, whatever a client sends. Today and later days are saved
//      as before.
//
// The API plans no past day, so the record's day is planned as a day to come and then played back
// into the past in the database, as the distribution's Round 30 suite does. This file boots its own
// database.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  addDaysYmd,
  cairoYmd,
  platformPermissions,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type OperationsCrewBoardDto,
  type OperationsStandingCrewBoardDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { OperationsCrewAssignmentModel } from '../../src/modules/operations/crew/crew-assignment.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId = '';
let adminToken = '';
let viewerToken = ''; // operationsCrew.view only

const today = (): string => cairoYmd(new Date());
const shift = (days: number): string => addDaysYmd(today(), days);
/** The board's day — a day to come. */
const DAY = shift(40);
/** Planned as a day to come, then played back to RECORD in the database. */
const PLANNED = shift(41);
const RECORD = shift(-3);

let branchId = '';
let typeId = '';
let otherTypeId = '';
const vans: Record<string, string> = {};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-crew-r32-test-${Date.now()}`;
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

/** A Fleet car through Fleet's own registry route — a code, a plate, a type, as the form takes. */
const mkVehicle = async (code: string, plateNumber: string, type = typeId): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code,
      typeId: type,
      plateNumber,
      chassisNumber: `R32-CH-${code}-${plateNumber}`,
      motorNumber: `R32-MO-${code}-${plateNumber}`,
      joinedAt: '2024-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-01-01T00:00:00.000Z',
      branchId,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetVehicleDto>(res).id;
};

const board = async (date: string, token = adminToken): Promise<OperationsCrewBoardDto> => {
  const res = await request(app)
    .get(`/api/v1/operations/crew-board?date=${date}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsCrewBoardDto>(res);
};

const save = (body: Record<string, unknown>, date: string, token = adminToken): request.Test =>
  request(app)
    .post('/api/v1/operations/crew-board')
    .set('Authorization', `Bearer ${token}`)
    .send({ date, ...body });

const standing = async (): Promise<OperationsStandingCrewBoardDto> => {
  const res = await request(app)
    .get('/api/v1/operations/standing-crew')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsStandingCrewBoardDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...operationsPermissions].map(
      (p) => p.key,
    ),
  );
  adminId = await mkUser('ops-r32-admin@ecms.local');
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
  adminToken = await login('ops-r32-admin@ecms.local');
  const role = await rbacService.createRole(
    { name: { en: 'R32 viewer', ar: 'دور R32' }, permissionKeys: ['operationsCrew.view'] },
    adminId,
  );
  const viewerId = await mkUser('ops-r32-viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, String(role._id), 'organization');
  viewerToken = await login('ops-r32-viewer@ecms.local');

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '32', name: { ar: 'فرع الجولة 32', en: 'Round 32 Branch' } });
  expect(branchRes.status).toBe(201);
  branchId = data<{ id: string }>(branchRes).id;
  const mkType = async (ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/fleet/vehicle-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar, en }, maintenanceIntervalKm: 10_000 });
    expect(res.status).toBe(201);
    return data<FleetVehicleTypeDto>(res).id;
  };
  typeId = await mkType('تويوتا هاي إس', 'Toyota HiAce');
  otherTypeId = await mkType('ميتسوبيشي', 'Mitsubishi');

  // Coded cars, created out of number order — a text sort would list «101» and «1000» before «61».
  for (const code of ['213', '1000', '101', '61', '150', '9']) {
    vans[code] = await mkVehicle(code, `ر ٣ ${code}`);
  }
  // The owner's zeros, as Fleet's form would take them: each with a plate of its own (Fleet keeps
  // the plate unique too) — two named by a real plate, two whose plate names nothing either.
  vans['0'] = await mkVehicle('0', 'ن ق ل 4521');
  vans['00'] = await mkVehicle('00', 'ب ط 118', otherTypeId);
  vans['000'] = await mkVehicle('000', '0');
  vans['0000'] = await mkVehicle('0000', '-');
  // On DAY's Fleet roster, code and plate naming nothing: the day's van — never hidden.
  vans['00000'] = await mkVehicle('00000', '00');
  // In the standing crew, code and plate naming nothing: Operations' own row — never hidden.
  vans['000000'] = await mkVehicle('000000', '000');

  const roster = await request(app)
    .post('/api/v1/fleet/roster')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ date: DAY, rows: [{ vehicleId: vans['00000'], notes: 'r32' }] });
  expect(roster.status, JSON.stringify(roster.body)).toBe(200);

  const put = await request(app)
    .put('/api/v1/operations/standing-crew')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      rows: [{ vehicleId: vans['101'] }, { vehicleId: vans['61'] }, { vehicleId: vans['000000'] }],
    });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('Round 32 A — «بدون سيارة»: no bare «0000», and codes in number order', () => {
  it('lists the cars by code NATURALLY, the uncoded LAST by their plate and make, and counts the ones nothing names', async () => {
    const view = await board(DAY);
    const free = view.freeVehicles;
    const codes = free.map((car) => car.vehicleCode);

    // The standing crew's vans first (their group), by number — its uncoded «000000» (plate «000»)
    // is Operations' own: offered as it is, after the coded ones, never left out — then the rest.
    const standingGroup = free.filter((car) => car.group === 'standing');
    expect(standingGroup.map((car) => car.vehicleCode)).toEqual(['61', '101', '000000']);
    expect(standingGroup[2]?.uncoded?.plateNumber).toBe('000');
    expect(free.filter((car) => car.group === 'other').map((car) => car.vehicleCode)).toEqual([
      '9',
      '150',
      '213',
      '1000',
    ]);
    // «0» and «00» — named by a plate — last, in their own group, by their plate and their make.
    const uncoded = free.filter((car) => car.group === 'uncoded');
    expect(uncoded.map((car) => car.vehicleCode)).toEqual(['0', '00']);
    expect(codes.slice(-2)).toEqual(['0', '00']);
    expect(uncoded[0]?.uncoded).toEqual({
      plateNumber: 'ن ق ل 4521',
      typeName: { ar: 'تويوتا هاي إس', en: 'Toyota HiAce' },
    });
    expect(uncoded[1]?.uncoded).toEqual({
      plateNumber: 'ب ط 118',
      typeName: { ar: 'ميتسوبيشي', en: 'Mitsubishi' },
    });
    // A car with a code carries no `uncoded`.
    expect(free.find((car) => car.vehicleCode === '61')?.uncoded).toBeNull();

    // «000» (plate «0») and «0000» (plate «-»): nothing names them — left out, and counted.
    expect(codes).not.toContain('000');
    expect(codes).not.toContain('0000');
    expect(view.unidentifiedVehicles).toBe(2);

    // The ROSTER van «00000» (plate «00») is the day's van in Fleet: on the board, and offered as
    // it is — in the roster's group, never left out.
    expect(view.rows.some((row) => row.vehicleCode === '00000')).toBe(true);
    const rosterVan = free.find((car) => car.vehicleCode === '00000');
    expect(rosterVan).toMatchObject({ group: 'roster', onRoster: true });
    expect(rosterVan?.uncoded?.plateNumber).toBe('00');
  });

  it('a row may take an uncoded car — the save asks Fleet as for any car', async () => {
    const res = await save({ rows: [{ vehicleId: vans['0'], notes: 'بلا كود' }] }, DAY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = data<OperationsCrewBoardDto>(res);
    // On the board now, under its code as Fleet holds it — and off the free list.
    expect(after.rows.find((row) => row.vehicleId === vans['0'])?.crew?.notes).toBe('بلا كود');
    expect(after.freeVehicles.some((car) => car.vehicleId === vans['0'])).toBe(false);
  });

  it('«الطاقم الثابت»: its rows and «إضافة سيارة» by code NATURALLY (they were text), the uncoded last, its own row kept', async () => {
    const view = await standing();
    // Its rows — «101» was listed before «61» as text. Its uncoded van «000000» is its own row: kept,
    // as it is, after the coded ones.
    expect(view.rows.map((row) => row.vehicleCode)).toEqual(['61', '101', '000000']);
    // What may still join: number order, then the uncoded by plate, the unnamed left out.
    expect(view.available.map((car) => car.vehicleCode)).toEqual([
      '9',
      '150',
      '213',
      '1000',
      '0',
      '00',
    ]);
    expect(view.available.find((car) => car.vehicleCode === '00')?.uncoded).toEqual({
      plateNumber: 'ب ط 118',
      typeName: { ar: 'ميتسوبيشي', en: 'Mitsubishi' },
    });
    expect(view.available.find((car) => car.vehicleCode === '150')?.uncoded).toBeNull();
    // «000», «0000», «00000»: neither code nor plate names them.
    expect(view.unidentifiedVehicles).toBe(3);
  });
});

describe('Round 32 B — a past day is the board’s record: read, never written', () => {
  let recordRow = '';

  beforeAll(async () => {
    // Planned as a day to come — a van off the roster, a row without a van — then played back.
    const res = await save(
      {
        rows: [
          { vehicleId: vans['213'], notes: 'سجل' },
          { vehicleId: null, notes: 'صف حر' },
        ],
      },
      PLANNED,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    recordRow = data<OperationsCrewBoardDto>(res).rows.find((row) => row.vehicleId === vans['213'])
      ?.crew?.id as string;
    expect(recordRow).toBeTruthy();
    await OperationsCrewAssignmentModel.db
      .collection('operations_days')
      .updateOne(
        { date: new Date(`${PLANNED}T00:00:00.000Z`) },
        { $set: { date: new Date(`${RECORD}T00:00:00.000Z`) } },
      );
  });

  it('reads a past day as its record — `past`, the server’s today — and a day to come, or today, as no record', async () => {
    const record = await board(RECORD);
    expect(record).toMatchObject({
      date: `${RECORD}T00:00:00.000Z`,
      today: `${today()}T00:00:00.000Z`,
      past: true,
    });
    // What was planned on it, as it was saved.
    expect(record.rows.find((row) => row.vehicleId === vans['213'])?.crew?.notes).toBe('سجل');
    expect(record.vehiclelessRows.map((row) => row.notes)).toEqual(['صف حر']);
    // Any reader of the board reads it.
    expect((await board(RECORD, viewerToken)).past).toBe(true);
    expect((await board(today())).past).toBe(false);
    expect((await board(DAY)).past).toBe(false);
    // A past day nobody planned: an empty record.
    expect(await board(shift(-30))).toMatchObject({ past: true, rows: [], vehiclelessRows: [] });
  });

  it('refuses every save of a past day — 422 OPERATIONS_CREW_DAY_IN_PAST, today named — and writes nothing', async () => {
    const before = await OperationsCrewAssignmentModel.find({}).lean().exec();
    const record = await board(RECORD);
    const loose = record.vehiclelessRows[0]?.id as string;
    const attempts: Record<string, unknown>[] = [
      // An edit of its van's row.
      { rows: [{ vehicleId: vans['213'], crewAssignmentId: recordRow, notes: 'تعديل' }] },
      // A van given to its row without a van.
      { rows: [{ vehicleId: vans['150'], crewAssignmentId: loose }] },
      // A row added.
      { rows: [{ vehicleId: null, notes: 'جديد' }] },
      // A row removed.
      { rows: [], removeCrewAssignmentIds: [loose] },
      // A row of a van it never had.
      { rows: [{ vehicleId: vans['9'], notes: 'جديد' }] },
    ];
    for (const body of attempts) {
      const res = await save(body, RECORD);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_CREW_DAY_IN_PAST);
      expect(errorOf(res).details).toEqual([{ field: 'date', code: 'MIN_DATE', message: today() }]);
    }
    // Yesterday, a day nobody planned: refused the same — no operating day is made for it.
    const yesterday = await save({ rows: [{ vehicleId: null, notes: 'أمس' }] }, shift(-1));
    expect(yesterday.status).toBe(422);
    expect(errorOf(yesterday).code).toBe(ErrorCodes.OPERATIONS_CREW_DAY_IN_PAST);
    expect(
      await OperationsCrewAssignmentModel.db
        .collection('operations_days')
        .countDocuments({ date: new Date(`${shift(-1)}T00:00:00.000Z`) }),
    ).toBe(0);
    // Without the grant it never reaches the day.
    expect((await save(attempts[0] ?? {}, RECORD, viewerToken)).status).toBe(403);

    // Nothing written: every crew row exactly as it was, and the record reads as before.
    const after = await OperationsCrewAssignmentModel.find({}).lean().exec();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    const again = await board(RECORD);
    expect(again.rows.find((row) => row.vehicleId === vans['213'])?.crew?.notes).toBe('سجل');
    expect(again.vehiclelessRows.map((row) => row.notes)).toEqual(['صف حر']);
  });

  it('still saves TODAY and a day to come', async () => {
    const now = await save({ rows: [{ vehicleId: null, notes: 'اليوم' }] }, today());
    expect(now.status, JSON.stringify(now.body)).toBe(200);
    expect(data<OperationsCrewBoardDto>(now).past).toBe(false);
    const later = await save({ rows: [{ vehicleId: vans['9'], notes: 'لاحقًا' }] }, DAY);
    expect(later.status, JSON.stringify(later.body)).toBe(200);
  });
});
