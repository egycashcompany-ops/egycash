// Round 20 — «لوحة التشغيلة» as the owner approved it, over real HTTP, real RBAC and a real database.
//
//   · «أنواع التشغيل»: «انا عاوز النوع يكون بيضاف من البيانات المرجعيه» — the board's «النوع» is a
//     catalog on the reference-data screen, seeded once with the legacy nine, dragged into order.
//   · The row's type and colour: «وعاوز زرا يبقى فى كذا لون اقدر الون به الصف».
//   · Rows without a van: «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات برضو» — created,
//     edited, deleted and given a van, Q11 counting them, `ux_day_vehicle` partial on a present van.
//   · «الاتجاه» from the areas: «الاتجاه اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده» —
//     reversed in Round 28, «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست»: typed by hand.
//   · The slots: «كل عربيه هيبقى عليه من 1 ل 2 قادة و من 2 ل 4 اخصائيين» — two at most, no minimum.
//   · The read: the van's drivers by name («ولما اعمل هوفر على العربيه يظهر السواقيين اللى عليها»)
//     and the day's vans in the workshop («صيانة»).
//   · And every reader about VANS — legs, the distribution, the captain's day, the pool — never
//     takes a row without a van for one.
//
// Every day is RELATIVE and in the future (the roster plans no past day), and this file boots its
// own database, so nothing here meets another suite's rows.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  OPERATIONS_DIRECTION_MAX_LENGTH,
  OPERATIONS_LEGACY_CREW_ROW_COLOURS,
  OperationsEvents,
  OperationsSettingKeys,
  SettingKeys,
  platformPermissions,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCrewBoardDto,
  type OperationsCrewAttendanceDayDto,
  type OperationsCrewDirectoryDto,
  type OperationsCurrencyDto,
  type OperationsSecuredDistributionDto,
  type OperationsShiftTypeDto,
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
import { OperationsCrewAssignmentModel } from '../../src/modules/operations/crew/crew-assignment.model';
import { operationsCrewAssignmentRepository } from '../../src/modules/operations/crew/crew-assignment.repository';
import { OperationsShiftTypeModel } from '../../src/modules/operations/shift-types/shift-type.model';
import { OperationsAreaModel } from '../../src/modules/operations/areas/area.model';
import { operationsAreaRepository } from '../../src/modules/operations/areas/area.repository';
import { seedOperationsShiftTypes } from '../../src/modules/operations/shift-types/shift-type.service';
import {
  migrateCrewAssignmentIndexes,
  migrateCrewRowColoursToPalette,
} from '../../src/modules/operations/operations.migration';
import { operationsCrewRequirementsRepository } from '../../src/modules/operations/crew/crew-requirements.repository';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { AttendanceDayModel } from '../../src/modules/hr/attendance';
import { LeaveRequestModel } from '../../src/modules/hr/leave-management/leave-requests/leave-request.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId = '';
let adminToken = '';
let crewViewerToken = ''; // operationsCrew.view only — reads the board and its types, saves nothing
let catalogToken = ''; // operationsCatalog.manage only — keeps the catalog, no board
let shipmentViewerToken = ''; // operationsShipment.view only — neither
const seenEvents: { name: string; payload: unknown }[] = [];

const shift = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** THE board day. */
const DAY = shift(60);
/** A second day — its own rows, for the index and Q11 being per day. */
const OTHER = shift(61);

let branchId = '';
let departmentId = '';
let jobTitleId = '';
let typeId = '';

let van1 = ''; // OPS-P1 — on the roster with two drivers
let van2 = ''; // OPS-P2 — on the roster, no driver
let van3 = ''; // OPS-P3 — on the roster, the van a row without a van is given
let van4 = ''; // OPS-P4 — the standing crew's, NOT on the roster, in the workshop on DAY
let van5 = ''; // OPS-P5 — nobody's (no roster, no standing crew), in the workshop: not Operations'
let van6 = ''; // OPS-P6 — the standing crew's, entering the workshop only AFTER DAY
let cap1 = '';
let cap2 = '';
let cap3 = '';
let spec1 = '';
let spec2 = '';
let spec3 = '';
let drv1 = '';
let drv2 = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-crew-plan-test-${Date.now()}`;
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
    { name: { en: `R20 ${email}`, ar: `دور ${email}` }, permissionKeys },
    adminId,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

let nid = 0;
let phone = 62_000_000;
const mkEmployee = async (
  fullNameAr: string,
  seat: { departmentId: string; jobTitleId: string } = { departmentId, jobTitleId },
): Promise<string> => {
  nid += 1;
  phone += 1;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `290010101${String(70_000 + nid).padStart(5, '0')}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `011${String(phone).padStart(8, '0')}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: seat.jobTitleId,
        departmentId: seat.departmentId,
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

/**
 * «متطلبات الطاقم» for one employee, through its own screen's route. Since Round 23 the two role
 * flags decide which slot a person may newly take («ممنوع ان اعين قائد مكان اخصائى والعكس الا فى
 * حالة انه قائد اخصائى»), so every captain this file seats is ticked «قائد»; a specialist needs no
 * row at all — nobody ticked is a specialist.
 */
const flag = async (
  employeeId: string,
  flags: { isCaptain?: boolean; isSpecialist?: boolean },
): Promise<void> => {
  const res = await request(app)
    .put(`/api/v1/operations/crew-board/requirements/${employeeId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(flags);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const mkVehicle = async (code: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code,
      typeId,
      plateNumber: `ل ت ${code.slice(-1)}`,
      chassisNumber: `${code}-CH`,
      motorNumber: `${code}-MO`,
      joinedAt: '2024-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-01-01T00:00:00.000Z',
      branchId,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetVehicleDto>(res).id;
};

const area = async (name: string): Promise<{ id: string; version: number }> => {
  const res = await request(app)
    .post('/api/v1/operations/areas')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string; version: number }>(res);
};

const board = async (date = DAY, token = adminToken): Promise<OperationsCrewBoardDto> => {
  const res = await request(app)
    .get(`/api/v1/operations/crew-board?date=${date}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsCrewBoardDto>(res);
};

const save = (body: Record<string, unknown>, date = DAY, token = adminToken): request.Test =>
  request(app)
    .post('/api/v1/operations/crew-board')
    .set('Authorization', `Bearer ${token}`)
    .send({ date, ...body });

const saved = async (body: Record<string, unknown>, date = DAY) => {
  const res = await save(body, date);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsCrewBoardDto & { changedCount: number }>(res);
};

const types = async (query = '', token = adminToken): Promise<OperationsShiftTypeDto[]> => {
  const res = await request(app)
    .get(`/api/v1/operations/shift-types?page=1&pageSize=100${query}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<OperationsShiftTypeDto[]>(res);
};
const typeNamed = async (name: string): Promise<OperationsShiftTypeDto> => {
  const found = (await types()).find((type) => type.name === name);
  expect(found, name).toBeDefined();
  return found as OperationsShiftTypeDto;
};

const vanRow = (dto: OperationsCrewBoardDto, vehicleId: string) =>
  dto.rows.find((row) => row.vehicleId === vehicleId);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  for (const name of Object.values(OperationsEvents)) {
    subscribe(name, `test.r20.${name}`, (envelope) => {
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
  adminId = await mkUser('ops-r20-admin@ecms.local');
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
  adminToken = await login('ops-r20-admin@ecms.local');
  crewViewerToken = await tokenWith('ops-r20-crew@ecms.local', ['operationsCrew.view']);
  catalogToken = await tokenWith('ops-r20-catalog@ecms.local', ['operationsCatalog.manage']);
  shipmentViewerToken = await tokenWith('ops-r20-viewer@ecms.local', ['operationsShipment.view']);

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '82', name: { ar: 'فرع التشغيلة', en: 'Crew Plan Branch' } });
  expect(branchRes.status).toBe(201);
  branchId = data<{ id: string }>(branchRes).id;
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-R20', name: { ar: 'نقل الأموال', en: 'Cash Transfer' }, branchId });
  expect(dept.status).toBe(201);
  departmentId = data<{ id: string }>(dept).id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-R20', name: { ar: 'أخصائي عمليات', en: 'Ops Specialist' }, jobGrade: 'G1' });
  expect(title.status).toBe(201);
  jobTitleId = data<{ id: string }>(title).id;
  const driverDept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-R20-DRV', name: { ar: 'سائقو التشغيلة', en: 'Plan Drivers' }, branchId });
  expect(driverDept.status).toBe(201);
  const driverTitle = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: 'OPS-R20-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    });
  expect(driverTitle.status).toBe(201);
  const driverSeat = {
    departmentId: data<{ id: string }>(driverDept).id,
    jobTitleId: data<{ id: string }>(driverTitle).id,
  };
  const type = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'مصفحة تشغيلة', en: 'Plan Armored' }, maintenanceIntervalKm: 10_000 });
  expect(type.status).toBe(201);
  typeId = data<FleetVehicleTypeDto>(type).id;

  van1 = await mkVehicle('OPS-P1');
  van2 = await mkVehicle('OPS-P2');
  van3 = await mkVehicle('OPS-P3');
  van4 = await mkVehicle('OPS-P4');
  van5 = await mkVehicle('OPS-P5');
  van6 = await mkVehicle('OPS-P6');
  cap1 = await mkEmployee('قائد التشغيلة الأول');
  cap2 = await mkEmployee('قائد التشغيلة الثاني');
  cap3 = await mkEmployee('قائد التشغيلة الثالث');
  spec1 = await mkEmployee('أخصائي التشغيلة الأول');
  spec2 = await mkEmployee('أخصائي التشغيلة الثاني');
  spec3 = await mkEmployee('أخصائي التشغيلة الثالث');
  drv1 = await mkEmployee('سائق التشغيلة الأول', driverSeat);
  drv2 = await mkEmployee('سائق التشغيلة الثاني', driverSeat);
  // Round 23: a captain's slot takes a captain — the three are ticked «قائد» on «متطلبات الطاقم».
  for (const captain of [cap1, cap2, cap3]) await flag(captain, { isCaptain: true });

  for (const date of [DAY, OTHER]) {
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date,
        rows: [
          { vehicleId: van1, driver1EmployeeId: drv1, driver2EmployeeId: drv2, notes: 'r20' },
          { vehicleId: van2, notes: 'r20' },
          { vehicleId: van3, notes: 'r20' },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
  }

  // The standing crew names vans 4 and 6 as Operations' own, though neither is on DAY's roster.
  const standing = await request(app)
    .put('/api/v1/operations/standing-crew')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ rows: [{ vehicleId: van4 }, { vehicleId: van6 }] });
  expect(standing.status, JSON.stringify(standing.body)).toBe(200);

  // The workshop: van 4 checked in before DAY and still there; van 5 too, but it is nobody's in
  // Operations; van 6 checks in only the day AFTER DAY. Written straight into Fleet's collection —
  // the fixture is the visit, not Fleet's check-in screen.
  const visit = (vehicleId: string, inDate: string) => ({
    vehicleId: new Types.ObjectId(vehicleId),
    inDate: new Date(`${inDate}T08:00:00.000Z`),
    outDate: null,
    workshopId: new Types.ObjectId(),
    workTypeId: new Types.ObjectId(),
  });
  await FleetMaintenanceVisitModel.create([
    visit(van4, shift(1)),
    visit(van5, shift(1)),
    visit(van6, shift(61)),
  ]);

  await area('المعادي');
  await area('حلوان');
  const archived = await area('الدقي');
  const off = await request(app)
    .patch(`/api/v1/operations/areas/${archived.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false, version: archived.version });
  expect(off.status).toBe(200);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('«أنواع التشغيل» — the shift-type catalog («النوع يكون بيضاف من البيانات المرجعيه»)', () => {
  it('is seeded on boot with the legacy nine, in the legacy order, with English names and colours', async () => {
    const list = await types();
    expect(list.map((type) => type.name)).toEqual([
      'يومي',
      'احتياطي',
      'احتياطي سفر',
      'أسوان',
      'إيباج',
      'سفر',
      'شلاتين',
      'محصنة',
      'مسائي',
    ]);
    expect(list.map((type) => type.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(list[0]).toMatchObject({ nameEn: 'Daily', colour: 'rose', isActive: true });
    expect(list[7]).toMatchObject({ nameEn: 'Secured', colour: 'slate' });
  });

  it('never seeds twice — a restart writes nothing, and an edited seed stays the owner’s', async () => {
    const evening = await typeNamed('مسائي');
    const renamed = await request(app)
      .patch(`/api/v1/operations/shift-types/${evening.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'مسائي متأخر', isActive: false, version: evening.version });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);

    expect(await seedOperationsShiftTypes()).toEqual({ inserted: 0, skipped: [] });
    expect(await seedOperationsShiftTypes()).toEqual({ inserted: 0, skipped: [] });
    expect(await OperationsShiftTypeModel.countDocuments({ seedKey: { $type: 'string' } })).toBe(9);
    const after = await types();
    expect(after.some((type) => type.name === 'مسائي')).toBe(false);
    expect(after.find((type) => type.id === evening.id)).toMatchObject({
      name: 'مسائي متأخر',
      isActive: false,
    });

    // Put back for the board cases below.
    const back = await request(app)
      .patch(`/api/v1/operations/shift-types/${evening.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'مسائي',
        isActive: true,
        version: data<OperationsShiftTypeDto>(renamed).version,
      });
    expect(back.status).toBe(200);
  });

  it('adds a type at the END of the arranged list, refuses a taken name, and archives instead of deleting', async () => {
    const created = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'طوارئ', nameEn: 'Emergency', colour: 'sky' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const dto = data<OperationsShiftTypeDto>(created);
    expect(dto).toMatchObject({ name: 'طوارئ', colour: 'sky', sortOrder: 9, isActive: true });

    const twice = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'يومي', colour: 'lime' });
    expect(twice.status).toBe(409);

    const archived = await request(app)
      .patch(`/api/v1/operations/shift-types/${dto.id}`)
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ isActive: false, version: dto.version });
    expect(archived.status).toBe(200);
    expect((await types('&isActive=true')).some((type) => type.id === dto.id)).toBe(false);
    // Still listed in full: a row may carry an archived type, and the board must name it.
    expect((await types()).some((type) => type.id === dto.id)).toBe(true);
    expect(
      (
        await request(app)
          .delete(`/api/v1/operations/shift-types/${dto.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(404);
  });

  it('saves the dragged order «زى شاشة الحركة بالظبط» — the named first, the rest after them', async () => {
    const before = await types();
    const travel = before.find((type) => type.name === 'سفر') as OperationsShiftTypeDto;
    const aswan = before.find((type) => type.name === 'أسوان') as OperationsShiftTypeDto;
    const res = await request(app)
      .put('/api/v1/operations/shift-types/order')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ ids: [travel.id, aswan.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const after = await types();
    expect(after.slice(0, 3).map((type) => type.name)).toEqual(['سفر', 'أسوان', 'يومي']);
    expect(after).toHaveLength(before.length);

    const stranger = await request(app)
      .put('/api/v1/operations/shift-types/order')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ ids: [new Types.ObjectId().toString()] });
    expect(stranger.status).toBe(409);
    expect((await types()).map((type) => type.id)).toEqual(after.map((type) => type.id));
  });

  it('is read by the board’s readers and the catalog’s keepers, and written by the catalog grant only', async () => {
    await types('', crewViewerToken);
    await types('', catalogToken);
    expect(
      (
        await request(app)
          .get('/api/v1/operations/shift-types')
          .set('Authorization', `Bearer ${shipmentViewerToken}`)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/operations/shift-types')).status).toBe(401);

    const daily = await typeNamed('يومي');
    for (const call of [
      request(app).post('/api/v1/operations/shift-types').send({ name: 'س', colour: 'rose' }),
      request(app)
        .put('/api/v1/operations/shift-types/order')
        .send({ ids: [daily.id] }),
      request(app)
        .patch(`/api/v1/operations/shift-types/${daily.id}`)
        .send({ colour: 'lime', version: daily.version }),
    ]) {
      expect((await call.set('Authorization', `Bearer ${crewViewerToken}`)).status).toBe(403);
    }
  });

  it('Round 24b — «ألوان الأنواع»: a type takes any of the twenty, two may share one, a row-only name is no type colour', async () => {
    const daily = await typeNamed('يومي');
    const travel = await typeNamed('سفر');
    const patchType = (id: string, body: Record<string, unknown>): request.Test =>
      request(app)
        .patch(`/api/v1/operations/shift-types/${id}`)
        .set('Authorization', `Bearer ${catalogToken}`)
        .send(body);

    // A name new in Round 24b, through the existing update and its existing grant.
    const navy = await patchType(daily.id, { colour: 'navy', version: daily.version });
    expect(navy.status, JSON.stringify(navy.body)).toBe(200);
    const navyDto = data<OperationsShiftTypeDto>(navy);
    expect(navyDto).toMatchObject({ colour: 'navy', version: daily.version + 1 });

    // «ينفع نوعين ياخدوا نفس اللون؟» → «أيوه عادي».
    const shared = await patchType(travel.id, { colour: 'navy', version: travel.version });
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(
      (await types())
        .filter((type) => type.colour === 'navy')
        .map((type) => type.name)
        .sort(),
    ).toEqual(['سفر', 'يومي'].sort());

    // Round 20's ROW names were never type colours, and are not now: only the row maps them.
    expect((await patchType(daily.id, { colour: 'yellow', version: navyDto.version })).status).toBe(
      400,
    );
    // The card sends the version it read: a stale one is refused, nothing written.
    const stale = await patchType(daily.id, { colour: 'olive', version: daily.version });
    expect(stale.status).toBe(409);
    expect((await typeNamed('يومي')).colour).toBe('navy');

    // Put back for the board cases below.
    expect((await patchType(daily.id, { colour: 'rose', version: navyDto.version })).status).toBe(
      200,
    );
    expect(
      (
        await patchType(travel.id, {
          colour: 'orange',
          version: data<OperationsShiftTypeDto>(shared).version,
        })
      ).status,
    ).toBe(200);
  });
});

