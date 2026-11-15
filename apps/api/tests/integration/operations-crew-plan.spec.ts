// Round 20 — «لوحة التشغيلة» as the owner approved it, over real HTTP, real RBAC and a real database.
//
//   · «أنواع التشغيل»: «انا عاوز النوع يكون بيضاف من البيانات المرجعيه» — the board's «النوع» is a
//     catalog on the reference-data screen, seeded once with the legacy nine, dragged into order.
//   · The row's type and colour: «وعاوز زرا يبقى فى كذا لون اقدر الون به الصف».
//   · Rows without a van: «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات برضو» — created,
//     edited, deleted and given a van, Q11 counting them, `ux_day_vehicle` partial on a present van.
//   · «الاتجاه» from the areas: «الاتجاه اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده».
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
  OperationsEvents,
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
import { seedOperationsShiftTypes } from '../../src/modules/operations/shift-types/shift-type.service';
import { migrateCrewAssignmentIndexes } from '../../src/modules/operations/operations.migration';
import { operationsCrewRequirementsRepository } from '../../src/modules/operations/crew/crew-requirements.repository';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
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
          rowColour: 'yellow',
        },
      ],
    });
    expect(first.changedCount).toBe(1);
    expect(vanRow(first, van1)?.crew).toMatchObject({ shiftTypeId: daily.id, rowColour: 'yellow' });

    const recoloured = await saved({
      rows: [
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: daily.id,
          rowColour: 'green',
        },
      ],
    });
    expect(recoloured.changedCount).toBe(1);
    expect(vanRow(recoloured, van1)?.crew?.rowColour).toBe('green');

    const again = await saved({
      rows: [
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: daily.id,
          rowColour: 'green',
        },
      ],
    });
    expect(again.changedCount).toBe(0);
  });

  it('a row with a colour or a type and nothing else is still a row', async () => {
    const res = await saved({ rows: [{ vehicleId: van2, rowColour: 'blue' }] });
    expect(vanRow(res, van2)?.crew).toMatchObject({ rowColour: 'blue', shiftTypeId: null });
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
      rowColour: 'blue',
      shiftTypeId: null,
    });
  });

  it('keeps a type the row already holds when it is archived afterwards', async () => {
    const reserve = await typeNamed('احتياطي');
    await saved({ rows: [{ vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'blue' }] });
    const off = await request(app)
      .patch(`/api/v1/operations/shift-types/${reserve.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: reserve.version });
    expect(off.status).toBe(200);
    // The row is saved again with a note — its archived type rides along untouched.
    const res = await saved({
      rows: [{ vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'blue', notes: 'ملاحظة' }],
    });
    expect(vanRow(res, van2)?.crew).toMatchObject({ shiftTypeId: reserve.id, notes: 'ملاحظة' });
    // …while ANOTHER row newly picking the same archived type is refused, and the refusal names
    // THAT row (index 1), not the one keeping it — the board marks the row it names.
    const picked = await save({
      rows: [
        { vehicleId: van2, shiftTypeId: reserve.id, rowColour: 'blue', notes: 'ملاحظة' },
        {
          vehicleId: van1,
          captainEmployeeIds: [cap1],
          specialist1EmployeeIds: [spec1],
          plannedTime: '07:30',
          shiftTypeId: reserve.id,
          rowColour: 'green',
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
});

describe('«الاتجاه» — picked from the areas, a legacy one kept', () => {
  it('stores the area’s own spelling, and several areas joined', async () => {
    const one = await saved({ rows: [{ vehicleId: van3, direction: 'المعادى' }] });
    expect(vanRow(one, van3)?.crew?.direction).toBe('المعادي');
    const two = await saved({ rows: [{ vehicleId: van3, direction: 'المعادى و حلوان' }] });
    expect(vanRow(two, van3)?.crew?.direction).toBe('المعادي - حلوان');
  });

  it('refuses a new direction that is not an active area — OPERATIONS_DIRECTION_NOT_AN_AREA', async () => {
    const res = await save({ rows: [{ vehicleId: van3, direction: 'المعادي - طريق السويس' }] });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe(ErrorCodes.OPERATIONS_DIRECTION_NOT_AN_AREA);
    expect(errorOf(res).details).toEqual([
      { field: 'direction', code: 'NOT_AN_AREA', message: 'طريق السويس' },
      { field: 'rows', code: 'ROW_INDEX', message: '0' },
    ]);
    // An archived area is no area to pick.
    const archived = await save({ rows: [{ vehicleId: van3, direction: 'الدقي' }] });
    expect(archived.status).toBe(422);
    expect(vanRow(await board(), van3)?.crew?.direction).toBe('المعادي - حلوان');
  });

  it('keeps a direction saved before the rule while it is sent unchanged, and refuses changing it to another', async () => {
    const crewId = vanRow(await board(), van3)?.crew?.id as string;
    // A direction written before Round 20 — free text no area answers.
    await OperationsCrewAssignmentModel.updateOne(
      { _id: crewId },
      { $set: { direction: 'طريق السويس' } },
    ).exec();
    const kept = await saved({
      rows: [{ vehicleId: van3, direction: 'طريق السويس', notes: 'كما هو' }],
    });
    expect(vanRow(kept, van3)?.crew).toMatchObject({ direction: 'طريق السويس', notes: 'كما هو' });
    const changed = await save({ rows: [{ vehicleId: van3, direction: 'طريق الإسماعيلية' }] });
    expect(changed.status).toBe(422);
    // Clearing it is always allowed.
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
          rowColour: 'red',
        },
      ],
    });
    expect(res.changedCount).toBe(1);
    expect(res.vehiclelessRows.find((row) => row.id === looseB)).toMatchObject({
      rowColour: 'red',
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
        { vehicleId: van2, rowColour: 'blue' },
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

  it('is never a van to the readers about vans — the pool, the distribution, a leg, the captain’s day', async () => {
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

    // «توزيع المحصنات» lists the day's VANS only.
    const distribution = await request(app)
      .get(`/api/v1/operations/secured/distribution?date=${DAY}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(distribution.status, JSON.stringify(distribution.body)).toBe(200);
    const vans = data<OperationsSecuredDistributionDto>(distribution).crews;
    expect(vans.map((van) => van.crewAssignmentId)).not.toContain(looseA);
    expect(vans.every((van) => van.vehicleId !== 'null' && van.vehicleCode !== null)).toBe(true);

    // The captain's day: captaincy is "which VEHICLES am I a captain of" — none for cap2.
    const dayRow = (await board()).day;
    expect(
      await operationsCrewAssignmentRepository.findForCaptainDay(dayRow?.id as string, cap2),
    ).toEqual([]);
    expect(await operationsCrewAssignmentRepository.findVanById(looseA)).toBeNull();

    // A leg rides a VAN: booking a shipment onto the row without one answers 404, as for no row.
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
            rowColour: 'green',
          },
        ],
      },
      AWAY_DAY,
    );
    expect(vanRow(edited, van2)?.crew).toMatchObject({
      captainEmployeeIds: [],
      specialist1EmployeeIds: [laterAway],
      plannedTime: '08:15',
      rowColour: 'green',
    });

    // Moved to ANOTHER row, he is being put on it — refused, and the van keeps him.
    const moved = await save(
      {
        rows: [
          { vehicleId: van2, plannedTime: '08:15', rowColour: 'green' },
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
            rowColour: 'green',
          },
        ],
      },
      ROLE_DAY,
    );
    expect(vanRow(edited, van2)?.crew).toMatchObject({
      specialist1EmployeeIds: [reflagged],
      plannedTime: '08:15',
      rowColour: 'green',
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
          { vehicleId: van2, plannedTime: '08:15', rowColour: 'green' },
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
