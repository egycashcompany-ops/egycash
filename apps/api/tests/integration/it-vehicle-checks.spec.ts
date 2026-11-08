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
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  SettingKeys,
  addDaysYmd,
  cairoYmd,
  compareFleetVehicleCodes,
  platformPermissions,
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
let branchAId: string;
let branchBId: string;

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
      items: { screen: 'works', camera3: 'notWorking', radio: null },
      notes: '    ',
    });
    expect(res.status).toBe(201);
    const report = data<ItVehicleCheckDto>(res);
    expect(report.items).toEqual({
      screen: 'works',
      camera1: null,
      camera2: null,
      camera3: 'notWorking',
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
      camera3: 'notWorking',
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
  it('refuses every read, a non-reporter, and a reporter without itVehicleCheck.create', async () => {
    const report = await filed('9');
    const ask = (ctx: AuthContext, intent: 'read' | 'write') =>
      vehicleCheckFileAuthorizer.authorize({ ctx, entityId: report.id, intent });
    const reporter = ctxOf(reporterId, { 'itVehicleCheck.create': 'own' });

    // The one yes: the report's own reporter, holding the grant, writing.
    expect(await ask(reporter, 'write')).toBe(true);
    // No read at all until the dashboard brings `itVehicleCheck.view`.
    expect(await ask(reporter, 'read')).toBe(false);
    expect(
      await ask(ctxOf(otherReporterId, { 'itVehicleCheck.create': 'organization' }), 'read'),
    ).toBe(false);
    // Somebody else, grant or not.
    expect(
      await ask(ctxOf(otherReporterId, { 'itVehicleCheck.create': 'organization' }), 'write'),
    ).toBe(false);
    // The reporter, without the grant.
    expect(await ask(ctxOf(reporterId, {}), 'write')).toBe(false);
  });
});