describe('the crew row’s type and colour', () => {
  it('saves a type and a colour, reads them back, and an unchanged row is a no-op', async () => {
    const daily = await typeNamed('يومي');
    const first = await saved({
      rows: [
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: daily.id,
          rowColour: 'amber',
        },
      ],
    });
    expect(first.changedCount).toBe(1);
    expect(vanRow(first, van1)?.crew).toMatchObject({ shiftTypeId: daily.id, rowColour: 'amber' });

    const recoloured = await saved({
      rows: [
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: daily.id,
          rowColour: 'emerald',
        },
      ],
    });
    expect(recoloured.changedCount).toBe(1);
    expect(vanRow(recoloured, van1)?.crew?.rowColour).toBe('emerald');

    const again = await saved({
      rows: [
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: daily.id,
          rowColour: 'emerald',
        },
      ],
    });
    expect(again.changedCount).toBe(0);
  });

  it('a row with a colour or a type and nothing else is still a row', async () => {
    const res = await saved({ rows: [{ vehicleId: van2, rowColour: 'sky' }] });
    expect(vanRow(res, van2)?.crew).toMatchObject({ rowColour: 'sky', shiftTypeId: null });
  });

  it('refuses a type nobody has, and an ARCHIVED type newly chosen — OPERATIONS_UNKNOWN_SHIFT_TYPE', async () => {
    const unknown = new Types.ObjectId().toString();
    const res = await save({ rows: [{ vehicleId: van2, shiftTypeId: unknown }] });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_UNKNOWN_SHIFT_TYPE);
    expect(errorOf(res).details).toEqual([
      { field: 'shiftTypeId', code: 'SHIFT_TYPE', message: unknown },
      { field: 'rows', code: 'ROW_INDEX', message: '0' },
    ]);

    const emergency = await typeNamed('طوارئ'); // archived above
    const archived = await save({ rows: [{ vehicleId: van2, shiftTypeId: emergency.id }] });
    expect(archived.status).toBe(422);
    expect(errorOf(archived).code).toBe(ErrorCodes.OPERATIONS_UNKNOWN_SHIFT_TYPE);
    // Nothing written: van 2 is as it was.
    expect(vanRow(await board(), van2)?.crew).toMatchObject({
      rowColour: 'sky',
      shiftTypeId: null,
    });
  });

  it('keeps a type the row already holds when it is archived afterwards', async () => {
    const reserve = await typeNamed('احتياطي');
    await saved({ rows: [{ vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'sky' }] });
    const off = await request(app)
      .patch(`/api/v1/operations/shift-types/${reserve.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: reserve.version });
    expect(off.status).toBe(200);
    // The row is saved again with a note — its archived type rides along untouched.
    const res = await saved({
      rows: [{ vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'sky', notes: 'ملاحظة' }],
    });
    expect(vanRow(res, van2)?.crew).toMatchObject({ shiftTypeId: reserve.id, notes: 'ملاحظة' });
    // …while ANOTHER row newly picking the same archived type is refused, and the refusal names
    // THAT row (index 1), not the one keeping it — the board marks the row it names.
    const picked = await save({
      rows: [
        { vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'sky', notes: 'ملاحظة' },
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: reserve.id,
          rowColour: 'emerald',
        },
      ],
    });
    expect(picked.status).toBe(422);
    expect(errorOf(picked).details).toEqual([
      { field: 'shiftTypeId', code: 'SHIFT_TYPE', message: reserve.id },
      { field: 'rows', code: 'ROW_INDEX', message: '1' },
    ]);
    const back = await request(app)
      .patch(`/api/v1/operations/shift-types/${reserve.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true, version: data<OperationsShiftTypeDto>(off).version });
    expect(back.status).toBe(200);
  });

  // Round 24b — «تلقائي ويتغيّر يدوي»: `rowColour` is the colour picked by hand over the type's, in the
  // types' palette. Its own day, and its rows deleted at the end, so no case above or below meets
  // them (the index cases rebuild `ux_day_vehicle` in its old shape, where two rows without a van
  // on one day collide).
  const COLOUR_DAY = shift(110);
  const looseById = (dto: OperationsCrewBoardDto, id: string | undefined) =>
    dto.vehiclelessRows.find((row) => row.id === id);

  it('Round 24b — takes the palette’s names and Round 20’s six (mapped), answers in the palette’s, and either spelling of the same colour is a no-op', async () => {
    const first = await saved(
      { rows: [{ vehicleId: null, rowColour: 'purple', notes: 'r24b' }] },
      COLOUR_DAY,
    );
    const id = first.vehiclelessRows.find((row) => row.notes === 'r24b')?.id;
    expect(looseById(first, id)?.rowColour).toBe('violet');
    // Stored in the palette's name too: no service writes a legacy one.
    expect((await OperationsCrewAssignmentModel.findById(id).lean().exec())?.rowColour).toBe(
      'violet',
    );
    const resend = (rowColour: unknown) =>
      save(
        { rows: [{ vehicleId: null, crewAssignmentId: id, rowColour, notes: 'r24b' }] },
        COLOUR_DAY,
      );

    // The same colour, as the palette names it and as Round 20 did: nothing changed.
    for (const same of ['violet', 'purple']) {
      const again = await resend(same);
      expect(again.status, same).toBe(200);
      expect(data<{ changedCount: number }>(again).changedCount, same).toBe(0);
    }
    // An old client sending any of Round 20's six never meets a 400; each lands on its palette name.
    for (const [legacy, palette] of Object.entries(OPERATIONS_LEGACY_CREW_ROW_COLOURS)) {
      const res = await resend(legacy);
      expect(res.status, legacy).toBe(200);
      expect(looseById(data<OperationsCrewBoardDto>(res), id)?.rowColour, legacy).toBe(palette);
    }
    // The nine names new in Round 24b, as they are.
    for (const colour of ['crimson', 'navy', 'forest', 'gold', 'plum', 'brown', 'cyan', 'pink']) {
      const res = await resend(colour);
      expect(res.status, colour).toBe(200);
      expect(looseById(data<OperationsCrewBoardDto>(res), id)?.rowColour, colour).toBe(colour);
    }
    // Anything else is refused, nothing written.
    const bad = await resend('magenta');
    expect(bad.status).toBe(400);
    expect(looseById(await board(COLOUR_DAY), id)?.rowColour).toBe('pink');
    // null is «لون النوع»: the hand-picked colour is taken off, and the row wears its type's.
    const auto = await resend(null);
    expect(auto.status).toBe(200);
    expect(looseById(data<OperationsCrewBoardDto>(auto), id)?.rowColour).toBeNull();
  });

  it('Round 24b — a row still holding a Round-20 name reads in the palette’s, and the boot migrates it once, history and timestamps untouched', async () => {
    const res = await saved(
      { rows: [{ vehicleId: null, rowColour: 'navy', notes: 'r24b-migrate' }] },
      COLOUR_DAY,
    );
    const id = res.vehiclelessRows.find((row) => row.notes === 'r24b-migrate')?.id as string;
    const _id = new Types.ObjectId(id);
    // Round 20 wrote these names; written straight into the collection, as a database built before
    // Round 24b holds them.
    await OperationsCrewAssignmentModel.collection.updateOne(
      { _id },
      { $set: { rowColour: 'yellow' } },
    );
    const raw = (rowColour: string, isDeleted: boolean) => ({
      operationsDayId: new Types.ObjectId(),
      vehicleId: null,
      fleetDutyAssignmentId: null,
      shiftTypeId: null,
      rowColour,
      captainEmployeeIds: [],
      specialist1EmployeeIds: [],
      specialist2EmployeeIds: [],
      direction: null,
      plannedTime: null,
      notes: null,
      isDeleted,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
      __v: 0,
    });
    const gone = (await OperationsCrewAssignmentModel.collection.insertOne(raw('red', true)))
      .insertedId;
    const orange = (await OperationsCrewAssignmentModel.collection.insertOne(raw('orange', false)))
      .insertedId;
    const before = await OperationsCrewAssignmentModel.collection.findOne({ _id });

    // Read BEFORE the migration: the palette's name already — the board never shows «yellow». It is
    // the palette's GOLD, the colour Round 20 drew yellow in (bg-yellow-400), not amber.
    expect(looseById(await board(COLOUR_DAY), id)?.rowColour).toBe('gold');

    const first = await migrateCrewRowColoursToPalette();
    expect(first.rowsUpdated).toBe(2);
    const after = await OperationsCrewAssignmentModel.collection.findOne({ _id });
    expect(after?.rowColour).toBe('gold');
    // A spelling changed, not the crew: `updatedAt` and the version stay.
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.__v).toEqual(before?.__v);
    // A soft-deleted row is history the readers still reach: migrated too, still deleted.
    expect(await OperationsCrewAssignmentModel.collection.findOne({ _id: gone })).toMatchObject({
      rowColour: 'rose',
      isDeleted: true,
    });
    // orange is a palette name: left as it is.
    expect(
      (await OperationsCrewAssignmentModel.collection.findOne({ _id: orange }))?.rowColour,
    ).toBe('orange');
    // No legacy name is left anywhere.
    expect(
      await OperationsCrewAssignmentModel.collection.countDocuments({
        rowColour: { $in: ['yellow', 'green', 'blue', 'red', 'purple'] },
      }),
    ).toBe(0);

    // Idempotent: the next boot (or the worker booting beside the api) writes nothing.
    expect(await migrateCrewRowColoursToPalette()).toEqual({ rowsUpdated: 0 });
    await OperationsCrewAssignmentModel.collection.deleteMany({
      $or: [{ _id: { $in: [gone, orange] } }, { notes: { $in: ['r24b', 'r24b-migrate'] } }],
    });
  });
});

