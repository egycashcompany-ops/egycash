// Vehicle device checks (FR-21) over real HTTP with real RBAC — «I need to create a new form for
// specific users to use on Mobile to inform about the car status»
// (docs/12-planning/it-vehicle-checks-design.md §9, "The integration spec").
//
// What a mocked spec cannot see: the form's one grant standing alone (no Fleet or asset grant
// behind it), Fleet's code order coming through the boundary, the reporter's data scope ignored
// for the car list and for filing, the unique request id answering a repeat and a race, the
// atomic photo update holding five photos and the 24-hour window against racing uploads, and the
// Files category refusing a photo before any byte is stored.
//
// Cars are planted through Fleet's raw collection: that is how a car with no branch gets in, since
// Fleet's schema requires one.
//
// The dashboard (2026-11-10, «تمام نفذا الـ Dashboard بتاعت الفحص») adds what only a real database
// shows: its keys standing apart from the form's, each car's latest report reduced in one
// aggregation (the day first, then the filing), the window's figures, the reader's branch scope
// over both the cars and the reports, the list's filters and order, the photo bytes, and a delete
// leaving every read. Its reports are planted straight into the collection, on cars of a branch of
// their own (C), so every figure is exact whatever the cases above filed.
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  IT_VEHICLE_CHECK_ITEMS,
  SettingKeys,
  addDaysYmd,
  cairoYmd,
  compareFleetVehicleCodes,
  platformPermissions,
  type ItVehicleCheckDashboardDto,
  type ItVehicleCheckDto,
  type ItVehicleOptionDto,
  type PageMeta,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import {
  ItVehicleCheckModel,
  vehicleCheckFileAuthorizer,
} from '../../src/modules/it/vehicle-checks';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FileModel } from '../../src/platform/files/file.model';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let reporterId: string;
let reporterToken: string; // itVehicleCheck.create ONLY, at `own` scope, placed in branch A
let branchReporterToken: string; // the same role at BRANCH scope, placed in branch A
let otherReporterId: string;
let otherReporterToken: string; // the same role, another person
let assetViewerToken: string; // itAsset.view only — no itVehicleCheck.create
let fleetViewerToken: string; // fleetVehicle.view only
let orgViewerToken: string; // itVehicleCheck.view ONLY, organization-wide
let branchViewerToken: string; // itVehicleCheck.view ONLY, at BRANCH scope, placed in branch C
let deleterId: string;
let deleterToken: string; // itVehicleCheck.view + .delete, organization-wide
let branchDeleterToken: string; // the same role at BRANCH scope, placed in branch C
let branchAId: string;
let branchBId: string;
let branchCId: string; // the dashboard's own branch: no car of the form's cases stands in it