describe('«الاتجاه» — an area respelled, anything else typed by hand (Round 28), a legacy one kept', () => {
  it('stores the area’s own spelling, and several areas joined', async () => {
    const one = await saved({ rows: [{ vehicleId: van3, direction: 'المعادى' }] });
    expect(vanRow(one, van3)?.crew?.direction).toBe('المعادي');
    const two = await saved({ rows: [{ vehicleId: van3, direction: 'المعادى و حلوان' }] });
    expect(vanRow(two, van3)?.crew?.direction).toBe('المعادي - حلوان');
  });

  // REWRITTEN in Round 28 — was «refuses a new direction that is not an active area —
  // OPERATIONS_DIRECTION_NOT_AN_AREA». The owner reversed that rule: «عاوز الاتجاه اقدر اكتبه بايدى
  // لو مش موجود فى الليست».
  it('Round 28 — takes a new direction no active area answers, stored as typed and tidied; the code is no longer sent', async () => {
    const mixed = await save({ rows: [{ vehicleId: van3, direction: 'المعادي - طريق السويس' }] });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(200);
    expect(vanRow(data<OperationsCrewBoardDto>(mixed), van3)?.crew?.direction).toBe(
      'المعادي - طريق السويس',
    );
    // Trimmed, and every run of spaces inside it one space — the letters as typed.
    const spaced = await saved({
      rows: [{ vehicleId: van3, direction: '  طريق   مصر\tالإسماعيلية ' }],
    });
    expect(vanRow(spaced, van3)?.crew?.direction).toBe('طريق مصر الإسماعيلية');
    // An ARCHIVED area is no area to respell by: «الدقى» is kept as typed, not made «الدقي».
    const archived = await saved({ rows: [{ vehicleId: van3, direction: 'الدقى' }] });
    expect(vanRow(archived, van3)?.crew?.direction).toBe('الدقى');
  });

  it('Round 28 — never stores a blank direction, nor one past OPERATIONS_DIRECTION_MAX_LENGTH, and writes nothing then', async () => {
    const before = vanRow(await board(), van3)?.crew?.direction;
    const blank = await save({ rows: [{ vehicleId: van3, direction: '  \t ' }] });
    expect(blank.status).toBe(400);
    expect(errorOf(blank).code).toBe(ErrorCodes.VALIDATION_FAILED);
    // Round 28 critic — refused by the save, on the row that sent it (the shape refused it before,
    // and with it a row's own blank one sent back unchanged — see the next test); and «-» or a
    // zero-width space, which name nothing either (the filters count such a row «بدون اتجاه»).
    for (const nothing of ['  \t ', '-', ' ! ', '\u200b']) {
      const refused = await save({
        rows: [
          { vehicleId: van3, direction: before ?? null },
          { vehicleId: null, direction: nothing, notes: 'لن يُحفظ' },
        ],
      });
      expect(refused.status, nothing).toBe(400);
      expect(errorOf(refused).details, nothing).toEqual([
        expect.objectContaining({ field: 'body.rows.1.direction', code: 'TOO_SMALL' }),
      ]);
    }
    expect((await board()).vehiclelessRows.some((row) => row.notes === 'لن يُحفظ')).toBe(false);
    const longest = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH);
    const tooLong = await save({ rows: [{ vehicleId: van3, direction: `${longest}ب` }] });
    expect(tooLong.status).toBe(400);
    expect(vanRow(await board(), van3)?.crew?.direction).toBe(before);
    // The ceiling itself is taken, counted once tidied.
    const atCeiling = await saved({ rows: [{ vehicleId: van3, direction: `  ${longest}  ` }] });
    expect(vanRow(atCeiling, van3)?.crew?.direction).toBe(longest);
  });

  // Round 28 verify — the ceiling was the SHAPE's, on every direction: «معادي/حلوان/…» typed in 78
  // characters is ten areas, stored in their spelling in 120 — refused (400) at once, the board's
  // own respelling of it included — and a row's own direction of many areas saved since Round 20
  // past 80 made the row unsavable. It is the hand-typed text's now.
  it('holds only HAND-TYPED text to OPERATIONS_DIRECTION_MAX_LENGTH: a direction of areas is stored respelled past it, and a row’s own past it stays savable', async () => {
    const more = [
      'التجمع الخامس',
      'القاهرة الجديدة',
      'مصر الجديدة',
      'المقطم',
      'القطامية',
      'الشيخ زايد',
      'المهندسين',
      'العجوزة',
      'الزمالك',
    ];
    for (const name of more) await area(name);
    const typed = 'تجمع خامس/قاهرة جديدة/مصر جديدة/مقطم/قطامية/شيخ زايد/مهندسين/عجوزة/زمالك/معادي';
    expect(typed.length).toBeLessThanOrEqual(OPERATIONS_DIRECTION_MAX_LENGTH);
    const respelled = [...more, 'المعادي'].join(' - ');
    expect(respelled.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);

    const ten = await saved({ rows: [{ vehicleId: van3, direction: typed }] });
    expect(vanRow(ten, van3)?.crew?.direction).toBe(respelled);
    // The board sends the respelling itself (its box respells as the save does): taken too.
    const sentRespelled = await saved({
      rows: [{ vehicleId: van3, direction: respelled, notes: 'عشر مناطق' }],
    });
    expect(vanRow(sentRespelled, van3)?.crew).toMatchObject({
      direction: respelled,
      notes: 'عشر مناطق',
    });

    // A row's own direction past the ceiling — hand text written before — sent back unchanged with
    // another change: kept, the row saved.
    const crewId = vanRow(await board(), van3)?.crew?.id as string;
    const legacy = 'طريق '.repeat(20).trim();
    expect(legacy.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);
    await OperationsCrewAssignmentModel.updateOne(
      { _id: crewId },
      { $set: { direction: legacy } },
    ).exec();
    const kept = await saved({ rows: [{ vehicleId: van3, direction: legacy, notes: 'كما هو' }] });
    expect(vanRow(kept, van3)?.crew).toMatchObject({ direction: legacy, notes: 'كما هو' });

    // CHANGED to hand-typed text past it: refused on the row that sent it, nothing written.
    const tooLong = await save({
      rows: [
        { vehicleId: van3, direction: legacy, notes: 'لن يُحفظ' },
        { vehicleId: null, direction: `${'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH)}ب` },
      ],
    });
    expect(tooLong.status).toBe(400);
    expect(errorOf(tooLong).code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(errorOf(tooLong).details).toEqual([
      expect.objectContaining({ field: 'body.rows.1.direction', code: 'TOO_BIG' }),
    ]);
    const after = await board();
    expect(vanRow(after, van3)?.crew).toMatchObject({ direction: legacy, notes: 'كما هو' });
    const strayRow = after.vehiclelessRows.find((row) => row.direction?.startsWith('ططط') === true);
    expect(strayRow).toBeUndefined();
  });

  // Round 28b critic — split at «/» too, «شبرا/الخيمة - المعادي …» read again was no areas: the save
  // stored typed «شبرا الخيمة - …» as «شبرا/الخيمة - …» (91 characters), then refused that very text
  // sent NEW (400 TOO_BIG, hand-typed past the ceiling) — the form «تحميل الطاقم الثابت» copies a
  // standing direction in, onto a day row with none, and the form the board's picker picks.
  it('Round 28b critic — an area whose name holds a separator, inside a longer direction: its own respelling, sent new, is taken past the ceiling', async () => {
    const names = ['العاشر من رمضان', 'السادس من أكتوبر', 'مدينة بدر', 'حدائق الأهرام', 'الرحاب'];
    for (const name of ['شبرا/الخيمة', ...names]) await area(name);
    const respelled = ['شبرا/الخيمة', 'المعادي', 'حلوان', ...names].join(' - ');
    expect(respelled.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);

    // Typed as a desk types it: stored in the areas' spelling.
    const typed = await saved({
      rows: [
        { vehicleId: van3, direction: ['شبرا الخيمة', 'المعادى', 'حلوان', ...names].join(' - ') },
      ],
    });
    expect(vanRow(typed, van3)?.crew?.direction).toBe(respelled);

    // That respelling sent NEW, on a row with no direction of its own: taken, stored unchanged.
    const sent = await save({
      rows: [{ vehicleId: null, direction: respelled, notes: 'r28b شبرا' }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const loose = data<OperationsCrewBoardDto>(sent).vehiclelessRows.find(
      (row) => row.notes === 'r28b شبرا',
    );
    expect(loose?.direction).toBe(respelled);
    // The row was only the vehicle: gone again, for the rows-without-a-van tests that count them.
    await saved({ rows: [], removeCrewAssignmentIds: [loose?.id as string] });
    // Short, too: «شبرا/الخيمة - المعادي» is areas — respelled, not stored as hand-typed text.
    const short = await saved({ rows: [{ vehicleId: van3, direction: 'شبرا/الخيمه - معادي' }] });
    expect(vanRow(short, van3)?.crew?.direction).toBe('شبرا/الخيمة - المعادي');
  });

  // Round 28 critic — a row's OWN direction that names nothing (the board before Round 20 stored any
  // text: «  », «-»), sent back unchanged beside another change: kept exactly, the row saved. The
  // shape refused «  » once tidied, so nothing on that row could be saved until somebody cleared
  // its direction — and the board marked no row.
  it('keeps a row’s own blank or «-» direction sent back unchanged — the row stays savable', async () => {
    const crewId = vanRow(await board(), van3)?.crew?.id as string;
    for (const held of ['  ', '-', '\u200b']) {
      await OperationsCrewAssignmentModel.updateOne(
        { _id: crewId },
        { $set: { direction: held } },
      ).exec();
      const kept = await save({
        rows: [{ vehicleId: van3, direction: held, notes: `كما هو ${held.length}` }],
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect(vanRow(data<OperationsCrewBoardDto>(kept), van3)?.crew).toMatchObject({
        direction: held,
        notes: `كما هو ${held.length}`,
      });
    }
    // Changed from it to text that names something: taken, tidied and with no invisible mark.
    const changed = await saved({
      rows: [{ vehicleId: van3, direction: '\u200fطريق   السويس\u200b' }],
    });
    expect(vanRow(changed, van3)?.crew?.direction).toBe('طريق السويس');
  });

  // REWRITTEN in Round 28 — was «keeps a direction saved before the rule while it is sent unchanged,
  // and refuses changing it to another». Changing it to a hand-typed one is now taken.
  it('keeps a direction saved before exactly while it is sent unchanged (spaces aside), and takes changing it to another', async () => {
    const crewId = vanRow(await board(), van3)?.crew?.id as string;
    // A direction written before Round 20 — free text no area answers, with spaces of its own.
    await OperationsCrewAssignmentModel.updateOne(
      { _id: crewId },
      { $set: { direction: 'طريق  السويس ' } },
    ).exec();
    const kept = await saved({
      rows: [{ vehicleId: van3, direction: 'طريق السويس', notes: 'كما هو' }],
    });
    expect(vanRow(kept, van3)?.crew).toMatchObject({ direction: 'طريق  السويس ', notes: 'كما هو' });
    // Changed to another text no area answers: taken as typed (Round 20 refused it).
    const changed = await saved({ rows: [{ vehicleId: van3, direction: 'طريق الإسماعيلية' }] });
    expect(vanRow(changed, van3)?.crew?.direction).toBe('طريق الإسماعيلية');
    // Changed to an area: the area's spelling, as ever.
    const area = await saved({ rows: [{ vehicleId: van3, direction: 'حلوان' }] });
    expect(vanRow(area, van3)?.crew?.direction).toBe('حلوان');
    // Clearing it is always allowed.
    const cleared = await saved({ rows: [{ vehicleId: van3, direction: null }] });
    expect(vanRow(cleared, van3)?.crew?.direction).toBeNull();
  });
});

// Round 28c — asked whether a direction typed by hand should also go on the list, the owner: «يعرض
// عليا اضيفه او لا». The box offers «إضافة «…» إلى القائمة» beside «استخدام «…» اتجاهًا», and the
// add is the areas catalog's own create (`POST /operations/areas`, `operationsCatalog.manage` — no
// new grant), written at once, not at «حفظ».
describe('Round 28c — «إضافة «…» إلى القائمة»: the direction box adds a name to «المناطق»', () => {
  const addArea = (name: string, token = adminToken): request.Test =>
    request(app)
      .post('/api/v1/operations/areas')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, nameEn: null });
  const areaNames = async (): Promise<string[]> => {
    const res = await request(app)
      .get('/api/v1/operations/areas?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return data<{ name: string }[]>(res).map((row) => row.name);
  };
  const messageOf = (res: request.Response): string =>
    (res.body as { error: { message: string } }).error.message;

  it('adds the name as the box sends it, answers it in the area’s own spelling, and the board then reads it as an area', async () => {
    const added = await addArea('طريق الواحات');
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(data<{ name: string; nameEn: string | null; isActive: boolean }>(added)).toMatchObject({
      name: 'طريق الواحات',
      nameEn: null,
      isActive: true,
    });
    // An area now: beside another, in another spelling, the save respells both — a hand-typed
    // direction would have been stored as typed.
    const onRow = await saved({ rows: [{ vehicleId: van3, direction: 'طريق الواحات و المعادى' }] });
    expect(vanRow(onRow, van3)?.crew?.direction).toBe('طريق الواحات - المعادي');
    const cleared = await saved({ rows: [{ vehicleId: van3, direction: null }] });
    expect(vanRow(cleared, van3)?.crew?.direction).toBeNull();
  });

  // The unique index held the exact name only: «المعادى» beside «المعادي» went in as a second
  // spelling of one area, which the direction rules read as one.
  it('refuses a name that folds to a live area’s — another spelling, the article off, an archived one — 409 DUPLICATE, nothing added', async () => {
    const before = await areaNames();
    for (const name of ['المعادى', 'معادي', 'طريق الواحات', 'الدقى']) {
      const refused = await addArea(name);
      expect(refused.status, name).toBe(409);
      expect(errorOf(refused).code, name).toBe(ErrorCodes.DUPLICATE);
    }
    // The refusal names the area that holds the name, and says when it is archived.
    expect(messageOf(await addArea('المعادى'))).toContain('«المعادي»');
    expect(messageOf(await addArea('الدقى'))).toContain('«الدقي» (archived)');
    // Round 28c critic — and so does its detail, for a screen to say which area holds it (the box
    // said «added meanwhile» of an archived area its list never had).
    expect(errorOf(await addArea('المعادى')).details).toEqual([
      { field: 'name', code: 'AREA_ACTIVE', message: 'المعادي' },
    ]);
    expect(errorOf(await addArea('الدقى')).details).toEqual([
      { field: 'name', code: 'AREA_ARCHIVED', message: 'الدقي' },
    ]);
    expect(await areaNames()).toEqual(before);
  });

  // Round 28c critic — the folded rule held the create only: renaming an area in «البيانات
  // المرجعية» to another spelling of a live one went through, and the direction rules then read the
  // two as one.
  it('refuses a RENAME to another spelling of a live area alike — 409 with the detail — and lets an area keep its own name', async () => {
    const rename = (target: { id: string; version: number }, body: Record<string, unknown>) =>
      request(app)
        .patch(`/api/v1/operations/areas/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...body, version: target.version });
    const fresh = await area('حدائق القبة');
    for (const [name, code, holder] of [
      ['المعادى', 'AREA_ACTIVE', 'المعادي'],
      ['الدقى', 'AREA_ARCHIVED', 'الدقي'],
    ] as const) {
      const refused = await rename(fresh, { name });
      expect(refused.status, name).toBe(409);
      expect(errorOf(refused)).toMatchObject({
        code: ErrorCodes.DUPLICATE,
        details: [{ field: 'name', code, message: holder }],
      });
    }
    // Its own name respelled is no other area's.
    const respelled = await rename(fresh, { name: 'حدائق القبه' });
    expect(respelled.status, JSON.stringify(respelled.body)).toBe(200);
    // Two spellings written before the rule (straight to the catalog) still save what is not the
    // name — the English name, archived, restored.
    const twin = await operationsAreaRepository.create(
      { name: 'المعادى', nameEn: null, governorate: null, isActive: true },
      { by: adminId },
    );
    const kept = await rename(
      { id: String(twin._id), version: twin.__v },
      { nameEn: 'Maadi', isActive: false },
    );
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    await OperationsAreaModel.deleteOne({ _id: twin._id }).exec();
  });

  // Round 28c critic — the folded check read the areas, then wrote: two desks pressing «إضافة» on
  // two spellings of one new name at the same moment both passed it (the unique index holds the
  // exact name only), and one spelling then silently won on every row. Checked and written one at
  // a time now: one is added, the others are refused naming it.
  it('two spellings of one new name sent at the same moment: ONE is added, the others refused 409 naming it', async () => {
    const spellings = ['زهراء المعادى', 'زهراء المعادي', 'زهراء معادي'];
    const answers = await Promise.all(spellings.map((name) => addArea(name)));
    const statuses = answers.map((res) => res.status).sort();
    expect(statuses, JSON.stringify(answers.map((res) => res.body))).toEqual([201, 409, 409]);
    const won = data<{ name: string }>(
      answers.find((res) => res.status === 201) as request.Response,
    );
    for (const refused of answers.filter((res) => res.status === 409)) {
      expect(errorOf(refused).details).toEqual([
        { field: 'name', code: 'AREA_ACTIVE', message: won.name },
      ]);
    }
    expect((await areaNames()).filter((name) => spellings.includes(name))).toEqual([won.name]);
    // Two renames to two spellings of one new name, at the same moment, alike.
    const [one, two] = await Promise.all([area('حي السفارات'), area('حي الأشجار')]);
    const renames = await Promise.all(
      [
        [one, 'الحي الثامن'],
        [two, 'الحى الثامن'],
      ].map(([target, name]) =>
        request(app)
          .patch(`/api/v1/operations/areas/${(target as { id: string }).id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name, version: (target as { version: number }).version }),
      ),
    );
    expect(renames.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  it('is the catalog’s own grant: a planner without operationsCatalog.manage is refused (403), and his row still takes the text', async () => {
    const planner = await tokenWith('ops-r28c-planner@ecms.local', [
      'operationsCrew.view',
      'operationsCrew.plan',
    ]);
    const refused = await addArea('طريق الفيوم', planner);
    expect(refused.status).toBe(403);
    expect(await areaNames()).not.toContain('طريق الفيوم');
    // «استخدام «…» اتجاهًا» — on his row only, as typed.
    const typed = await save(
      { rows: [{ vehicleId: van3, direction: 'طريق الفيوم' }] },
      DAY,
      planner,
    );
    expect(typed.status, JSON.stringify(typed.body)).toBe(200);
    expect(vanRow(data<OperationsCrewBoardDto>(typed), van3)?.crew?.direction).toBe('طريق الفيوم');
    const cleared = await saved({ rows: [{ vehicleId: van3, direction: null }] });
    expect(vanRow(cleared, van3)?.crew?.direction).toBeNull();
  });
});

describe('the slots — «من 1 ل 2 قادة و من 2 ل 4 اخصائيين»', () => {
  it('refuses a third person in any slot, and asks no minimum', async () => {
    for (const slot of ['captainEmployeeIds', 'specialist1EmployeeIds', 'specialist2EmployeeIds']) {
      const res = await save({ rows: [{ vehicleId: van3, [slot]: [cap3, spec2, spec3] }] });
      expect(res.status, slot).toBe(400);
    }
    // One captain and nobody else is a row being planned — the board warns, the save takes it.
    const res = await saved({ rows: [{ vehicleId: van3, captainEmployeeIds: [cap3] }] });
    expect(vanRow(res, van3)?.crew?.captainEmployeeIds).toEqual([cap3]);
    await saved({ rows: [{ vehicleId: van3 }] });
  });
});

describe('rows WITHOUT A VAN — «صف ميكونش ليه عربيه»', () => {
  let looseA = '';
  let looseB = '';

  it('creates rows without a van, apart from the vans’ rows, two on one day', async () => {
    const travel = await typeNamed('سفر');
    const res = await saved({
      rows: [
        {
          vehicleId: null,
          captainEmployeeIds: [cap2],
          specialist1EmployeeIds: [spec2],
          direction: 'حلوان',
          plannedTime: '06:00',
          notes: 'سفر — العودة غدًا',
          shiftTypeId: travel.id,
          rowColour: 'orange',
        },
        { vehicleId: null, specialist2EmployeeIds: [spec3] },
        // Blank — nothing to save, nothing created.
        { vehicleId: null },
      ],
    });
    expect(res.changedCount).toBe(2);
    expect(res.vehiclelessRows).toHaveLength(2);
    const [a, b] = res.vehiclelessRows;
    expect(a).toMatchObject({
      captainEmployeeIds: [cap2],
      specialist1EmployeeIds: [spec2],
      specialist2EmployeeIds: [],
      direction: 'حلوان',
      plannedTime: '06:00',
      notes: 'سفر — العودة غدًا',
      shiftTypeId: travel.id,
      rowColour: 'orange',
    });
    expect(b?.specialist2EmployeeIds).toEqual([spec3]);
    looseA = a?.id as string;
    looseB = b?.id as string;
    // The vans' rows hold none of them.
    expect(res.rows.map((row) => row.crew?.id)).not.toContain(looseA);
    const stored = await OperationsCrewAssignmentModel.findById(looseA).lean().exec();
    expect(stored).toMatchObject({ vehicleId: null, fleetDutyAssignmentId: null });
  });

  it('announces a row without a van with its own id and a null van', async () => {
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === OperationsEvents.CrewAssignmentChanged &&
          (e.payload as { crewAssignmentId: string }).crewAssignmentId === looseA,
      ),
    );
    const event = seenEvents.find(
      (e) =>
        e.name === OperationsEvents.CrewAssignmentChanged &&
        (e.payload as { crewAssignmentId: string }).crewAssignmentId === looseA,
    );
    expect(event?.payload).toMatchObject({ vehicleId: null, captainEmployeeIds: [cap2] });
  });

  it('edits a saved one by its id', async () => {
    const res = await saved({
      rows: [
        {
          vehicleId: null,
          crewAssignmentId: looseB,
          specialist2EmployeeIds: [spec3],
          rowColour: 'rose',
        },
      ],
    });
    expect(res.changedCount).toBe(1);
    expect(res.vehiclelessRows.find((row) => row.id === looseB)).toMatchObject({
      rowColour: 'rose',
    });
  });

  it('refuses an id that is no row of the day, or a van’s', async () => {
    const stranger = await save({
      rows: [{ vehicleId: null, crewAssignmentId: new Types.ObjectId().toString(), notes: 'x' }],
    });
    expect(stranger.status).toBe(404);
    // A row of ANOTHER day is no row of this one.
    const other = await saved({ rows: [{ vehicleId: null, notes: 'غدًا' }] }, OTHER);
    const otherId = other.vehiclelessRows[0]?.id as string;
    expect(
      (await save({ rows: [{ vehicleId: null, crewAssignmentId: otherId, notes: 'x' }] })).status,
    ).toBe(404);
    // A van's row is addressed by its van, never by id, and is emptied — never removed.
    const vanCrew = vanRow(await board(), van1)?.crew?.id as string;
    const asLoose = await save({
      rows: [{ vehicleId: null, crewAssignmentId: vanCrew, notes: 'x' }],
    });
    expect(asLoose.status).toBe(422);
    const removeVan = await save({ rows: [], removeCrewAssignmentIds: [vanCrew] });
    expect(removeVan.status).toBe(422);
    expect(vanRow(await board(), van1)?.crew?.id).toBe(vanCrew);
  });

  it('Q11 counts a row without a van — one person, one row per day', async () => {
    // cap2 sits on looseA; planning him onto van 2 without releasing looseA is refused.
    const res = await save({ rows: [{ vehicleId: van2, captainEmployeeIds: [cap2] }] });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('without a vehicle');
    // …and inside one save, the schema's own cross-row check.
    const inPlan = await save({
      rows: [
        { vehicleId: van2, captainEmployeeIds: [cap3] },
        { vehicleId: null, specialist1EmployeeIds: [cap3] },
      ],
    });
    expect(inPlan.status).toBe(400);
    // Moving him WITH the release is one valid end state.
    const moved = await saved({
      rows: [
        { vehicleId: van2, captainEmployeeIds: [cap2] },
        { vehicleId: null, crewAssignmentId: looseA, specialist1EmployeeIds: [spec2] },
      ],
    });
    expect(vanRow(moved, van2)?.crew?.captainEmployeeIds).toEqual([cap2]);
    expect(moved.vehiclelessRows.find((row) => row.id === looseA)?.captainEmployeeIds).toEqual([]);
    // And back, for the cases below.
    await saved({
      rows: [
        { vehicleId: van2, rowColour: 'sky' },
        {
          vehicleId: null,
          crewAssignmentId: looseA,
          captainEmployeeIds: [cap2],
          specialist1EmployeeIds: [spec2],
          direction: 'حلوان',
          plannedTime: '06:00',
          notes: 'سفر — العودة غدًا',
          shiftTypeId: (await typeNamed('سفر')).id,
          rowColour: 'orange',
        },
      ],
    });
  });

  it('Round 24 — is a crew to the distribution and the captain’s day; the pool and the daily pickup still want a van', async () => {
    // The pool: cap2 holds no VEHICLE (his row has none); cap1, on van 1, holds van 1. Both get a
    // requirements row, which is what puts them on an unconfigured install's roster.
    for (const employeeId of [cap1, cap2]) {
      const flagged = await request(app)
        .put(`/api/v1/operations/crew-board/requirements/${employeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isCaptain: true });
      expect(flagged.status, JSON.stringify(flagged.body)).toBe(200);
    }
    const pool = await request(app)
      .get(`/api/v1/operations/crew-board/directory?date=${DAY}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pool.status).toBe(200);
    const members = data<OperationsCrewDirectoryDto>(pool).members;
    expect(members.find((m) => m.employeeId === cap2)?.assignedVehicleId).toBeNull();
    expect(members.find((m) => m.employeeId === cap1)?.assignedVehicleId).toBe(van1);

    // «حضور الطاقم» still says he is crewed today: the row holds him, van or none.
    const attendance = await request(app)
      .get(`/api/v1/operations/crew-board/attendance?date=${DAY}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(attendance.status, JSON.stringify(attendance.body)).toBe(200);
    const day = data<OperationsCrewAttendanceDayDto>(attendance).members;
    expect(day.find((m) => m.employeeId === cap2)).toMatchObject({ assignedVehicleId: null, isCrewed: true });
    expect(day.find((m) => m.employeeId === cap1)).toMatchObject({ assignedVehicleId: van1, isCrewed: true });

    // Round 24 — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: «توزيع المحصنات» lists
    // the row without a van too, AFTER the vans, naming no van (never the string "null").
    // Round 25 — «انا عاوز اللى يظهر اللى نوعها محصنة بس»: only a row of the «محصنة» type. looseA
    // is «سفر», so it is not listed; made «محصنة», it is.
    const distributionCrews = async () => {
      const res = await request(app)
        .get(`/api/v1/operations/secured/distribution?date=${DAY}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return data<OperationsSecuredDistributionDto>(res).crews;
    };
    expect((await distributionCrews()).map((van) => van.crewAssignmentId)).not.toContain(looseA);
    const secured = await typeNamed('محصنة');
    await OperationsCrewAssignmentModel.updateOne(
      { _id: looseA },
      { $set: { shiftTypeId: new Types.ObjectId(secured.id) } },
    ).exec();
    const vans = await distributionCrews();
    const loose = vans.find((van) => van.crewAssignmentId === looseA);
    expect(loose).toMatchObject({ vehicleId: null, vehicleCode: null, drivers: [], securedType: true });
    expect(loose?.captains.map((p) => p.employeeId)).toEqual([cap2]);
    // …after every van: the cards with a van first, then the rows without one.
    const firstLoose = vans.findIndex((van) => van.vehicleId === null);
    expect(vans.slice(firstLoose).every((van) => van.vehicleId === null)).toBe(true);
    expect(vans.every((van) => van.vehicleId !== 'null')).toBe(true);
    // Back to «سفر», as the cases below expect it.
    await OperationsCrewAssignmentModel.updateOne(
      { _id: looseA },
      { $set: { shiftTypeId: new Types.ObjectId((await typeNamed('سفر')).id) } },
    ).exec();

    // The captain's day: captaincy is the day's plan, van or none — cap2 is a captain today.
    const dayRow = (await board()).day;
    expect(
      (await operationsCrewAssignmentRepository.findForCaptainDay(dayRow?.id as string, cap2)).map(
        (row) => String(row._id),
      ),
    ).toEqual([looseA]);
    // …while the daily PICKUP leg still rides a van's row only.
    expect(await operationsCrewAssignmentRepository.findVanById(looseA)).toBeNull();

    // A daily pickup rides a VAN: booking one onto the row without one answers 404, as for no row.
    const bank = data<OperationsBankDto>(
      await request(app)
        .post('/api/v1/operations/banks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 20, name: { ar: 'بنك التشغيلة', en: 'Plan Bank' }, opsName: 'التشغيلة' }),
    );
    const branch = data<OperationsBankBranchDto>(
      await request(app)
        .post('/api/v1/operations/bank-branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId: bank.id, name: 'فرع التشغيلة', code: 'P-1', opsAreaName: 'حلوان' }),
    );
    const egp = data<OperationsCurrencyDto>(
      await request(app)
        .post('/api/v1/operations/currencies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'EGP', name: 'مصري', legacyAliases: ['مصري'] }),
    );
    const booked = await request(app)
      .post('/api/v1/operations/shipments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        shipmentType: 'daily',
        mainBankId: bank.id,
        originBranchId: branch.id,
        destinationBranchId: branch.id,
        lines: [{ currencyId: egp.id, amount: 100 }],
        collectionDate: DAY,
        pickup: { crewAssignmentId: looseA, captainEmployeeId: cap2 },
      });
    expect(booked.status, JSON.stringify(booked.body)).toBe(404);
  });

  it('is GIVEN A VAN the way the board does it — the van’s row, and the old row removed, in one save', async () => {
    // The row's type is archived meanwhile, and its direction is now one no area answers: both ride
    // onto the van unchecked, because they are the same values MOVED, not new choices.
    const travel = await typeNamed('سفر');
    await OperationsCrewAssignmentModel.updateOne(
      { _id: looseA },
      { $set: { direction: 'طريق السويس' } },
    ).exec();
    const off = await request(app)
      .patch(`/api/v1/operations/shift-types/${travel.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: travel.version });
    expect(off.status).toBe(200);

    const res = await saved({
      rows: [
        {
          vehicleId: van3,
          captainEmployeeIds: [cap2],
          specialist1EmployeeIds: [spec2],
          direction: 'طريق السويس',
          plannedTime: '06:00',
          notes: 'سفر — العودة غدًا',
          shiftTypeId: travel.id,
          rowColour: 'orange',
        },
      ],
      removeCrewAssignmentIds: [looseA],
    });
    expect(res.vehiclelessRows.map((row) => row.id)).not.toContain(looseA);
    expect(vanRow(res, van3)?.crew).toMatchObject({
      captainEmployeeIds: [cap2],
      specialist1EmployeeIds: [spec2],
      direction: 'طريق السويس',
      shiftTypeId: travel.id,
      rowColour: 'orange',
    });
    // Soft-deleted: the audit trail and any reader by id keep it.
    const gone = await OperationsCrewAssignmentModel.findById(looseA).lean().exec();
    expect(gone?.isDeleted).toBe(true);

    const back = await request(app)
      .patch(`/api/v1/operations/shift-types/${travel.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true, version: data<OperationsShiftTypeDto>(off).version });
    expect(back.status).toBe(200);
  });

  it('deletes a saved one, and refuses deleting it twice', async () => {
    const res = await saved({ rows: [], removeCrewAssignmentIds: [looseB] });
    expect(res.changedCount).toBe(1);
    expect(res.vehiclelessRows).toEqual([]);
    const twice = await save({ rows: [], removeCrewAssignmentIds: [looseB] });
    expect(twice.status).toBe(404);
    const empty = await save({ rows: [] });
    expect(empty.status).toBe(400);
  });
});

describe('`ux_day_vehicle` — one row per van per day, any number without a van', () => {
  const dayId = async (): Promise<Types.ObjectId> =>
    new Types.ObjectId((await board()).day?.id as string);

  it('lets rows without a van share a day, and still refuses a van twice', async () => {
    const operationsDayId = await dayId();
    const base = {
      operationsDayId,
      captainEmployeeIds: [],
      specialist1EmployeeIds: [],
      specialist2EmployeeIds: [],
    };
    const docs = await OperationsCrewAssignmentModel.create([
      { ...base, vehicleId: null, fleetDutyAssignmentId: null },
      { ...base, vehicleId: null, fleetDutyAssignmentId: null },
    ]);
    expect(docs).toHaveLength(2);
    await expect(
      OperationsCrewAssignmentModel.create({
        ...base,
        vehicleId: new Types.ObjectId(van1),
        fleetDutyAssignmentId: new Types.ObjectId(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
    await OperationsCrewAssignmentModel.deleteMany({ _id: { $in: docs.map((d) => d._id) } }).exec();
  });

  it('is rebuilt on boot where a database still holds the old shape, and left alone after', async () => {
    const collection = OperationsCrewAssignmentModel.collection;
    await collection.dropIndex('ux_day_vehicle');
    await collection.createIndex(
      { operationsDayId: 1, vehicleId: 1 },
      { unique: true, name: 'ux_day_vehicle', partialFilterExpression: { isDeleted: false } },
    );
    await migrateCrewAssignmentIndexes();
    const rebuilt = (await collection.indexes()).find((ix) => ix.name === 'ux_day_vehicle');
    expect(rebuilt?.partialFilterExpression).toEqual({
      isDeleted: false,
      vehicleId: { $type: 'objectId' },
    });
    await migrateCrewAssignmentIndexes();
    expect((await collection.indexes()).find((ix) => ix.name === 'ux_day_vehicle')).toEqual(
      rebuilt,
    );
  });
});

describe('the board’s read — drivers by name, and «صيانة»', () => {
  it('names each van’s drivers, and nothing more about them', async () => {
    const dto = await board(DAY, crewViewerToken);
    const drivers = vanRow(dto, van1)?.drivers;
    expect(drivers).toEqual([
      { employeeId: drv1, fullNameAr: 'سائق التشغيلة الأول' },
      { employeeId: drv2, fullNameAr: 'سائق التشغيلة الثاني' },
    ]);
    expect(vanRow(dto, van2)?.drivers).toEqual([]);
    // Fleet's two seats, still there as before.
    expect(vanRow(dto, van1)).toMatchObject({ driver1EmployeeId: drv1, driver2EmployeeId: drv2 });
  });

  it('lists Operations’ vans the workshop holds on the day — by code, never the whole fleet', async () => {
    const dto = await board();
    // Van 4: the standing crew's, in the workshop since before DAY. Van 5 is in the workshop but
    // is nobody's in Operations; van 6 is the standing crew's but checks in only after DAY.
    expect(dto.workshopVehicles).toEqual([{ vehicleId: van4, vehicleCode: 'OPS-P4' }]);
    // The workshop vans are a figure, not rows: van 4 is no row of the board.
    expect(dto.rows.map((row) => row.vehicleId)).not.toContain(van4);
    // On the day after, van 6 is in too.
    expect((await board(OTHER)).workshopVehicles.map((van) => van.vehicleCode)).toEqual([
      'OPS-P4',
      'OPS-P6',
    ]);
  });

  it('answers a day nobody planned with no rows of any kind', async () => {
    const dto = await board(shift(70));
    expect(dto.day).toBeNull();
    expect(dto.vehiclelessRows).toEqual([]);
    expect(dto.workshopVehicles.map((van) => van.vehicleCode)).toEqual(['OPS-P4', 'OPS-P6']);
  });
});

describe('Round 22 — who is away cannot be put on a row («لو القائد غايب ... مقدرش احطه على العربيه»)', () => {
  // «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت ومقدرش احطه على العربيه و
  // كذلك الاخصائيين». The pool says who HR has away on the day; the save refuses to NEWLY place them.
  // The HR facts are written straight into HR's collections — the fixture is the day record and the
  // approved leave, not HR's screens — on a day of its own, so no case above meets them.
  const AWAY_DAY = shift(80);
  const at = (date: string) => new Date(`${date}T00:00:00.000Z`);
  let absentCap = ''; // HR's record: absent
  let leaveSpec = ''; // HR's record: on leave
  let plannedLeave = ''; // no record yet — an APPROVED leave covers the day
  let incompleteSpec = ''; // HR's record: incomplete — attendance could not decide
  let freeSpec = ''; // no record, no leave
  let laterAway = ''; // planned first, recorded absent after — a captain-specialist (see below)

  const dayRecord = (employeeId: string, status: string, date = AWAY_DAY) =>
    AttendanceDayModel.create({
      employeeId: new Types.ObjectId(employeeId),
      workDate: at(date),
      status,
      branchId: new Types.ObjectId(branchId),
      computedAt: new Date(),
    });

  const pool = async (date = AWAY_DAY, token = adminToken) => {
    const res = await request(app)
      .get(`/api/v1/operations/crew-board/directory?date=${date}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const members = data<OperationsCrewDirectoryDto>(res).members;
    return (employeeId: string) => members.find((m) => m.employeeId === employeeId);
  };

  beforeAll(async () => {
    absentCap = await mkEmployee('قائد غائب');
    leaveSpec = await mkEmployee('أخصائي في إجازة');
    plannedLeave = await mkEmployee('أخصائي إجازته معتمدة');
    incompleteSpec = await mkEmployee('أخصائي لم يُحسم يومه');
    freeSpec = await mkEmployee('أخصائي حاضر');
    laterAway = await mkEmployee('قائد غاب بعد التخطيط');
    // A requirements row is what puts them on an unconfigured install's roster. `laterAway` is
    // ticked BOTH (Round 23): the case below moves him from the captain's slot to a specialist's on
    // his own row, which only a captain-specialist may take — the absence rule is what it asks about.
    for (const [employeeId, flags] of [
      [absentCap, { isCaptain: true }],
      [laterAway, { isCaptain: true, isSpecialist: true }],
      [leaveSpec, { isSpecialist: true }],
      [plannedLeave, { isSpecialist: true }],
      [incompleteSpec, { isSpecialist: true }],
      [freeSpec, { isSpecialist: true }],
    ] as const) {
      const flagged = await request(app)
        .put(`/api/v1/operations/crew-board/requirements/${employeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(flags);
      expect(flagged.status, JSON.stringify(flagged.body)).toBe(200);
    }
    // Van 2 is on the Fleet roster that day, so the refusal is asked of a van too.
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: AWAY_DAY, rows: [{ vehicleId: van2, notes: 'r22' }] });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);

    await dayRecord(absentCap, 'absent');
    await dayRecord(leaveSpec, 'onLeave');
    await dayRecord(incompleteSpec, 'incomplete');
    // HR computes a day only once it is over, so the one fact HR already holds about a coming day
    // is an approved leave — written here as HR's approval leaves it, not yet started.
    await LeaveRequestModel.create({
      employeeId: new Types.ObjectId(plannedLeave),
      employeeCode: 'R22-LEAVE',
      employeeName: 'أخصائي إجازته معتمدة',
      typeId: new Types.ObjectId(),
      typeCode: 'ANNUAL',
      status: 'approved',
      startDate: at(shift(79)),
      endDate: at(shift(81)),
      days: 3,
    });
  });

  it('the pool says who is away that day — and an unknown is not away', async () => {
    // Read under the roster's own grant, like the rest of the member.
    const member = await pool(AWAY_DAY, crewViewerToken);
    expect(member(absentCap)?.availability).toBe('absent');
    expect(member(leaveSpec)?.availability).toBe('onLeave');
    expect(member(plannedLeave)?.availability).toBe('onLeave');
    expect(member(incompleteSpec)?.availability).toBeNull();
    expect(member(freeSpec)?.availability).toBeNull();
    // A record is ONE day's answer: the day before, the absent captain is nobody's concern.
    expect((await pool(shift(79)))(absentCap)?.availability).toBeNull();
    // Only the bucket travels — not HR's record.
    expect(Object.keys(member(absentCap) ?? {})).not.toContain('attendance');
  });

  it('refuses to put an absent captain on a row — coded, naming him and the row, nothing written', async () => {
    const res = await save(
      {
        rows: [
          { vehicleId: van2, specialist1EmployeeIds: [freeSpec] },
          { vehicleId: null, captainEmployeeIds: [absentCap], notes: 'r22' },
        ],
      },
      AWAY_DAY,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe(ErrorCodes.OPERATIONS_CREW_MEMBER_ABSENT);
    expect(error.details).toEqual([
      { field: 'employeeId', code: 'ABSENT', message: absentCap },
      { field: 'rows', code: 'ROW_INDEX', message: '1' },
    ]);
    // One end state, refused as one: the van's row was not written either.
    const dto = await board(AWAY_DAY);
    expect(vanRow(dto, van2)?.crew).toBeNull();
    expect(dto.vehiclelessRows).toEqual([]);
  });

  it('refuses a specialist on leave — by HR’s record, or by an approved leave HR has not computed yet', async () => {
    for (const employeeId of [leaveSpec, plannedLeave]) {
      const res = await save(
        { rows: [{ vehicleId: van2, specialist2EmployeeIds: [employeeId] }] },
        AWAY_DAY,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ErrorCodes.OPERATIONS_CREW_MEMBER_ABSENT,
        details: [
          { field: 'employeeId', code: 'ON_LEAVE', message: employeeId },
          { field: 'rows', code: 'ROW_INDEX', message: '0' },
        ],
      });
    }
    expect(vanRow(await board(AWAY_DAY), van2)?.crew).toBeNull();
  });

  it('lets an unknown through — «incomplete» and no record at all are not absences', async () => {
    const res = await saved(
      {
        rows: [
          { vehicleId: null, specialist1EmployeeIds: [incompleteSpec, freeSpec], notes: 'r22 unknown' },
        ],
      },
      AWAY_DAY,
    );
    expect(res.vehiclelessRows[0]?.specialist1EmployeeIds).toEqual([incompleteSpec, freeSpec]);
  });

  it('keeps somebody already on the row — planned before HR recorded the absence — and saves the row’s other changes', async () => {
    const planned = await saved(
      { rows: [{ vehicleId: van2, captainEmployeeIds: [laterAway], plannedTime: '07:00' }] },
      AWAY_DAY,
    );
    expect(vanRow(planned, van2)?.crew?.captainEmployeeIds).toEqual([laterAway]);
    await dayRecord(laterAway, 'absent');
    expect((await pool())(laterAway)?.availability).toBe('absent');

    // The same row, other changes — he stays and the save passes; within the row is still the row.
    const edited = await saved(
      {
        rows: [
          {
            vehicleId: van2,
            specialist1EmployeeIds: [laterAway],
            plannedTime: '08:15',
            rowColour: 'emerald',
          },
        ],
      },
      AWAY_DAY,
    );
    expect(vanRow(edited, van2)?.crew).toMatchObject({
      captainEmployeeIds: [],
      specialist1EmployeeIds: [laterAway],
      plannedTime: '08:15',
      rowColour: 'emerald',
    });

    // Moved to ANOTHER row, he is being put on it — refused, and the van keeps him.
    const moved = await save(
      {
        rows: [
          { vehicleId: van2, plannedTime: '08:15', rowColour: 'emerald' },
          { vehicleId: null, captainEmployeeIds: [laterAway] },
        ],
      },
      AWAY_DAY,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(422);
    expect(errorOf(moved).details).toContainEqual({ field: 'rows', code: 'ROW_INDEX', message: '1' });
    expect(vanRow(await board(AWAY_DAY), van2)?.crew?.specialist1EmployeeIds).toEqual([laterAway]);

    // Taken off, he cannot be put back.
    await saved({ rows: [{ vehicleId: van2, plannedTime: '08:15' }] }, AWAY_DAY);
    const back = await save(
      { rows: [{ vehicleId: van2, captainEmployeeIds: [laterAway] }] },
      AWAY_DAY,
    );
    expect(back.status).toBe(422);
    expect(errorOf(back).details?.[0]).toEqual({
      field: 'employeeId',
      code: 'ABSENT',
      message: laterAway,
    });
  });
});

describe('Round 23 — a captain’s slot takes a captain, a specialist’s a specialist («ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»)', () => {
  // The owner, on «لوحة التشغيلة»: forbidden to put a captain in a specialist's slot or a specialist
  // in the captain's, EXCEPT a captain-specialist, who may go anywhere. The roles are the contracts'
  // own (`crewRoleOf`, `fitsCrewSlot`), read from «متطلبات الطاقم»; on a day of its own.
  const ROLE_DAY = shift(90);
  let onlyCaptain = ''; // «قائد» alone
  let onlySpecialist = ''; // «أخصائي» alone
  let both = ''; // «قائد» and «أخصائي» — the blue one, fit for every slot
  let unticked = ''; // a requirements row with neither ticked
  let rowless = ''; // no requirements row at all
  let reflagged = ''; // seated while both, then ticked «قائد» alone

  beforeAll(async () => {
    onlyCaptain = await mkEmployee('قائد فقط');
    onlySpecialist = await mkEmployee('أخصائي فقط');
    both = await mkEmployee('قائد وأخصائي');
    unticked = await mkEmployee('بلا علامة');
    rowless = await mkEmployee('بلا صف متطلبات');
    reflagged = await mkEmployee('تغيّرت علامته');
    await flag(onlyCaptain, { isCaptain: true });
    await flag(onlySpecialist, { isSpecialist: true });
    await flag(both, { isCaptain: true, isSpecialist: true });
    await flag(unticked, {});
    await flag(reflagged, { isCaptain: true, isSpecialist: true });
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: ROLE_DAY,
        rows: [
          { vehicleId: van2, notes: 'r23' },
          { vehicleId: van3, notes: 'r23' },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
  });

  it('refuses a captain-only in a specialist’s slot — coded, naming him and the row, nothing written', async () => {
    const res = await save(
      {
        rows: [
          { vehicleId: van3, captainEmployeeIds: [both] },
          { vehicleId: van2, specialist1EmployeeIds: [onlyCaptain] },
        ],
      },
      ROLE_DAY,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe(ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT);
    expect(error.details).toEqual([
      { field: 'employeeId', code: 'NOT_A_SPECIALIST', message: onlyCaptain },
      { field: 'rows', code: 'ROW_INDEX', message: '1' },
    ]);
    // One end state, refused as one: the other row was not written either.
    const dto = await board(ROLE_DAY);
    expect(vanRow(dto, van2)?.crew).toBeNull();
    expect(vanRow(dto, van3)?.crew).toBeNull();
    // «أخصائي 2» is a specialist's slot as much as «أخصائي 1».
    const second = await save(
      { rows: [{ vehicleId: van2, specialist2EmployeeIds: [onlyCaptain] }] },
      ROLE_DAY,
    );
    expect(second.status).toBe(422);
    expect(errorOf(second).details?.[0]).toEqual({
      field: 'employeeId',
      code: 'NOT_A_SPECIALIST',
      message: onlyCaptain,
    });
  });

  it('refuses a specialist in the captain’s slot — on a van and on a row without one', async () => {
    for (const vehicleId of [van2, null]) {
      const res = await save(
        { rows: [{ vehicleId, captainEmployeeIds: [onlySpecialist], notes: 'r23' }] },
        ROLE_DAY,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT,
        details: [
          { field: 'employeeId', code: 'NOT_A_CAPTAIN', message: onlySpecialist },
          { field: 'rows', code: 'ROW_INDEX', message: '0' },
        ],
      });
    }
    const dto = await board(ROLE_DAY);
    expect(vanRow(dto, van2)?.crew).toBeNull();
    expect(dto.vehiclelessRows).toEqual([]);
  });

  it('counts nobody ticked, and nobody with no requirements row, as a specialist', async () => {
    for (const employeeId of [unticked, rowless]) {
      const res = await save(
        { rows: [{ vehicleId: van2, captainEmployeeIds: [employeeId] }] },
        ROLE_DAY,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(errorOf(res).details?.[0]).toEqual({
        field: 'employeeId',
        code: 'NOT_A_CAPTAIN',
        message: employeeId,
      });
    }
    // …and a specialist's slot takes them both.
    const planned = await saved(
      {
        rows: [
          { vehicleId: van2, specialist1EmployeeIds: [unticked], specialist2EmployeeIds: [rowless] },
        ],
      },
      ROLE_DAY,
    );
    expect(vanRow(planned, van2)?.crew).toMatchObject({
      specialist1EmployeeIds: [unticked],
      specialist2EmployeeIds: [rowless],
    });
    await saved({ rows: [{ vehicleId: van2 }] }, ROLE_DAY);
  });

  it('seats a captain-specialist anywhere — the captain’s slot, either specialist’s', async () => {
    for (const slot of ['captainEmployeeIds', 'specialist1EmployeeIds', 'specialist2EmployeeIds']) {
      const planned = await saved({ rows: [{ vehicleId: van3, [slot]: [both] }] }, ROLE_DAY);
      expect(vanRow(planned, van3)?.crew?.[slot as 'captainEmployeeIds'], slot).toEqual([both]);
    }
    // A captain-only in the captain's slot and a specialist-only in a specialist's, beside him.
    const crew = await saved(
      {
        rows: [
          {
            vehicleId: van3,
            captainEmployeeIds: [onlyCaptain, both],
            specialist1EmployeeIds: [onlySpecialist],
          },
        ],
      },
      ROLE_DAY,
    );
    expect(vanRow(crew, van3)?.crew).toMatchObject({
      captainEmployeeIds: [onlyCaptain, both],
      specialist1EmployeeIds: [onlySpecialist],
    });
    await saved({ rows: [{ vehicleId: van3 }] }, ROLE_DAY);
  });

  it('keeps a seat held before his flags changed — the row’s other changes save; another slot is refused', async () => {
    const planned = await saved(
      { rows: [{ vehicleId: van2, specialist1EmployeeIds: [reflagged], plannedTime: '07:00' }] },
      ROLE_DAY,
    );
    expect(vanRow(planned, van2)?.crew?.specialist1EmployeeIds).toEqual([reflagged]);
    // «متطلبات الطاقم» changes him to a captain only — the seat he holds no longer fits him.
    await flag(reflagged, { isCaptain: true });

    // The same slot of the same row, other changes: he stays, and the save passes.
    const edited = await saved(
      {
        rows: [
          {
            vehicleId: van2,
            specialist1EmployeeIds: [reflagged],
            plannedTime: '08:15',
            rowColour: 'emerald',
          },
        ],
      },
      ROLE_DAY,
    );
    expect(vanRow(edited, van2)?.crew).toMatchObject({
      specialist1EmployeeIds: [reflagged],
      plannedTime: '08:15',
      rowColour: 'emerald',
    });

    // Moved to the other specialist's slot of the SAME row — a new seat, refused; the row stays.
    const moved = await save(
      { rows: [{ vehicleId: van2, specialist2EmployeeIds: [reflagged], plannedTime: '08:15' }] },
      ROLE_DAY,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(422);
    expect(errorOf(moved).details?.[0]).toEqual({
      field: 'employeeId',
      code: 'NOT_A_SPECIALIST',
      message: reflagged,
    });
    expect(vanRow(await board(ROLE_DAY), van2)?.crew?.specialist1EmployeeIds).toEqual([reflagged]);

    // Moved onto ANOTHER row in that same slot — a new seat too.
    const elsewhere = await save(
      {
        rows: [
          { vehicleId: van2, plannedTime: '08:15', rowColour: 'emerald' },
          { vehicleId: van3, specialist1EmployeeIds: [reflagged] },
        ],
      },
      ROLE_DAY,
    );
    expect(elsewhere.status).toBe(422);
    expect(errorOf(elsewhere).details).toContainEqual({
      field: 'rows',
      code: 'ROW_INDEX',
      message: '1',
    });

    // Taken out, he cannot be put back in it — but the captain's slot takes him now.
    await saved({ rows: [{ vehicleId: van2, plannedTime: '08:15' }] }, ROLE_DAY);
    const back = await save(
      { rows: [{ vehicleId: van2, specialist1EmployeeIds: [reflagged] }] },
      ROLE_DAY,
    );
    expect(back.status).toBe(422);
    const asCaptain = await saved(
      { rows: [{ vehicleId: van2, captainEmployeeIds: [reflagged] }] },
      ROLE_DAY,
    );
    expect(vanRow(asCaptain, van2)?.crew?.captainEmployeeIds).toEqual([reflagged]);
    await saved({ rows: [{ vehicleId: van2 }] }, ROLE_DAY);
  });

  it('keeps a held seat on a row WITHOUT a van through its own edits — but giving it a van is a new seat, refused', async () => {
    // The board refuses a van to such a row before «حفظ» (`giveVan`); this is the rule it mirrors.
    const looseHeld = await mkEmployee('مقعد محفوظ بلا سيارة');
    await flag(looseHeld, { isCaptain: true, isSpecialist: true });
    const planned = await saved(
      { rows: [{ vehicleId: null, specialist1EmployeeIds: [looseHeld], notes: 'r23-loose' }] },
      ROLE_DAY,
    );
    const loose = planned.vehiclelessRows.find((row) => row.notes === 'r23-loose');
    expect(loose?.specialist1EmployeeIds).toEqual([looseHeld]);
    const looseId = loose?.id ?? '';
    await flag(looseHeld, { isCaptain: true });

    // Its own row, by its id, same slot: kept, and the row's other changes save.
    const edited = await saved(
      {
        rows: [
          {
            vehicleId: null,
            crewAssignmentId: looseId,
            specialist1EmployeeIds: [looseHeld],
            notes: 'r23-loose',
            plannedTime: '09:30',
          },
        ],
      },
      ROLE_DAY,
    );
    expect(edited.vehiclelessRows.find((row) => row.id === looseId)).toMatchObject({
      specialist1EmployeeIds: [looseHeld],
      plannedTime: '09:30',
    });

    // Given a van: the van's row is another row, so the seat is new — refused, nothing written.
    const given = await save(
      {
        rows: [{ vehicleId: van2, specialist1EmployeeIds: [looseHeld], notes: 'r23-loose' }],
        removeCrewAssignmentIds: [looseId],
      },
      ROLE_DAY,
    );
    expect(given.status, JSON.stringify(given.body)).toBe(422);
    expect(errorOf(given)).toMatchObject({
      code: ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT,
      details: [
        { field: 'employeeId', code: 'NOT_A_SPECIALIST', message: looseHeld },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ],
    });
    const after = await board(ROLE_DAY);
    expect(after.vehiclelessRows.map((row) => row.id)).toContain(looseId);
    // Van 2's row (emptied by the cases above) took nobody.
    expect(vanRow(after, van2)?.crew?.specialist1EmployeeIds ?? []).toEqual([]);
    expect(vanRow(after, van2)?.crew?.notes ?? null).toBeNull();

    await saved({ rows: [], removeCrewAssignmentIds: [looseId] }, ROLE_DAY);
  });

  it('reads «متطلبات الطاقم» ONCE for everybody the save puts on a row', async () => {
    const read = vi.spyOn(operationsCrewRequirementsRepository, 'findByEmployees');
    try {
      await saved(
        {
          rows: [
            { vehicleId: van2, captainEmployeeIds: [onlyCaptain], specialist1EmployeeIds: [rowless] },
            { vehicleId: van3, captainEmployeeIds: [both], specialist2EmployeeIds: [onlySpecialist] },
          ],
        },
        ROLE_DAY,
      );
      expect(read).toHaveBeenCalledTimes(1);
      expect([...(read.mock.calls[0]?.[0] ?? [])].sort()).toEqual(
        [onlyCaptain, rowless, both, onlySpecialist].sort(),
      );
    } finally {
      read.mockRestore();
    }
    await saved({ rows: [{ vehicleId: van2 }, { vehicleId: van3 }] }, ROLE_DAY);
  });
});

// ── Round 24 ────────────────────────────────────────────────────────────────────────────────────
//
// «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات و مكان بدون سيارة دا لما ادوس عليه يجيب
// كل السيارات اللى مش عليها طاقم واقدر اختار منهم». The board side: `freeVehicles` (every active car
// with no crew that day), a van the roster does not have saved and listed, a saved row GIVEN a van
// in place, and the refusals. The محصنات side (legs following the row, a row holding محصنات not
// removed) is pinned in operations-distribution.spec.ts, where the shipments are.
describe('Round 24 — «بدون سيارة» offers every car without a crew, and a row takes any of them', () => {
  /** No Fleet roster at all — production's usual day. */
  const BARE = shift(100);
  /** A roster of van 1 (two drivers) and van 2. */
  const ROSTERED = shift(101);
  let cashCar = ''; // OPS-P9 — a vehicle of the cash-transfer operation (the setting)
  let otherCar = ''; // OPS-P10 — nobody's: no roster, no standing crew, no operation
  let parkedCar = ''; // OPS-P7 — out of service
  let goneCar = ''; // OPS-P8 — deleted
  let specialistOnly = ''; // ticked nothing — a specialist, never a captain

  const orgCtx = (): AuthContext => ({
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  });
  const setCashOperations = (value: string[]) =>
    settingsService.set(orgCtx(), {
      key: OperationsSettingKeys.CashTransferOperationIds,
      scope: 'organization',
      value,
    });
  const free = (dto: OperationsCrewBoardDto) =>
    dto.freeVehicles.map((car) => [car.vehicleCode, car.group]);

  beforeAll(async () => {
    cashCar = await mkVehicle('OPS-P9');
    otherCar = await mkVehicle('OPS-P10');
    parkedCar = await mkVehicle('OPS-P7');
    goneCar = await mkVehicle('OPS-P8');
    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(parkedCar) },
      { $set: { status: 'outOfService' } },
    );
    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(goneCar) },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    );
    // «نقل أموال» — the Fleet operation the setting names; OPS-P9 runs it.
    const operation = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'operation', name: { ar: 'نقل أموال الجولة 24', en: 'Cash transfer R24' } });
    expect(operation.status, JSON.stringify(operation.body)).toBe(201);
    const operationId = data<{ id: string }>(operation).id;
    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(cashCar) },
      { $set: { operationId: new Types.ObjectId(operationId) } },
    );
    await setCashOperations([operationId]);

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: ROSTERED,
        rows: [
          { vehicleId: van1, driver1EmployeeId: drv1, driver2EmployeeId: drv2, notes: 'r24' },
          { vehicleId: van2, notes: 'r24' },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    specialistOnly = await mkEmployee('أخصائي الجولة الرابعة والعشرين');
  });

  afterAll(async () => {
    await setCashOperations([]);
  });

  it('lists EVERY active car with no crew — the cash-transfer ones, the standing crew’s, then the rest', async () => {
    const dto = await board(BARE);
    // No roster, no crew row: nothing on the roster, the setting's car first, the standing crew's
    // next, everything else after — each by code, numbers in number order («P9» before «P10»).
    // Never one out of service (P7) or deleted (P8).
    expect(free(dto)).toEqual([
      ['OPS-P9', 'cashTransfer'],
      ['OPS-P4', 'standing'],
      ['OPS-P6', 'standing'],
      ['OPS-P1', 'other'],
      ['OPS-P2', 'other'],
      ['OPS-P3', 'other'],
      ['OPS-P5', 'other'],
      ['OPS-P10', 'other'],
    ]);
    const byCar = new Map(dto.freeVehicles.map((car) => [car.vehicleId, car]));
    // The workshop that day says so — the save refuses those (below), the list still shows them.
    expect(byCar.get(van4)).toMatchObject({ onRoster: false, inWorkshop: true, drivers: [] });
    expect(byCar.get(van5)?.inWorkshop).toBe(true);
    expect(byCar.get(otherCar)).toMatchObject({ onRoster: false, inWorkshop: false });
    expect(dto.rows).toEqual([]);
  });

  it('puts the roster’s vans first, with their drivers by name — and leaves out a van a row holds', async () => {
    const dto = await board(ROSTERED);
    expect(free(dto).slice(0, 3)).toEqual([
      ['OPS-P1', 'roster'],
      ['OPS-P2', 'roster'],
      ['OPS-P9', 'cashTransfer'],
    ]);
    expect(dto.freeVehicles[0]).toMatchObject({
      vehicleId: van1,
      onRoster: true,
      drivers: [
        { employeeId: drv1, fullNameAr: 'سائق التشغيلة الأول' },
        { employeeId: drv2, fullNameAr: 'سائق التشغيلة الثاني' },
      ],
    });
    const planned = await saved({ rows: [{ vehicleId: van1, captainEmployeeIds: [cap1] }] }, ROSTERED);
    expect(planned.freeVehicles.map((car) => car.vehicleId)).not.toContain(van1);
    // Emptied to NOTHING (no people, no field) and holding no leg, a roster van has no crew again.
    const emptied = await saved({ rows: [{ vehicleId: van1 }] }, ROSTERED);
    expect(vanRow(emptied, van1)?.crew).not.toBeNull();
    expect(emptied.freeVehicles[0]).toMatchObject({ vehicleId: van1, group: 'roster' });
  });

  it('saves a van the roster does NOT have, and lists it as a van row with no roster row', async () => {
    const res = await saved({ rows: [{ vehicleId: otherCar, captainEmployeeIds: [cap1] }] }, BARE);
    expect(res.changedCount).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      vehicleId: otherCar,
      vehicleCode: 'OPS-P10',
      fleetDutyAssignmentId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      drivers: [],
      missionTypeId: null,
    });
    expect(res.rows[0]?.crew?.captainEmployeeIds).toEqual([cap1]);
    expect(res.freeVehicles.map((car) => car.vehicleId)).not.toContain(otherCar);
    const stored = await OperationsCrewAssignmentModel.findById(res.rows[0]?.crew?.id).lean().exec();
    expect(stored).toMatchObject({ fleetDutyAssignmentId: null });
    expect(String(stored?.vehicleId)).toBe(otherCar);
    // The pool names the van he holds, roster or not.
    const pool = await request(app)
      .get(`/api/v1/operations/crew-board/directory?date=${BARE}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      data<OperationsCrewDirectoryDto>(pool).members.find((m) => m.employeeId === cap1)
        ?.assignedVehicleId,
    ).toBe(otherCar);
    // A van picked with nothing else on it is still a row — the van IS its content.
    const bare = await saved({ rows: [{ vehicleId: cashCar }] }, BARE);
    expect(vanRow(bare, cashCar)?.fleetDutyAssignmentId).toBeNull();
    await saved({ rows: [], removeCrewAssignmentIds: [vanRow(bare, cashCar)?.crew?.id] }, BARE);
  });

  it('GIVES a saved row without a van a van IN PLACE — the same row, its id kept', async () => {
    const created = await saved(
      { rows: [{ vehicleId: null, captainEmployeeIds: [cap2], specialist1EmployeeIds: [spec2] }] },
      BARE,
    );
    const looseId = created.vehiclelessRows[0]?.id as string;
    const given = await saved(
      {
        rows: [
          {
            vehicleId: cashCar,
            crewAssignmentId: looseId,
            captainEmployeeIds: [cap2],
            specialist1EmployeeIds: [spec2],
          },
        ],
      },
      BARE,
    );
    expect(given.changedCount).toBe(1);
    expect(given.vehiclelessRows).toEqual([]);
    expect(vanRow(given, cashCar)).toMatchObject({ fleetDutyAssignmentId: null, vehicleCode: 'OPS-P9' });
    expect(vanRow(given, cashCar)?.crew).toMatchObject({
      id: looseId,
      captainEmployeeIds: [cap2],
      specialist1EmployeeIds: [spec2],
    });
    const stored = await OperationsCrewAssignmentModel.findById(looseId).lean().exec();
    expect(stored?.isDeleted).toBe(false);
    expect(String(stored?.vehicleId)).toBe(cashCar);
    // Announced with its van now.
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === OperationsEvents.CrewAssignmentChanged &&
          (e.payload as { crewAssignmentId: string; vehicleId: string | null }).crewAssignmentId ===
            looseId &&
          (e.payload as { vehicleId: string | null }).vehicleId === cashCar,
      ),
    );
    // Sent again with the same van, it is that row's plain edit; another van is refused.
    const edited = await saved(
      { rows: [{ vehicleId: cashCar, crewAssignmentId: looseId, captainEmployeeIds: [cap2] }] },
      BARE,
    );
    expect(vanRow(edited, cashCar)?.crew?.specialist1EmployeeIds).toEqual([]);
    const swap = await save(
      { rows: [{ vehicleId: otherCar, crewAssignmentId: looseId, captainEmployeeIds: [cap2] }] },
      BARE,
    );
    expect(swap.status).toBe(422);
    expect(errorOf(swap).code).toBe(ErrorCodes.BUSINESS_RULE_VIOLATION);
  });

  it('gives a roster van whose row was emptied — that empty row released, the roster row anchored', async () => {
    const created = await saved(
      { rows: [{ vehicleId: null, captainEmployeeIds: [cap3], notes: 'r24-roster' }] },
      ROSTERED,
    );
    const looseId = created.vehiclelessRows[0]?.id as string;
    const emptyRowId = vanRow(created, van1)?.crew?.id as string; // emptied in the case above
    expect(emptyRowId).toBeDefined();
    const given = await saved(
      {
        rows: [
          { vehicleId: van1, crewAssignmentId: looseId, captainEmployeeIds: [cap3], notes: 'r24-roster' },
        ],
      },
      ROSTERED,
    );
    expect(vanRow(given, van1)?.crew?.id).toBe(looseId);
    expect(vanRow(given, van1)?.drivers).toHaveLength(2);
    const stored = await OperationsCrewAssignmentModel.findById(looseId).lean().exec();
    expect(String(stored?.fleetDutyAssignmentId)).toBe(vanRow(given, van1)?.fleetDutyAssignmentId);
    expect((await OperationsCrewAssignmentModel.findById(emptyRowId).lean().exec())?.isDeleted).toBe(
      true,
    );
    // A roster van whose row holds somebody is TAKEN.
    const other = await saved({ rows: [{ vehicleId: null, captainEmployeeIds: [cap2] }] }, ROSTERED);
    const otherId = other.vehiclelessRows[0]?.id as string;
    const taken = await save(
      { rows: [{ vehicleId: van1, crewAssignmentId: otherId, captainEmployeeIds: [cap2] }] },
      ROSTERED,
    );
    expect(taken.status, JSON.stringify(taken.body)).toBe(409);
    expect(errorOf(taken)).toMatchObject({
      code: ErrorCodes.OPERATIONS_CREW_VEHICLE_TAKEN,
      details: [
        { field: 'vehicleId', code: 'TAKEN', message: van1 },
        { field: 'crewAssignmentId', code: 'CREW_ROW', message: looseId },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ],
    });
    // A ROSTER van's row is still only emptied, never removed.
    expect((await save({ rows: [], removeCrewAssignmentIds: [looseId] }, ROSTERED)).status).toBe(422);
  });

  it('refuses a van in the workshop, one out of service or deleted, and one another row holds', async () => {
    const before = await board(BARE);
    const workshop = await save({ rows: [{ vehicleId: van4, captainEmployeeIds: [cap3] }] }, BARE);
    expect(workshop.status, JSON.stringify(workshop.body)).toBe(422);
    expect(errorOf(workshop)).toMatchObject({
      code: ErrorCodes.OPERATIONS_CREW_VEHICLE_IN_WORKSHOP,
      details: [
        { field: 'vehicleId', code: 'IN_WORKSHOP', message: van4 },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ],
    });
    for (const car of [parkedCar, goneCar, new Types.ObjectId().toString()]) {
      const res = await save({ rows: [{ vehicleId: car, captainEmployeeIds: [cap3] }] }, BARE);
      expect(res.status, car).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ErrorCodes.OPERATIONS_CREW_VEHICLE_NOT_ACTIVE,
        details: [
          { field: 'vehicleId', code: 'NOT_ACTIVE', message: car },
          { field: 'rows', code: 'ROW_INDEX', message: '0' },
        ],
      });
    }
    // OPS-P10 is held (the case above): a row given it is refused, naming the row that holds it…
    const holderId = vanRow(before, otherCar)?.crew?.id as string;
    const loose = await saved({ rows: [{ vehicleId: null, captainEmployeeIds: [cap3] }] }, BARE);
    const looseId = loose.vehiclelessRows[0]?.id as string;
    const taken = await save(
      { rows: [{ vehicleId: otherCar, crewAssignmentId: looseId, captainEmployeeIds: [cap3] }] },
      BARE,
    );
    expect(taken.status).toBe(409);
    expect(errorOf(taken).details?.[1]).toEqual({
      field: 'crewAssignmentId',
      code: 'CREW_ROW',
      message: holderId,
    });
    // …and taken, once that row is removed in the same save (off the roster, it may be).
    const freed = await saved(
      {
        rows: [{ vehicleId: otherCar, crewAssignmentId: looseId, captainEmployeeIds: [cap3] }],
        removeCrewAssignmentIds: [holderId],
      },
      BARE,
    );
    expect(vanRow(freed, otherCar)?.crew?.id).toBe(looseId);
    expect((await OperationsCrewAssignmentModel.findById(holderId).lean().exec())?.isDeleted).toBe(
      true,
    );
    // Nothing of the refused saves was written.
    expect(vanRow(freed, van4)).toBeUndefined();
  });

  it('refuses a NEW row given a van off the roster that another desk crewed since — that desk’s row is never overwritten', async () => {
    // Two desks on one day. Desk A reads the board: OPS-P10 has no crew and «بدون سيارة» offers it.
    const TWO_DESKS = shift(102);
    expect((await board(TWO_DESKS)).freeVehicles.map((car) => car.vehicleId)).toContain(otherCar);
    // Desk B crews OPS-P10 first — a new row, by the van alone.
    const byB = await saved(
      { rows: [{ vehicleId: otherCar, captainEmployeeIds: [cap1], notes: 'desk B' }] },
      TWO_DESKS,
    );
    const rowB = vanRow(byB, otherCar)?.crew?.id as string;
    expect(rowB).toBeDefined();
    // Desk A, still on its read, saves its new row with OPS-P10: no row id, it knows of none. Off
    // the roster that is a NEW row, never «the van's row» — refused, naming the row that holds it.
    const byA = await save(
      { rows: [{ vehicleId: otherCar, captainEmployeeIds: [cap2], notes: 'desk A' }] },
      TWO_DESKS,
    );
    expect(byA.status, JSON.stringify(byA.body)).toBe(409);
    expect(errorOf(byA)).toMatchObject({
      code: ErrorCodes.OPERATIONS_CREW_VEHICLE_TAKEN,
      details: [
        { field: 'vehicleId', code: 'TAKEN', message: otherCar },
        { field: 'crewAssignmentId', code: 'CREW_ROW', message: rowB },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ],
    });
    // B's row is exactly as B saved it — the same id, B's captain, B's note.
    const after = await board(TWO_DESKS);
    expect(vanRow(after, otherCar)?.crew).toMatchObject({
      id: rowB,
      captainEmployeeIds: [cap1],
      notes: 'desk B',
    });
    expect(after.rows).toHaveLength(1);
    // B's own edits name the row (the board always names a saved row) and go through…
    const edited = await saved(
      {
        rows: [
          { vehicleId: otherCar, crewAssignmentId: rowB, captainEmployeeIds: [cap1], notes: 'B2' },
        ],
      },
      TWO_DESKS,
    );
    expect(vanRow(edited, otherCar)?.crew).toMatchObject({ id: rowB, notes: 'B2' });
    // …and a new row takes the van once B's row is removed in the same save (off the roster, it may be).
    const moved = await saved(
      {
        rows: [{ vehicleId: otherCar, captainEmployeeIds: [cap2], notes: 'desk A' }],
        removeCrewAssignmentIds: [rowB],
      },
      TWO_DESKS,
    );
    expect(vanRow(moved, otherCar)?.crew).toMatchObject({ captainEmployeeIds: [cap2] });
    expect(vanRow(moved, otherCar)?.crew?.id).not.toBe(rowB);
  });

  it('counts a row GIVEN a van as new seats — the round-23 slot rule judges its people again', async () => {
    // A specialist held in the captain's slot of a row without a van (seated before the rule).
    const created = await saved({ rows: [{ vehicleId: null, notes: 'r24-held' }] }, BARE);
    const heldId = created.vehiclelessRows.find((row) => row.notes === 'r24-held')?.id as string;
    await OperationsCrewAssignmentModel.updateOne(
      { _id: heldId },
      { $set: { captainEmployeeIds: [new Types.ObjectId(specialistOnly)] } },
    ).exec();
    // Its own edits keep the held seat…
    const edited = await save(
      {
        rows: [
          {
            vehicleId: null,
            crewAssignmentId: heldId,
            captainEmployeeIds: [specialistOnly],
            notes: 'r24-held',
            rowColour: 'sky',
          },
        ],
      },
      BARE,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    // …given a van, he is put on it anew, and refused.
    const onDay = await save(
      {
        rows: [
          {
            vehicleId: van3,
            crewAssignmentId: heldId,
            captainEmployeeIds: [specialistOnly],
            notes: 'r24-held',
          },
        ],
      },
      BARE,
    );
    expect(onDay.status, JSON.stringify(onDay.body)).toBe(422);
    expect(errorOf(onDay)).toMatchObject({
      code: ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT,
      details: [
        { field: 'employeeId', code: 'NOT_A_CAPTAIN', message: specialistOnly },
        { field: 'rows', code: 'ROW_INDEX', message: '0' },
      ],
    });
    expect((await board(BARE)).vehiclelessRows.map((row) => row.id)).toContain(heldId);
  });
});

// Round 34 C — «والشاشة بتاعت لوحة التشغيلة عاوز اقدر بعد ما اضيف لون اقدر اشيله عادي … انا عاوز ان انا
// ممكن اضيف محصنة بس الصف بتاعها ما يكونش ملون عادي», then «ما انا عاوز مش لازم نوع يكون واخد اجبارى
// لون فاهم ولو انا مثبت لون للنوع ممكن لو تندى صف اشيل لونه عادى». A type may have NO colour, and a row
// may be «بدون لون» (`rowColour: 'none'`) over its type's — while null stays «لون النوع», so every row
// saved before keeps wearing its type's colour. Its own day, with its own roster.
describe('Round 34 C — colours are optional: a type without one, a row «بدون لون»', () => {
  const R34 = shift(130);
  const patchType = (id: string, body: Record<string, unknown>): request.Test =>
    request(app)
      .patch(`/api/v1/operations/shift-types/${id}`)
      .set('Authorization', `Bearer ${catalogToken}`)
      .send(body);
  const crewOf = (dto: OperationsCrewBoardDto, vehicleId: string) => vanRow(dto, vehicleId)?.crew;
  const secured = async (): Promise<OperationsShiftTypeDto> => typeNamed('محصنة');

  beforeAll(async () => {
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: R34,
        rows: [
          { vehicleId: van1, notes: 'r34c' },
          { vehicleId: van2, notes: 'r34c' },
          { vehicleId: van3, notes: 'r34c' },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
  });

  it('a type may be added with no colour, and a colour once given can be taken off and given back', async () => {
    const before = await types();
    // Left out on create is none; null is none too.
    const bare = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'بلا لون', nameEn: 'Uncoloured' });
    expect(bare.status, JSON.stringify(bare.body)).toBe(201);
    const bareDto = data<OperationsShiftTypeDto>(bare);
    expect(bareDto).toMatchObject({ name: 'بلا لون', colour: null, isActive: true });
    expect((await OperationsShiftTypeModel.findById(bareDto.id).lean().exec())?.colour).toBeNull();
    const nulled = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'بلا لون ٢', colour: null });
    expect(nulled.status, JSON.stringify(nulled.body)).toBe(201);
    expect(data<OperationsShiftTypeDto>(nulled).colour).toBeNull();

    // «محصنة» wears slate since the seed; the owner takes it off…
    const type = await secured();
    expect(type.colour).toBe('slate');
    const off = await patchType(type.id, { colour: null, version: type.version });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(data<OperationsShiftTypeDto>(off)).toMatchObject({ colour: null });
    expect((await secured()).colour).toBeNull();
    // …a rename without `colour` leaves it as it is (none), never brings one back…
    const renamed = await patchType(type.id, {
      nameEn: 'Secured',
      version: data<OperationsShiftTypeDto>(off).version,
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(data<OperationsShiftTypeDto>(renamed).colour).toBeNull();
    // …and gives it back. `none` is the row's word, never a type's: refused, nothing written.
    expect(
      (
        await patchType(type.id, {
          colour: 'none',
          version: data<OperationsShiftTypeDto>(renamed).version,
        })
      ).status,
    ).toBe(400);
    const back = await patchType(type.id, {
      colour: 'slate',
      version: data<OperationsShiftTypeDto>(renamed).version,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await secured()).colour).toBe('slate');

    // No migration: every type that had a colour still has it.
    const after = await types();
    for (const was of before) {
      expect(after.find((one) => one.id === was.id)?.colour, was.name).toBe(was.colour);
    }
    // Tidy: the two are archived (no delete), so the cases below meet the catalog as it was.
    for (const res of [bare, nulled]) {
      const dto = data<OperationsShiftTypeDto>(res);
      expect((await patchType(dto.id, { isActive: false, version: dto.version })).status).toBe(200);
    }
  });

  it('a row «بدون لون» is saved and read as `none` — beside a row of the same type that keeps «لون النوع» (null)', async () => {
    const type = await secured();
    const res = await saved(
      {
        rows: [
          {
            vehicleId: van1,
            captainEmployeeIds: [cap1],
            specialist1EmployeeIds: [spec1],
            shiftTypeId: type.id,
            rowColour: 'none',
          },
          { vehicleId: van2, captainEmployeeIds: [cap2], shiftTypeId: type.id, rowColour: null },
          { vehicleId: van3, captainEmployeeIds: [cap3], shiftTypeId: type.id, rowColour: 'navy' },
        ],
      },
      R34,
    );
    expect(res.changedCount).toBe(3);
    expect(crewOf(res, van1)).toMatchObject({ shiftTypeId: type.id, rowColour: 'none' });
    expect(crewOf(res, van2)).toMatchObject({ shiftTypeId: type.id, rowColour: null });
    expect(crewOf(res, van3)).toMatchObject({ shiftTypeId: type.id, rowColour: 'navy' });
    // Stored as written: `none`, never folded into null (which would hand the type's colour back).
    const stored = await OperationsCrewAssignmentModel.findById(crewOf(res, van1)?.id)
      .lean()
      .exec();
    expect(stored?.rowColour).toBe('none');
    // Read again from scratch: the same three states.
    const read = await board(R34);
    expect([van1, van2, van3].map((van) => crewOf(read, van)?.rowColour)).toEqual([
      'none',
      null,
      'navy',
    ]);

    // The same row sent again is a no-op — `none` compares as itself.
    const row1 = (rowColour: unknown) => ({
      vehicleId: van1,
      captainEmployeeIds: [cap1],
      specialist1EmployeeIds: [spec1],
      shiftTypeId: type.id,
      rowColour,
    });
    expect((await saved({ rows: [row1('none')] }, R34)).changedCount).toBe(0);
    // A colour once added can be taken off again, either way: to «لون النوع» or to «بدون لون».
    const auto = await saved({ rows: [row1(null)] }, R34);
    expect(auto.changedCount).toBe(1);
    expect(crewOf(auto, van1)?.rowColour).toBeNull();
    const painted = await saved({ rows: [row1('crimson')] }, R34);
    expect(crewOf(painted, van1)?.rowColour).toBe('crimson');
    const none = await saved({ rows: [row1('none')] }, R34);
    expect(crewOf(none, van1)?.rowColour).toBe('none');
    // Anything else is still refused, nothing written.
    for (const wrong of ['None', 'transparent', '']) {
      const bad = await save({ rows: [row1(wrong)] }, R34);
      expect(bad.status, wrong).toBe(400);
    }
    expect(crewOf(await board(R34), van1)?.rowColour).toBe('none');
  });

  it('a row with nothing but «بدون لون» is still a row, as a row with only a colour is', async () => {
    const res = await saved({ rows: [{ vehicleId: null, rowColour: 'none', notes: 'r34c' }] }, R34);
    const row = res.vehiclelessRows.find((one) => one.notes === 'r34c');
    expect(row?.rowColour).toBe('none');
    const id = row?.id as string;
    const bare = await saved(
      { rows: [{ vehicleId: null, crewAssignmentId: id, rowColour: 'none' }] },
      R34,
    );
    expect(bare.vehiclelessRows.find((one) => one.id === id)?.rowColour).toBe('none');
    // Removed, so the cases below meet only the vans.
    await saved({ rows: [], removeCrewAssignmentIds: [id] }, R34);
  });

  it('old rows keep wearing their type: a row saved with null, or written before Round 20 with no field at all, reads null', async () => {
    const type = await secured();
    const vanRowNow = crewOf(await board(R34), van2);
    expect(vanRowNow?.rowColour).toBeNull();
    // Its type still has its colour — null is «لون النوع», the board draws the row in slate.
    expect(type.colour).toBe('slate');
    // A row from before Round 20 has no `rowColour` field at all: read as null too.
    await OperationsCrewAssignmentModel.collection.updateOne(
      { _id: new Types.ObjectId(vanRowNow?.id) },
      { $unset: { rowColour: '' } },
    );
    expect(
      (
        await OperationsCrewAssignmentModel.collection.findOne({
          _id: new Types.ObjectId(vanRowNow?.id),
        })
      )?.rowColour,
    ).toBeUndefined();
    expect(crewOf(await board(R34), van2)?.rowColour).toBeNull();
  });

  it('a type with no colour: its rows read as they are saved — null, `none` or a colour of their own', async () => {
    const type = await secured();
    const off = await patchType(type.id, { colour: null, version: type.version });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const read = await board(R34);
    expect([van1, van2, van3].map((van) => crewOf(read, van)?.rowColour)).toEqual([
      'none',
      null,
      'navy',
    ]);
    expect([van1, van2, van3].every((van) => crewOf(read, van)?.shiftTypeId === type.id)).toBe(
      true,
    );
    // A row newly given the uncoloured type is saved like any other.
    const loose = await saved(
      { rows: [{ vehicleId: null, shiftTypeId: type.id, notes: 'r34c-bare' }] },
      R34,
    );
    const row = loose.vehiclelessRows.find((one) => one.notes === 'r34c-bare');
    expect(row).toMatchObject({ shiftTypeId: type.id, rowColour: null });
    await saved({ rows: [], removeCrewAssignmentIds: [row?.id as string] }, R34);
    const back = await patchType(type.id, {
      colour: 'slate',
      version: data<OperationsShiftTypeDto>(off).version,
    });
    expect(back.status).toBe(200);
  });

  it('«تحميل الطاقم الثابت» onto a row «بدون لون» keeps it: the standing crew holds no colour, the row its own', async () => {
    const standing = await request(app)
      .put('/api/v1/operations/standing-crew')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        rows: [
          {
            vehicleId: van2,
            captainEmployeeIds: [cap2],
            specialist1EmployeeIds: [spec2],
            direction: 'المعادي',
          },
        ],
      });
    expect(standing.status, JSON.stringify(standing.body)).toBe(200);
    const read = await request(app)
      .get('/api/v1/operations/standing-crew')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.status).toBe(200);
    const template = data<{ rows: Record<string, unknown>[] }>(read).rows.find(
      (row) => row.vehicleId === van2,
    );
    // The template has no type and no colour to give: what the day row holds is the day row's.
    expect(template).toBeDefined();
    expect(template).not.toHaveProperty('rowColour');
    expect(template).not.toHaveProperty('shiftTypeId');

    const type = await secured();
    // The day's row of van 2 is set «بدون لون», with its type, and nobody on it yet…
    const empty = await saved(
      { rows: [{ vehicleId: van2, shiftTypeId: type.id, rowColour: 'none' }] },
      R34,
    );
    expect(crewOf(empty, van2)).toMatchObject({ rowColour: 'none', captainEmployeeIds: [] });
    // …then filled from the standing crew, as the board's load sends it: the template's people and
    // direction, the row's own type and colour.
    const loaded = await saved(
      {
        rows: [
          {
            vehicleId: van2,
            captainEmployeeIds: template?.captainEmployeeIds,
            specialist1EmployeeIds: template?.specialist1EmployeeIds,
            direction: template?.direction,
            shiftTypeId: type.id,
            rowColour: 'none',
          },
        ],
      },
      R34,
    );
    expect(crewOf(loaded, van2)).toMatchObject({
      captainEmployeeIds: [cap2],
      specialist1EmployeeIds: [spec2],
      direction: 'المعادي',
      shiftTypeId: type.id,
      rowColour: 'none',
    });
    expect(crewOf(await board(R34), van2)?.rowColour).toBe('none');
  });
});

// Round 34 F — «و اسمحلى برضو ان ممكن عملية تكون من غير لون مش لازم ان يومى او محصنة تبقى واخده لون
// اجبارى». No colour is ever put back on a type that has none: not by the boot (the module's seed —
// the grants, the data migrations, the legacy nine), not by an edit that leaves `colour` out, not by
// an archive and a restore, not by the catalog's order, not by a crew save. «يومي» and «محصنة» — two of
// the nine the boot seeded with a colour — taken off, the first as «ألوان الأنواع» sends it, the second
// as the catalog's form does.
describe('Round 34 F — no type is forced to wear a colour: «يومي» and «محصنة» stay bare across a boot', () => {
  const R34F = shift(131);
  const patchType = (id: string, body: Record<string, unknown>): request.Test =>
    request(app)
      .patch(`/api/v1/operations/shift-types/${id}`)
      .set('Authorization', `Bearer ${catalogToken}`)
      .send(body);
  const stored = async (id: string) =>
    (await OperationsShiftTypeModel.findById(id).lean().exec())?.colour;

  beforeAll(async () => {
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: R34F,
        rows: [
          { vehicleId: van1, notes: 'r34f' },
          { vehicleId: van2, notes: 'r34f' },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
  });

  it('taken off, they stay off — through the boot, an edit that leaves the colour out, an archive and back, the order and a save', async () => {
    const before = await types();
    const daily = await typeNamed('يومي');
    const secured = await typeNamed('محصنة');
    // The boot seeded both with a colour.
    expect(daily.colour).toBe('rose');
    expect(secured.colour).toBe('slate');

    // «ألوان الأنواع»: `{ colour: null, version }`.
    const dailyOff = await patchType(daily.id, { colour: null, version: daily.version });
    expect(dailyOff.status, JSON.stringify(dailyOff.body)).toBe(200);
    // The catalog's form: the whole type, `colour: null`.
    const securedOff = await patchType(secured.id, {
      name: secured.name,
      nameEn: secured.nameEn,
      colour: null,
      version: secured.version,
    });
    expect(securedOff.status, JSON.stringify(securedOff.body)).toBe(200);
    expect(await stored(daily.id)).toBeNull();
    expect(await stored(secured.id)).toBeNull();

    // THE BOOT: Operations' own step, exactly as `bootPlatform` runs it — twice (the api and the
    // worker). The legacy nine are keyed and `$setOnInsert`: nothing inserted, nothing recoloured.
    const operations = moduleManifests.find((manifest) => manifest.id === 'operations');
    expect(operations?.seed).toBeDefined();
    await operations?.seed?.();
    await operations?.seed?.();
    expect(await seedOperationsShiftTypes()).toEqual({ inserted: 0, skipped: [] });
    expect(await stored(daily.id)).toBeNull();
    expect(await stored(secured.id)).toBeNull();
    const booted = await types();
    expect(booted.find((type) => type.id === daily.id)?.colour).toBeNull();
    expect(booted.find((type) => type.id === secured.id)?.colour).toBeNull();
    // Every other type keeps the colour it had.
    for (const was of before) {
      if (was.id === daily.id || was.id === secured.id) continue;
      expect(booted.find((type) => type.id === was.id)?.colour, was.name).toBe(was.colour);
    }

    // An edit that leaves `colour` out leaves it none; so do an archive and a restore.
    let version = data<OperationsShiftTypeDto>(dailyOff).version;
    const renamed = await patchType(daily.id, { nameEn: 'Daily run', version });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(data<OperationsShiftTypeDto>(renamed).colour).toBeNull();
    version = data<OperationsShiftTypeDto>(renamed).version;
    const archived = await patchType(daily.id, { isActive: false, version });
    expect(data<OperationsShiftTypeDto>(archived).colour).toBeNull();
    const restored = await patchType(daily.id, {
      isActive: true,
      nameEn: 'Daily',
      version: data<OperationsShiftTypeDto>(archived).version,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(data<OperationsShiftTypeDto>(restored).colour).toBeNull();

    // The catalog's order, turned round and put back: no colour comes with it.
    const order = (await types()).map((type) => type.id);
    for (const ids of [[...order].reverse(), order]) {
      const put = await request(app)
        .put('/api/v1/operations/shift-types/order')
        .set('Authorization', `Bearer ${catalogToken}`)
        .send({ ids });
      expect(put.status, JSON.stringify(put.body)).toBe(204);
    }
    expect(await stored(daily.id)).toBeNull();
    expect(await stored(secured.id)).toBeNull();

    // A day of rows of both, «لون النوع» kept (null): saved and read with no colour of their own, and
    // their types with none — so the board draws them plain.
    const day = await saved(
      {
        rows: [
          { vehicleId: van1, captainEmployeeIds: [cap1], shiftTypeId: daily.id, rowColour: null },
          { vehicleId: van2, captainEmployeeIds: [cap2], shiftTypeId: secured.id, rowColour: null },
        ],
      },
      R34F,
    );
    expect(day.changedCount).toBe(2);
    const read = await board(R34F);
    expect(vanRow(read, van1)?.crew).toMatchObject({ shiftTypeId: daily.id, rowColour: null });
    expect(vanRow(read, van2)?.crew).toMatchObject({ shiftTypeId: secured.id, rowColour: null });
    await operations?.seed?.();
    const after = await types();
    expect(after.find((type) => type.id === daily.id)?.colour).toBeNull();
    expect(after.find((type) => type.id === secured.id)?.colour).toBeNull();

    // A NEW type left without a colour has none; an older client that still sends one keeps it.
    const bare = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'نوع بلا لون', nameEn: 'No colour yet' });
    expect(bare.status, JSON.stringify(bare.body)).toBe(201);
    expect(data<OperationsShiftTypeDto>(bare).colour).toBeNull();
    expect(await stored(data<OperationsShiftTypeDto>(bare).id)).toBeNull();
    const older = await request(app)
      .post('/api/v1/operations/shift-types')
      .set('Authorization', `Bearer ${catalogToken}`)
      .send({ name: 'نوع بلون', colour: 'plum' });
    expect(older.status, JSON.stringify(older.body)).toBe(201);
    expect(data<OperationsShiftTypeDto>(older).colour).toBe('plum');
    await operations?.seed?.();
    expect(await stored(data<OperationsShiftTypeDto>(bare).id)).toBeNull();

    // Tidy: the two new ones archived, the two seeded ones given their colours back by hand.
    for (const res of [bare, older]) {
      const dto = data<OperationsShiftTypeDto>(res);
      expect((await patchType(dto.id, { isActive: false, version: dto.version })).status).toBe(200);
    }
    for (const [id, colour] of [
      [daily.id, 'rose'],
      [secured.id, 'slate'],
    ] as const) {
      const now = (await types()).find((type) => type.id === id) as OperationsShiftTypeDto;
      expect((await patchType(id, { colour, version: now.version })).status).toBe(200);
    }
  });
});