/** The planted cars, by code. */
const cars = new Map<string, string>();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-vehicle-checks-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (
  email: string,
  options: {
    branchId?: string | null;
    locale?: 'ar' | 'en';
    firstName?: { ar: string; en: string };
    lastName?: { ar: string; en: string };
  } = {},
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: options.firstName ?? { ar: 'م', en: 'T' },
      lastName: options.lastName ?? { ar: 'م', en: 'T' },
      locale: options.locale ?? 'en',
      organization: {
        branchId: options.branchId ?? null,
        departmentId: null,
        sectionId: null,
        jobTitleId: null,
      },
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
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorCode = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';

/** A car straight into Fleet's collection — the only way in for a car with no branch. */
const plantCar = async (
  code: string,
  options: { branchId: string | null; status?: string; isDeleted?: boolean },
): Promise<string> => {
  const _id = new Types.ObjectId();
  const now = new Date();
  await FleetVehicleModel.collection.insertOne({
    _id,
    code,
    typeId: new Types.ObjectId(),
    plateNumber: `ب ج د ${code}`,
    chassisNumber: `CH-${code}`,
    motorNumber: `MO-${code}`,
    joinedAt: now,
    licenseExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    branchId: options.branchId === null ? null : new Types.ObjectId(options.branchId),
    status: options.status ?? 'active',
    statusReason: null,
    schemaVersion: 1,
    isDeleted: options.isDeleted ?? false,
    deletedAt: options.isDeleted === true ? now : null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  cars.set(code, String(_id));
  return String(_id);
};

const car = (code: string): string => {
  const id = cars.get(code);
  if (id === undefined) throw new Error(`no planted car ${code}`);
  return id;
};

const today = (): string => cairoYmd(new Date());

const PATH = '/api/v1/it/vehicle-checks';

const listCars = (query: string, token = reporterToken) =>
  request(app).get(`${PATH}/vehicles${query}`).set('Authorization', `Bearer ${token}`);

const fileReport = (body: Record<string, unknown>, token = reporterToken) =>
  request(app)
    .post(PATH)
    .set('Authorization', `Bearer ${token}`)
    .send({ checkDate: today(), clientRequestId: randomUUID(), ...body });

/** A report filed by `token` on `code`, answered 201. */
const filed = async (code: string, token = reporterToken): Promise<ItVehicleCheckDto> => {
  const res = await fileReport({ vehicleId: car(code) }, token);
  expect(res.status).toBe(201);
  return data<ItVehicleCheckDto>(res);
};

// A real 1×1 PNG — the server never decodes a photo, but a real one keeps the test honest.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface PhotoPart {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const PHOTO: PhotoPart = { buffer: PNG, filename: 'camera.png', contentType: 'image/png' };

const upload = (
  id: string,
  options: { token?: string; clientPhotoId?: string | null; file?: PhotoPart | null } = {},
) => {
  let req = request(app)
    .post(`${PATH}/${id}/photos`)
    .set('Authorization', `Bearer ${options.token ?? reporterToken}`);
  const clientPhotoId = options.clientPhotoId === undefined ? randomUUID() : options.clientPhotoId;
  if (clientPhotoId !== null) req = req.field('clientPhotoId', clientPhotoId);
  const file = options.file === undefined ? PHOTO : options.file;
  if (file !== null) {
    req = req.attach('file', file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }
  return req;
};

/** The files stored against one report — every one, or only the live ones. */
const filesOf = async (reportId: string, live = false): Promise<{ _id: Types.ObjectId }[]> =>
  FileModel.find({
    'entityRef.moduleId': 'it',
    'entityRef.entityType': 'vehicleCheck',
    'entityRef.entityId': reportId,
    ...(live ? { isDeleted: false } : {}),
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>()
    .exec();

/**
 * A report straight into the collection — any day, any filing time, any branch, any state — so
 * the dashboard's figures are planted exactly. Every device «يعمل» but the `faults`; each photo
 * a link only (the dashboard counts photos, it never reads these bytes).
 */
const plantReport = async (
  code: string,
  options: {
    branchId: string | null;
    checkDate: string;
    createdAt: Date;
    faults?: readonly string[];
    notes?: string;
    photos?: number;
    reporter?: { id: string; name: string };
    isDeleted?: boolean;
  },
): Promise<string> => {
  const _id = new Types.ObjectId();
  const reporter = options.reporter ?? { id: reporterId, name: 'سامح نبيل' };
  await ItVehicleCheckModel.collection.insertOne({
    _id,
    vehicleId: new Types.ObjectId(car(code)),
    vehicleCode: code,
    branchId: options.branchId === null ? null : new Types.ObjectId(options.branchId),
    checkDate: new Date(`${options.checkDate}T00:00:00.000Z`),
    items: Object.fromEntries(
      IT_VEHICLE_CHECK_ITEMS.map((item) => [
        item,
        (options.faults ?? []).includes(item) ? 'notWorking' : 'works',
      ]),
    ),
    ...(options.notes === undefined ? {} : { notes: options.notes }),
    photos: Array.from({ length: options.photos ?? 0 }, () => ({
      clientPhotoId: randomUUID(),
      fileId: new Types.ObjectId(),
      fileName: 'camera.jpg',
      mime: 'image/jpeg',
      size: 1024,
      uploadedAt: options.createdAt,
    })),
    reportedByUserId: new Types.ObjectId(reporter.id),
    reportedByName: reporter.name,
    clientRequestId: randomUUID(),
    schemaVersion: 1,
    isDeleted: options.isDeleted ?? false,
    deletedAt: options.isDeleted === true ? options.createdAt : null,
    deletedBy: null,
    createdBy: new Types.ObjectId(reporter.id),
    updatedBy: null,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    __v: 0,
  });
  return String(_id);
};

/** A dashboard read, as `token`. */
const read = (path: string, token: string) =>
  request(app).get(`${PATH}${path}`).set('Authorization', `Bearer ${token}`);

const remove = (id: string, token: string) =>
  request(app).delete(`${PATH}/${id}`).set('Authorization', `Bearer ${token}`);

/** The dashboard as `token` reads it — answered 200. */
const board = async (
  query: string,
  token = orgViewerToken,
): Promise<ItVehicleCheckDashboardDto> => {
  const res = await read(`/dashboard${query}`, token);
  expect(res.status).toBe(200);
  return data<ItVehicleCheckDashboardDto>(res);
};

/** The ids of one page of the reports list as `token` reads it — answered 200. */
const listed = async (query: string, token = orgViewerToken): Promise<string[]> => {
  const res = await read(query, token);
  expect(res.status).toBe(200);
  return data<ItVehicleCheckDto[]>(res).map((report) => report.id);
};

/** A synthetic context for calling the file authorizer directly. */
const ctxOf = (userId: string, permissions: AuthContext['permissions']): AuthContext => ({
  userId,
  sessionId: 'direct',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('vc-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    ...ctxOf(adminId, { 'setting.edit': 'organization' }),
    sessionId: 'seed',
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('vc-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('93', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('94', 'فرع ب', 'Branch B');

  // The form's role as an admin would build it («نخصصها عادى كدور»): the one key, nothing else.
  const checkerRole = await rbacService.createRole(
    {
      name: { en: 'Vehicle checker', ar: 'فاحص أجهزة السيارات' },
      permissionKeys: ['itVehicleCheck.create'],
    },
    adminId,
  );
  // `own` — the roles screen's default scope, which over cars would be no car at all.
  reporterId = await mkUser('vc-reporter@ecms.local', {
    branchId: branchAId,
    locale: 'ar',
    firstName: { ar: 'سامح', en: 'Sameh' },
    lastName: { ar: 'نبيل', en: 'Nabil' },
  });
  await rbacService.ensureAssignment(reporterId, String(checkerRole._id), 'own');
  reporterToken = await login('vc-reporter@ecms.local');

  const branchReporterId = await mkUser('vc-branch@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(branchReporterId, String(checkerRole._id), 'branch');
  branchReporterToken = await login('vc-branch@ecms.local');

  otherReporterId = await mkUser('vc-other@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(otherReporterId, String(checkerRole._id), 'own');
  otherReporterToken = await login('vc-other@ecms.local');

  const assetViewerRole = await rbacService.createRole(
    { name: { en: 'Asset viewer', ar: 'مطالع الأصول' }, permissionKeys: ['itAsset.view'] },
    adminId,
  );
  const assetViewerId = await mkUser('vc-assets@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(assetViewerId, String(assetViewerRole._id), 'organization');
  assetViewerToken = await login('vc-assets@ecms.local');

  const fleetViewerRole = await rbacService.createRole(
    { name: { en: 'Fleet viewer', ar: 'مطالع السيارات' }, permissionKeys: ['fleetVehicle.view'] },
    adminId,
  );
  const fleetViewerId = await mkUser('vc-fleet@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(fleetViewerId, String(fleetViewerRole._id), 'organization');
  fleetViewerToken = await login('vc-fleet@ecms.local');

  // The dashboard's readers, as an admin would build them: reading alone, and reading with
  // deleting — each organization-wide and branch-scoped in branch C.
  branchCId = await mkBranch('95', 'فرع ج', 'Branch C');
  const viewerRole = await rbacService.createRole(
    {
      name: { en: 'Vehicle checks viewer', ar: 'مطالع فحص أجهزة السيارات' },
      permissionKeys: ['itVehicleCheck.view'],
    },
    adminId,
  );
  const orgViewerId = await mkUser('vc-viewer@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(orgViewerId, String(viewerRole._id), 'organization');
  orgViewerToken = await login('vc-viewer@ecms.local');
  const branchViewerId = await mkUser('vc-viewer-c@ecms.local', { branchId: branchCId });
  await rbacService.ensureAssignment(branchViewerId, String(viewerRole._id), 'branch');
  branchViewerToken = await login('vc-viewer-c@ecms.local');

  const deleterRole = await rbacService.createRole(
    {
      name: { en: 'Vehicle checks keeper', ar: 'مسؤول فحص أجهزة السيارات' },
      permissionKeys: ['itVehicleCheck.view', 'itVehicleCheck.delete'],
    },
    adminId,
  );
  deleterId = await mkUser('vc-deleter@ecms.local', { branchId: branchAId });
  await rbacService.ensureAssignment(deleterId, String(deleterRole._id), 'organization');
  deleterToken = await login('vc-deleter@ecms.local');
  const branchDeleterId = await mkUser('vc-deleter-c@ecms.local', { branchId: branchCId });
  await rbacService.ensureAssignment(branchDeleterId, String(deleterRole._id), 'branch');
  branchDeleterToken = await login('vc-deleter-c@ecms.local');

  // The registry the form offers: active cars on both branches and one with no branch, written in
  // all three of Fleet's groups — and the cars it must NOT offer.
  await plantCar('152', { branchId: branchBId });
  await plantCar('150', { branchId: branchAId });
  await plantCar('1003', { branchId: null });
  await plantCar('كورولا 1', { branchId: branchBId });
  await plantCar('61', { branchId: branchAId });
  await plantCar('9', { branchId: branchAId });
  await plantCar('160', { branchId: branchAId, status: 'outOfService' });
  await plantCar('170', { branchId: branchAId, status: 'disposed' });
  await plantCar('180', { branchId: branchAId, isDeleted: true });
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('grants', () => {
  it('answers 403 on all three routes to a caller without itVehicleCheck.create', async () => {
    const report = await filed('150');
    for (const token of [assetViewerToken, fleetViewerToken]) {
      expect((await listCars('?page=1&pageSize=10', token)).status).toBe(403);
      expect((await fileReport({ vehicleId: car('150') }, token)).status).toBe(403);
      expect((await upload(report.id, { token })).status).toBe(403);
    }
    // Nothing was stored by the refused photo uploads.
    expect(await filesOf(report.id)).toHaveLength(0);
  });
});

describe('the car list', () => {
  const EXPECTED = ['150', '152', '1003', 'كورولا 1', '9', '61'];

  it("offers an own-scoped reporter every active car in Fleet's code order, a page at a time", async () => {
    // The order is Fleet's own rule — the working fleet from 150 up, the cars written in words,
    // then the private cars below 150 — the same one Fleet's own comparator gives.
    expect([...EXPECTED].sort(compareFleetVehicleCodes)).toEqual(EXPECTED);

    const walked: ItVehicleOptionDto[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await listCars(`?page=${page}&pageSize=2`);
      expect(res.status).toBe(200);
      const rows = data<ItVehicleOptionDto[]>(res);
      expect(rows.length).toBeLessThanOrEqual(2);
      walked.push(...rows);
      const meta = (res.body as { meta: PageMeta }).meta;
      expect(meta.totalItems).toBe(EXPECTED.length);
      totalPages = meta.totalPages;
      page += 1;
    } while (page <= totalPages);

    expect(totalPages).toBe(3);
    expect(walked.map((row) => row.code)).toEqual(EXPECTED);
    expect(walked.map((row) => row.id)).toEqual(EXPECTED.map(car));
    // Exactly `{ id, code }` — nothing else of Fleet's registry leaves through IT.
    for (const row of walked) expect(Object.keys(row).sort()).toEqual(['code', 'id']);
  });

  it('leaves out the out-of-service, disposed and deleted cars', async () => {
    const res = await listCars('?page=1&pageSize=100');
    expect(res.status).toBe(200);
    const codes = data<ItVehicleOptionDto[]>(res).map((row) => row.code);
    for (const code of ['160', '170', '180']) expect(codes).not.toContain(code);
  });

  it('refuses a pageSize over 100 (400)', async () => {
    const res = await listCars('?page=1&pageSize=101');
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe(ErrorCodes.VALIDATION_FAILED);
  });
});

describe('filing a report', () => {
  it("lets a branch-scoped reporter file on another branch's car, under that car's code and branch", async () => {
    const res = await fileReport({ vehicleId: car('152') }, branchReporterToken);
    expect(res.status).toBe(201);
    expect(data<ItVehicleCheckDto>(res)).toMatchObject({
      vehicleId: car('152'),
      vehicleCode: '152',
      branchId: branchBId,
    });
  });

  it('files a car with no branch under no branch', async () => {
    const report = await filed('1003');
    expect(report.branchId).toBeNull();
    expect(report.vehicleCode).toBe('1003');
  });

  it('stores a missing item as null, drops a note of spaces, and snapshots the reporter', async () => {
    const res = await fileReport({
      vehicleId: car('9'),
      // Nothing «لا يعمل»: a note of spaces is then no note, and none is needed.
      items: { screen: 'works', camera3: 'works', radio: null },
      notes: '    ',
    });
    expect(res.status).toBe(201);
    const report = data<ItVehicleCheckDto>(res);
    expect(report.items).toEqual({
      screen: 'works',
      camera1: null,
      camera2: null,
      camera3: 'works',
      camera4: null,
      camera5: null,
      camera6: null,
      camera7: null,
      camera8: null,
      dvr: null,
      radio: null,
    });
    expect(report.notes).toBeNull();
    expect(report.photos).toEqual([]);
    expect(report.checkDate).toBe(today());
    expect(report.reportedByUserId).toBe(reporterId);
    expect(report.reportedByName).toBe('سامح نبيل');

    const raw = await ItVehicleCheckModel.collection.findOne({
      _id: new Types.ObjectId(report.id),
    });
    expect(raw).not.toBeNull();
    // STORED as null, every key — not just mapped back to null by the DTO, which fills an absent
    // key the same way and would hide one.
    expect(raw?.items).toStrictEqual({
      screen: 'works',
      camera1: null,
      camera2: null,
      camera3: 'works',
      camera4: null,
      camera5: null,
      camera6: null,
      camera7: null,
      camera8: null,
      dvr: null,
      radio: null,
    });
    expect(raw).not.toHaveProperty('notes');
    expect(raw?.reportedByName).toBe('سامح نبيل');
    expect(String(raw?.createdBy)).toBe(reporterId);
    // The date-only convention: the Cairo day, as that day's UTC midnight.
    expect((raw?.checkDate as Date).toISOString()).toBe(`${today()}T00:00:00.000Z`);

    // A note with words is trimmed and kept.
    const noted = await fileReport({ vehicleId: car('9'), notes: '  الكاميرا 3 مكسورة  ' });
    expect(noted.status).toBe(201);
    expect(data<ItVehicleCheckDto>(noted).notes).toBe('الكاميرا 3 مكسورة');
  });

  it('answers 404 for a missing or deleted car, and 422 for one that is not active', async () => {
    const missing = await fileReport({ vehicleId: String(new Types.ObjectId()) });
    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe(ErrorCodes.NOT_FOUND);

    const deleted = await fileReport({ vehicleId: car('180') });
    expect(deleted.status).toBe(404);
    expect(errorCode(deleted)).toBe(ErrorCodes.NOT_FOUND);

    for (const code of ['160', '170']) {
      const inactive = await fileReport({ vehicleId: car(code) });
      expect(inactive.status).toBe(422);
      expect(errorCode(inactive)).toBe(ErrorCodes.IT_VEHICLE_NOT_ACTIVE);
    }
  });

  it('refuses tomorrow in Cairo (400), and takes today at 00:30 Cairo while UTC is still on yesterday', async () => {
    const tomorrow = await fileReport({
      vehicleId: car('150'),
      checkDate: addDaysYmd(today(), 1),
    });
    expect(tomorrow.status).toBe(400);
    expect(errorCode(tomorrow)).toBe(ErrorCodes.VALIDATION_FAILED);

    // 22:30 UTC on 7 November is 00:30 on 8 November in Cairo (UTC+2 once summer time ends).
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-07T22:30:00.000Z'));
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-07');
      // A fresh login, so the session and its token are minted on the same clock.
      const token = await login('vc-reporter@ecms.local');
      const onToday = await fileReport({ vehicleId: car('150'), checkDate: '2026-11-08' }, token);
      expect(onToday.status).toBe(201);
      expect(data<ItVehicleCheckDto>(onToday).checkDate).toBe('2026-11-08');
      const onTomorrow = await fileReport(
        { vehicleId: car('150'), checkDate: '2026-11-09' },
        token,
      );
      expect(onTomorrow.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an unknown item or answer, and a malformed request id (400)', async () => {
    for (const body of [
      { vehicleId: car('150'), items: { horn: 'works' } },
      { vehicleId: car('150'), items: { screen: 'broken' } },
      { vehicleId: car('150'), clientRequestId: 'not-a-uuid' },
    ]) {
      const res = await fileReport(body);
      expect(res.status).toBe(400);
    }
  });
});

// «كمان عايز الملاحظة إجبارى لو فى حاجة لا تعمل».
describe('a device «لا يعمل» needs a note', () => {
  it('refuses a fault with no note, or a note of spaces (422), and stores nothing', async () => {
    for (const notes of [undefined, '   ']) {
      const clientRequestId = randomUUID();
      const res = await fileReport({
        vehicleId: car('150'),
        clientRequestId,
        items: { screen: 'works', dvr: 'notWorking' },
        ...(notes === undefined ? {} : { notes }),
      });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe(ErrorCodes.IT_VEHICLE_CHECK_NOTES_REQUIRED);
      expect(await ItVehicleCheckModel.countDocuments({ clientRequestId })).toBe(0);
    }
  });

  it('files a fault with its note', async () => {
    const res = await fileReport({
      vehicleId: car('150'),
      items: { dvr: 'notWorking' },
      notes: '  الـ DVR لا يسجّل.  ',
    });
    expect(res.status).toBe(201);
    const report = data<ItVehicleCheckDto>(res);
    expect(report.items.dvr).toBe('notWorking');
    expect(report.notes).toBe('الـ DVR لا يسجّل.');
  });

  it('still answers a repeat of a report filed before the rule (200), note or none', async () => {
    const filedBefore = await filed('150');
    // As a report filed before the rule was: a fault and no note, written straight to the store.
    await ItVehicleCheckModel.collection.updateOne(
      { _id: new Types.ObjectId(filedBefore.id) },
      { $set: { 'items.camera1': 'notWorking' }, $unset: { notes: '' } },
    );
    const again = await fileReport({
      vehicleId: car('150'),
      clientRequestId: filedBefore.clientRequestId,
      items: { camera1: 'notWorking' },
    });
    expect(again.status).toBe(200);
    expect(data<ItVehicleCheckDto>(again).id).toBe(filedBefore.id);
  });
});

describe('a repeated send', () => {
  it('answers 200 with the same report, even after the car went out of service', async () => {
    await plantCar('190', { branchId: branchAId });
    const body = { vehicleId: car('190'), clientRequestId: randomUUID(), items: { dvr: 'works' } };
    const first = await fileReport(body);
    expect(first.status).toBe(201);
    const report = data<ItVehicleCheckDto>(first);

    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(car('190')) },
      { $set: { status: 'outOfService' } },
    );
    const again = await fileReport(body);
    expect(again.status).toBe(200);
    expect(data<ItVehicleCheckDto>(again).id).toBe(report.id);
    expect(
      await ItVehicleCheckModel.countDocuments({ clientRequestId: body.clientRequestId }),
    ).toBe(1);
  });

  it('refuses the same request id from another user (409)', async () => {
    const body = { vehicleId: car('150'), clientRequestId: randomUUID() };
    expect((await fileReport(body)).status).toBe(201);
    const reused = await fileReport(body, otherReporterToken);
    expect(reused.status).toBe(409);
    expect(errorCode(reused)).toBe(ErrorCodes.IT_VEHICLE_CHECK_REQUEST_REUSED);
    expect(
      await ItVehicleCheckModel.countDocuments({ clientRequestId: body.clientRequestId }),
    ).toBe(1);
  });

  it('turns two concurrent first sends into one 201, one 200 and one stored report', async () => {
    const body = { vehicleId: car('150'), clientRequestId: randomUUID() };
    const answers = await Promise.all([fileReport(body), fileReport(body)]);
    expect(answers.map((res) => res.status).sort()).toEqual([200, 201]);
    const [a, b] = answers.map((res) => data<ItVehicleCheckDto>(res).id);
    expect(a).toBe(b);
    expect(
      await ItVehicleCheckModel.countDocuments({ clientRequestId: body.clientRequestId }),
    ).toBe(1);
  });
});

describe('photos', () => {
  it('takes five photos and refuses the sixth (422) without storing it', async () => {
    const report = await filed('61');
    for (let n = 1; n <= 5; n += 1) {
      const res = await upload(report.id);
      expect(res.status).toBe(200);
      expect(data<ItVehicleCheckDto>(res).photos).toHaveLength(n);
    }
    const sixth = await upload(report.id);
    expect(sixth.status).toBe(422);
    expect(errorCode(sixth)).toBe(ErrorCodes.IT_VEHICLE_CHECK_PHOTO_LIMIT);
    expect(await filesOf(report.id)).toHaveLength(5);

    const raw = await ItVehicleCheckModel.findById(report.id).lean().exec();
    expect(raw?.photos).toHaveLength(5);
    expect(raw?.__v).toBe(5);
    expect(String(raw?.updatedBy)).toBe(reporterId);
    const photo = raw?.photos[0];
    expect(photo).toMatchObject({ mime: 'image/png', size: PNG.length, fileName: 'camera.png' });

    // The display name carries no extension: the platform appends the stored one on download
    // (`${displayName}${extension}`), so a PNG sent as it was downloads as '….png', never '….jpg.png'.
    const stored = await FileModel.find({ _id: { $in: (raw?.photos ?? []).map((p) => p.fileId) } })
      .select({ _id: 1, displayName: 1, extension: 1 })
      .lean<{ _id: Types.ObjectId; displayName: string; extension: string }[]>()
      .exec();
    const byId = new Map(stored.map((file) => [String(file._id), file]));
    expect(
      (raw?.photos ?? []).map((p) => {
        const file = byId.get(String(p.fileId));
        return `${file?.displayName ?? ''}${file?.extension ?? ''}`;
      }),
    ).toEqual([1, 2, 3, 4, 5].map((n) => `vehicle-check-${report.checkDate}-61-${String(n)}.png`));
  });

  it('refuses a report filed more than 24 hours ago (422) without storing a file', async () => {
    const report = await filed('61');
    await ItVehicleCheckModel.collection.updateOne(
      { _id: new Types.ObjectId(report.id) },
      { $set: { createdAt: new Date(Date.now() - (24 * 60 + 1) * 60 * 1000) } },
    );
    const late = await upload(report.id);
    expect(late.status).toBe(422);
    expect(errorCode(late)).toBe(ErrorCodes.IT_VEHICLE_CHECK_PHOTO_WINDOW_CLOSED);
    expect(await filesOf(report.id)).toHaveLength(0);
  });

  it("answers 404 for another user's report or a deleted one, and stores no file", async () => {
    const mine = await filed('61');
    const theirs = await upload(mine.id, { token: otherReporterToken });
    expect(theirs.status).toBe(404);
    expect(errorCode(theirs)).toBe(ErrorCodes.NOT_FOUND);
    expect(await filesOf(mine.id)).toHaveLength(0);

    const gone = await filed('61');
    await ItVehicleCheckModel.collection.updateOne(
      { _id: new Types.ObjectId(gone.id) },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    );
    const deleted = await upload(gone.id);
    expect(deleted.status).toBe(404);
    expect(await filesOf(gone.id)).toHaveLength(0);

    // A report that never existed is the same answer.
    expect((await upload(String(new Types.ObjectId()))).status).toBe(404);
  });

  it("lets a branch-scoped reporter add photos to a report on another branch's car", async () => {
    const res = await fileReport({ vehicleId: car('152') }, branchReporterToken);
    expect(res.status).toBe(201);
    const report = data<ItVehicleCheckDto>(res);
    expect(report.branchId).toBe(branchBId);
    const photo = await upload(report.id, { token: branchReporterToken });
    expect(photo.status).toBe(200);
    expect(data<ItVehicleCheckDto>(photo).photos).toHaveLength(1);
  });

  it('keeps one photo when the same clientPhotoId is sent twice, answering 200 both times', async () => {
    const report = await filed('61');
    const clientPhotoId = randomUUID();
    const first = await upload(report.id, { clientPhotoId });
    const second = await upload(report.id, { clientPhotoId });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(data<ItVehicleCheckDto>(second).photos).toHaveLength(1);
    expect(data<ItVehicleCheckDto>(second).photos[0]?.clientPhotoId).toBe(clientPhotoId);
    expect(await filesOf(report.id)).toHaveLength(1);
  });

  it('leaves exactly five photos after six concurrent uploads, and no live file from the others', async () => {
    const report = await filed('61');
    const answers = await Promise.all(Array.from({ length: 6 }, () => upload(report.id)));
    const statuses = answers.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 422]);
    const refused = answers.filter((res) => res.status === 422);
    for (const res of refused) expect(errorCode(res)).toBe(ErrorCodes.IT_VEHICLE_CHECK_PHOTO_LIMIT);

    const raw = await ItVehicleCheckModel.findById(report.id).lean().exec();
    expect(raw?.photos).toHaveLength(5);
    const live = await filesOf(report.id, true);
    expect(live).toHaveLength(5);
    expect(live.map((file) => String(file._id)).sort()).toEqual(
      (raw?.photos ?? []).map((photo) => String(photo.fileId)).sort(),
    );

    // Each accepted upload's audit row says it added ONE photo to the list as it then stood — not
    // to the list its first read saw, which every racing upload read as empty.
    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'vehicleCheck',
      'entityRef.entityId': report.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(rows).toHaveLength(5);
    const lists = rows
      .map((row) => {
        const change = row.changes.find((c) => c.field === 'photos');
        return { old: change?.old as string[], new: change?.new as string[] };
      })
      .sort((a, b) => a.new.length - b.new.length);
    expect(lists.map((list) => list.old.length)).toEqual([0, 1, 2, 3, 4]);
    for (const list of lists) {
      expect(list.new).toHaveLength(list.old.length + 1);
      expect(list.new.slice(0, list.old.length)).toEqual(list.old);
    }
  });

  it("refuses an 11 MB JPEG and a PDF by the category's rules (422), storing neither", async () => {
    const report = await filed('61');
    const big = await upload(report.id, {
      file: {
        buffer: Buffer.alloc(11 * 1024 * 1024, 0xff),
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      },
    });
    expect(big.status).toBe(422);
    expect(errorCode(big)).toBe(ErrorCodes.FILE_TOO_LARGE);

    const pdf = await upload(report.id, {
      file: {
        buffer: Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
        filename: 'report.pdf',
        contentType: 'application/pdf',
      },
    });
    expect(pdf.status).toBe(422);
    expect(errorCode(pdf)).toBe(ErrorCodes.FILE_TYPE_NOT_ALLOWED);
    expect(await filesOf(report.id)).toHaveLength(0);
  });

  it('refuses a malformed id, a missing file part and a missing clientPhotoId (400)', async () => {
    const report = await filed('61');
    expect((await upload('not-an-id')).status).toBe(400);
    const noFile = await upload(report.id, { file: null });
    expect(noFile.status).toBe(400);
    expect(errorCode(noFile)).toBe(ErrorCodes.VALIDATION_FAILED);
    const noId = await upload(report.id, { clientPhotoId: null });
    expect(noId.status).toBe(400);
    expect(errorCode(noId)).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(await filesOf(report.id)).toHaveLength(0);
  });
});

describe('the audit trail', () => {
  it('records create and update under the literal entity ref', async () => {
    const report = await filed('9');
    expect((await upload(report.id)).status).toBe(200);
    const rowsOf = (action: string) =>
      AuditLogModel.find({
        'entityRef.moduleId': 'it',
        'entityRef.entityType': 'vehicleCheck',
        'entityRef.entityId': report.id,
        action,
      })
        .lean()
        .exec();
    expect(await rowsOf('create')).toHaveLength(1);
    const [first] = await rowsOf('update');
    expect(first?.changes).toEqual([
      { field: 'photos', old: [], new: [expect.any(String) as unknown as string] },
    ]);

    // A second photo: old is the one photo already there, new adds this one.
    const second = await upload(report.id);
    expect(second.status).toBe(200);
    const fileIds = data<ItVehicleCheckDto>(second).photos.map((photo) => photo.fileId);
    const updates = await rowsOf('update');
    expect(updates).toHaveLength(2);
    expect(updates.map((row) => row.changes)).toContainEqual([
      { field: 'photos', old: [fileIds[0]], new: fileIds },
    ]);
  });
});

describe('the file authorizer', () => {
  it('writes for the reporter holding create alone, and reads for a viewer in scope alone', async () => {
    const report = await filed('9'); // branch A
    const ask = (ctx: AuthContext, intent: 'read' | 'write') =>
      vehicleCheckFileAuthorizer.authorize({ ctx, entityId: report.id, intent });
    const reporter = ctxOf(reporterId, { 'itVehicleCheck.create': 'own' });
    const viewerIn = (scope: 'organization' | 'branch', branchId: string | null): AuthContext => ({
      ...ctxOf(otherReporterId, { 'itVehicleCheck.view': scope }),
      branchId,
    });

    // The one write: the report's own reporter, holding the grant.
    expect(await ask(reporter, 'write')).toBe(true);
    // Somebody else, grant or not; the reporter without the grant; a viewer.
    expect(
      await ask(ctxOf(otherReporterId, { 'itVehicleCheck.create': 'organization' }), 'write'),
    ).toBe(false);
    expect(await ask(ctxOf(reporterId, {}), 'write')).toBe(false);
    expect(await ask(viewerIn('organization', null), 'write')).toBe(false);

    // The form's grant reads nothing back — not even the reporter's own photos.
    expect(await ask(reporter, 'read')).toBe(false);
    expect(
      await ask(ctxOf(otherReporterId, { 'itVehicleCheck.create': 'organization' }), 'read'),
    ).toBe(false);
    // `itVehicleCheck.view` reads, inside its scope: everywhere, or the report's own branch.
    expect(await ask(viewerIn('organization', null), 'read')).toBe(true);
    expect(await ask(viewerIn('branch', branchAId), 'read')).toBe(true);
    expect(await ask(viewerIn('branch', branchBId), 'read')).toBe(false);

    // A deleted report's photos are unreachable, whoever asks.
    await ItVehicleCheckModel.collection.updateOne(
      { _id: new Types.ObjectId(report.id) },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    );
    expect(await ask(viewerIn('organization', null), 'read')).toBe(false);
  });
});

// ── The dashboard (2026-11-10) — «تمام نفذا الـ Dashboard بتاعت الفحص» ─────────────────────────
describe('the dashboard', () => {
  const day = (back: number): string => addDaysYmd(today(), -back);
  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60 * 1000);
  /** The planted reports. */
  const r = {} as Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9', string>;
  const NONE = Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 0]));

  // Branch C's fleet, in Fleet's code order — 301, 302, (303 out of service), هيونداي 4, 55 —
  // and its reports. Planted HERE, after the car list's cases, which count every active car.
  beforeAll(async () => {
    await plantCar('301', { branchId: branchCId });
    await plantCar('302', { branchId: branchCId });
    await plantCar('303', { branchId: branchCId, status: 'outOfService' });
    await plantCar('هيونداي 4', { branchId: branchCId });
    await plantCar('55', { branchId: branchCId });
    const C = branchCId;
    const other = { id: otherReporterId, name: 'شريف ممدوح فاروق' };
    // 301: three live reports and a deleted one. r3 is the latest — yesterday, filed after r2;
    // r1 was filed last of all but for an earlier day, and the day comes first.
    r.r1 = await plantReport('301', {
      branchId: C,
      checkDate: day(2),
      createdAt: minutesAgo(30),
      photos: 1,
    });
    r.r2 = await plantReport('301', {
      branchId: C,
      checkDate: day(1),
      createdAt: minutesAgo(180),
      faults: ['camera7'],
      notes: 'كاميرا داخل الخزينة 1 لا تعرض صورة.',
      photos: 1,
    });
    r.r3 = await plantReport('301', {
      branchId: C,
      checkDate: day(1),
      createdAt: minutesAgo(120),
      faults: ['dvr', 'radio'],
      notes: 'الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.',
      photos: 2,
    });
    // Deleted: today's report would otherwise be 301's latest, and its screen a fault.
    r.r4 = await plantReport('301', {
      branchId: C,
      checkDate: day(0),
      createdAt: minutesAgo(60),
      faults: ['screen'],
      notes: 'الشاشة مطفأة.',
      photos: 1,
      isDeleted: true,
    });
    // 302: one report three days ago, by another reporter, with no photo.
    r.r5 = await plantReport('302', {
      branchId: C,
      checkDate: day(3),
      createdAt: minutesAgo(3 * 1440),
      reporter: other,
    });
    // هيونداي 4: last checked nine days ago — overdue, and outside the default window.
    r.r6 = await plantReport('هيونداي 4', {
      branchId: C,
      checkDate: day(9),
      createdAt: minutesAgo(9 * 1440),
      photos: 1,
    });
    // 303 is out of service: its report counts in the period, never as a row of «آخر تقرير».
    r.r7 = await plantReport('303', {
      branchId: C,
      checkDate: day(0),
      createdAt: minutesAgo(60),
      faults: ['camera1'],
      notes: 'كاميرا أمام المركبة مكسورة.',
    });
    // 55 has none. Beyond C: a report on the car with no branch, and one on branch B.
    r.r8 = await plantReport('1003', {
      branchId: null,
      checkDate: day(0),
      createdAt: minutesAgo(90),
      photos: 1,
    });
    r.r9 = await plantReport('152', {
      branchId: branchBId,
      checkDate: day(1),
      createdAt: minutesAgo(300),
      photos: 1,
    });
    expect(['55', 'هيونداي 4', '303', '302', '301'].sort(compareFleetVehicleCodes)).toEqual([
      '301',
      '302',
      '303',
      'هيونداي 4',
      '55',
    ]);
  });

  it('answers 403 to every read without itVehicleCheck.view — the form’s reporter included — and to a delete without .delete', async () => {
    const fileId = String(new Types.ObjectId());
    for (const token of [reporterToken, assetViewerToken, fleetViewerToken]) {
      expect((await read('/dashboard', token)).status).toBe(403);
      expect((await read('', token)).status).toBe(403);
      expect((await read(`/${r.r3}`, token)).status).toBe(403);
      expect((await read(`/${r.r3}/photos/${fileId}`, token)).status).toBe(403);
    }
    for (const token of [reporterToken, orgViewerToken]) {
      expect((await remove(r.r3, token)).status).toBe(403);
    }
    const raw = await ItVehicleCheckModel.collection.findOne({ _id: new Types.ObjectId(r.r3) });
    expect(raw?.isDeleted).toBe(false);
    // …and reading or deleting is not filing: the form's three routes stay the form's.
    for (const token of [orgViewerToken, deleterToken]) {
      expect((await listCars('?page=1&pageSize=10', token)).status).toBe(403);
      expect((await fileReport({ vehicleId: car('301') }, token)).status).toBe(403);
      expect((await upload(r.r3, { token })).status).toBe(403);
    }
    expect(await filesOf(r.r3)).toHaveLength(0);
  });

  it("derives every figure from the reports: each car's latest by day then filing, the deleted and the inactive left out", async () => {
    const dashboard = await board(`?branchId=${branchCId}`);
    expect(dashboard.from).toBe(day(6));
    expect(dashboard.to).toBe(today());
    expect(dashboard.overdueDays).toBe(7);
    expect(dashboard.totals).toEqual({
      // r1, r2, r3, r5, r7 — not the deleted r4, not r6 from nine days ago.
      reports: 5,
      reporters: 2,
      // 301 and 302 — not 303: its report counts above, but it is out of service, and the tile
      // reads «X من Y سيارة نشطة».
      carsChecked: 2,
      // 301, 302, هيونداي 4, 55.
      activeCars: 4,
      // 301's latest is r3: the DVR and the radio.
      carsWithFaults: 1,
      devicesNotWorking: 2,
      overdueCars: 2,
      // r5 and r7.
      reportsWithoutPhoto: 2,
    });
    expect(dashboard.faultsByDevice).toEqual({ ...NONE, dvr: 1, radio: 1 });
    // Fleet's code order, one row per active car that has a report: 55 has none, 303 is inactive.
    expect(dashboard.latest.map((row) => row.reportId)).toEqual([r.r3, r.r5, r.r6]);
    expect(dashboard.latest[0]).toEqual({
      reportId: r.r3,
      vehicleId: car('301'),
      vehicleCode: '301',
      branchId: branchCId,
      checkDate: day(1),
      createdAt: expect.any(String) as unknown as string,
      items: {
        ...Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])),
        dvr: 'notWorking',
        radio: 'notWorking',
      },
      photoCount: 2,
      hasNotes: true,
      reportedByName: 'سامح نبيل',
    });
    expect(dashboard.latest[1]).toMatchObject({
      vehicleCode: '302',
      photoCount: 0,
      hasNotes: false,
    });
    // Never checked first, then the longest unchecked — under the car's branch now.
    expect(dashboard.overdue).toEqual([
      {
        vehicleId: car('55'),
        vehicleCode: '55',
        branchId: branchCId,
        lastCheckDate: null,
        daysSince: null,
      },
      {
        vehicleId: car('هيونداي 4'),
        vehicleCode: 'هيونداي 4',
        branchId: branchCId,
        lastCheckDate: day(9),
        daysSince: 9,
      },
    ]);
  });

  it('opens on the last seven days, clamps an end after today, and never limits the latest reports to the window', async () => {
    const clamped = await board(`?branchId=${branchCId}&to=${addDaysYmd(today(), 5)}`);
    expect([clamped.from, clamped.to]).toEqual([day(6), today()]);
    expect(clamped.totals.reports).toBe(5);

    // «اليوم»: r7 alone (r4 is deleted) — but the matrix and the overdue cars are unchanged. r7 is
    // on the out-of-service 303, so no ACTIVE car was checked today: «٠ من ٤».
    const onlyToday = await board(`?branchId=${branchCId}&from=${today()}&to=${today()}`);
    expect(onlyToday.totals).toMatchObject({
      reports: 1,
      reporters: 1,
      carsChecked: 0,
      reportsWithoutPhoto: 1,
      activeCars: 4,
      overdueCars: 2,
    });
    expect(onlyToday.latest.map((row) => row.reportId)).toEqual([r.r3, r.r5, r.r6]);

    // An earlier end moves the default start with it: seven days ending there.
    const earlier = await board(`?branchId=${branchCId}&to=${day(2)}`);
    expect([earlier.from, earlier.to]).toEqual([day(8), day(2)]);
    expect(earlier.totals).toMatchObject({
      reports: 2,
      reporters: 2,
      carsChecked: 2,
      reportsWithoutPhoto: 1,
    });

    const inverted = await read(`/dashboard?from=${today()}&to=${day(1)}`, orgViewerToken);
    expect(inverted.status).toBe(400);
    expect(errorCode(inverted)).toBe(ErrorCodes.VALIDATION_FAILED);
  });

  it("shows a branch-scoped reader their branch's cars and reports only, whatever branch they ask for", async () => {
    const mine = await board('', branchViewerToken);
    expect(mine.totals).toMatchObject({ reports: 5, activeCars: 4, overdueCars: 2 });
    expect(mine.latest.map((row) => row.reportId)).toEqual([r.r3, r.r5, r.r6]);

    const elsewhere = await board(`?branchId=${branchBId}`, branchViewerToken);
    expect(elsewhere.totals).toMatchObject({
      reports: 0,
      reporters: 0,
      activeCars: 0,
      overdueCars: 0,
    });
    expect(elsewhere.latest).toEqual([]);
    expect(elsewhere.overdue).toEqual([]);

    // An organization-wide reader sees every branch — and the car with no branch, with its report.
    const everything = await board('');
    const codes = everything.latest.map((row) => row.vehicleCode);
    for (const code of ['150', '152', '301', '302', 'هيونداي 4']) expect(codes).toContain(code);
    expect(everything.latest.find((row) => row.vehicleId === car('1003'))?.branchId).toBeNull();
    expect(mine.latest.some((row) => row.vehicleId === car('1003'))).toBe(false);
  });

  it('shows a report with no branch to an organization-wide reader only', async () => {
    const org = await read(`/${r.r8}`, orgViewerToken);
    expect(org.status).toBe(200);
    expect(data<ItVehicleCheckDto>(org).branchId).toBeNull();

    const branch = await read(`/${r.r8}`, branchViewerToken);
    expect(branch.status).toBe(404);
    expect(errorCode(branch)).toBe(ErrorCodes.NOT_FOUND);
    expect(await listed(`?vehicleId=${car('1003')}`, branchViewerToken)).toEqual([]);
    expect(await listed(`?vehicleId=${car('1003')}`)).toContain(r.r8);
  });

  it('answers one report — and 404 outside the scope, for a deleted one, and for none', async () => {
    const res = await read(`/${r.r3}`, branchViewerToken);
    expect(res.status).toBe(200);
    expect(data<ItVehicleCheckDto>(res)).toMatchObject({
      id: r.r3,
      vehicleCode: '301',
      branchId: branchCId,
      checkDate: day(1),
      notes: 'الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.',
      reportedByName: 'سامح نبيل',
    });
    expect(data<ItVehicleCheckDto>(res).photos).toHaveLength(2);

    for (const [id, token] of [
      [r.r9, branchViewerToken], // branch B
      [r.r4, orgViewerToken], // deleted
      [String(new Types.ObjectId()), orgViewerToken],
    ] as const) {
      const missing = await read(`/${id}`, token);
      expect(missing.status).toBe(404);
      expect(errorCode(missing)).toBe(ErrorCodes.NOT_FOUND);
    }
    expect((await read('/not-an-id', orgViewerToken)).status).toBe(400);
  });

  it('lists the reports newest first — the day, then the filing — under every filter, ANDed', async () => {
    const C = `?branchId=${branchCId}`;
    const ALL = [r.r7, r.r3, r.r2, r.r1, r.r5, r.r6];
    expect(await listed(C)).toEqual(ALL);
    // The order is the screen's: a sort the caller sends changes nothing.
    expect(await listed(`${C}&sortBy=createdAt&sortDir=asc`)).toEqual(ALL);
    expect(await listed(`${C}&faultsOnly=false`)).toEqual(ALL);
    expect(await listed(`${C}&faultsOnly=true`)).toEqual([r.r7, r.r3, r.r2]);
    expect(await listed(`${C}&device=camera7`)).toEqual([r.r2]);
    expect(await listed(`${C}&device=dvr&faultsOnly=true`)).toEqual([r.r3]);
    // A car code in Arabic-Indic digits finds «301»; a word finds its car; a dot is a dot.
    expect(await listed(`${C}&carCode=${encodeURIComponent('٣٠١')}`)).toEqual([r.r3, r.r2, r.r1]);
    expect(await listed(`${C}&carCode=${encodeURIComponent('هيونداي')}`)).toEqual([r.r6]);
    expect(await listed(`${C}&carCode=.`)).toEqual([]);
    expect(await listed(`${C}&vehicleId=${car('302')}`)).toEqual([r.r5]);
    expect(await listed(`${C}&from=${day(3)}&to=${day(1)}`)).toEqual([r.r3, r.r2, r.r1, r.r5]);

    const second = await read(`${C}&page=2&pageSize=2`, orgViewerToken);
    expect(second.status).toBe(200);
    expect(data<ItVehicleCheckDto[]>(second).map((report) => report.id)).toEqual([r.r2, r.r1]);
    expect((second.body as { meta: PageMeta }).meta).toMatchObject({
      totalItems: 6,
      totalPages: 3,
    });

    // The branch reader's list is their branch's, and a branch they may not see is empty.
    expect(await listed('', branchViewerToken)).toEqual(ALL);
    expect(await listed(`?branchId=${branchBId}`, branchViewerToken)).toEqual([]);
  });

  it('serves a photo of a report the reader may see — and 404 for a file not on it, or a report out of reach', async () => {
    const report = await filed('152'); // branch B
    const uploaded = await upload(report.id);
    expect(uploaded.status).toBe(200);
    const fileId = data<ItVehicleCheckDto>(uploaded).photos[0]?.fileId ?? '';

    const bytes = await read(`/${report.id}/photos/${fileId}`, orgViewerToken);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');
    expect(bytes.headers['content-disposition']).toBe('inline; filename="camera.png"');
    expect(bytes.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.isBuffer(bytes.body)).toBe(true);
    expect((bytes.body as Buffer).equals(PNG)).toBe(true);

    // Another report's real photo, asked for under this report: not this report's.
    const another = await filed('152');
    const anotherUpload = await upload(another.id);
    const foreignFileId = data<ItVehicleCheckDto>(anotherUpload).photos[0]?.fileId ?? '';
    for (const [path, token] of [
      [`/${report.id}/photos/${foreignFileId}`, orgViewerToken],
      [`/${report.id}/photos/${String(new Types.ObjectId())}`, orgViewerToken],
      [`/${report.id}/photos/${fileId}`, branchViewerToken], // branch B, read from C
    ] as const) {
      const refused = await read(path, token);
      expect(refused.status).toBe(404);
      expect(errorCode(refused)).toBe(ErrorCodes.NOT_FOUND);
    }
    expect((await read(`/${report.id}/photos/not-an-id`, orgViewerToken)).status).toBe(400);

    // Deleted, the report's photo is unreachable — and still stored (no retention, design §7).
    expect((await remove(report.id, deleterToken)).status).toBe(204);
    const gone = await read(`/${report.id}/photos/${fileId}`, orgViewerToken);
    expect(gone.status).toBe(404);
    expect(await filesOf(report.id, true)).toHaveLength(1);
  });

  it('soft-deletes a report under the delete scope, audits it, and the report leaves every read', async () => {
    // Not a viewer's to delete, nor a branch deleter's on another branch.
    const outside = await remove(r.r9, branchDeleterToken);
    expect(outside.status).toBe(404);
    expect(errorCode(outside)).toBe(ErrorCodes.NOT_FOUND);
    expect(
      (await ItVehicleCheckModel.collection.findOne({ _id: new Types.ObjectId(r.r9) }))?.isDeleted,
    ).toBe(false);

    const res = await remove(r.r3, deleterToken);
    expect(res.status).toBe(204);
    const raw = await ItVehicleCheckModel.collection.findOne({ _id: new Types.ObjectId(r.r3) });
    expect(raw?.isDeleted).toBe(true);
    expect(raw?.deletedAt).toBeInstanceOf(Date);
    expect(String(raw?.deletedBy)).toBe(deleterId);
    // The photo links stay on the record: the files are kept, only unreachable.
    const photoIds = ((raw?.photos ?? []) as { fileId: Types.ObjectId }[]).map((p) =>
      String(p.fileId),
    );
    expect(photoIds).toHaveLength(2);

    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'vehicleCheck',
      'entityRef.entityId': r.r3,
      action: 'delete',
    })
      .lean()
      .exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'vehicleCode', old: '301', new: null },
        { field: 'checkDate', old: day(1), new: null },
        { field: 'photos', old: photoIds, new: null },
      ]),
    );

    expect((await read(`/${r.r3}`, orgViewerToken)).status).toBe(404);
    expect((await remove(r.r3, deleterToken)).status).toBe(404);
    expect(await listed(`?branchId=${branchCId}`)).toEqual([r.r7, r.r2, r.r1, r.r5, r.r6]);
    // 301's latest is r2 now: the camera inside safe 1, and the DVR and radio count no more.
    const after = await board(`?branchId=${branchCId}`);
    expect(after.latest.map((row) => row.reportId)).toEqual([r.r2, r.r5, r.r6]);
    expect(after.faultsByDevice).toEqual({ ...NONE, camera7: 1 });
    expect(after.totals).toMatchObject({ reports: 4, carsWithFaults: 1, devicesNotWorking: 1 });

    // A branch deleter in C may delete C's report: هيونداي 4 is then never checked, and both
    // never-checked cars are listed in Fleet's code order.
    expect((await remove(r.r6, branchDeleterToken)).status).toBe(204);
    const overdue = (await board(`?branchId=${branchCId}`)).overdue;
    expect(overdue.map((row) => [row.vehicleCode, row.daysSince])).toEqual([
      ['هيونداي 4', null],
      ['55', null],
    ]);
  });
});
