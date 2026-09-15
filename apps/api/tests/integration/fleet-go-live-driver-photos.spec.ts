// The driver licence scans, against a real mongo and the real HR registry — the things the
// design rests on, in the order an operator meets them.
//
//   1. A refusal writes its reason and claims nothing.
//   2. The run matches a scan to a driving-seat employee BY CODE, opens a profile where none
//      exists, attaches the scan, lists what it could not place, and finishes.
//   3. A later boot writes nothing.
//   4. A take-over skips every scan that already landed — the idempotency the vehicles get from
//      «update by code» and a REPLACING upload does not.
//   5. The row is readable over HTTP by whoever may act on it, and by nobody else.
//
// The employees are made through HR's own direct-registration endpoint, because «who is a
// driver» is the org chart's answer (a job title with `requiresDrivingTest`) and their CODES are
// HR's — `<branch code><employee number>` — which is the join this whole step hangs on.
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type FleetGoLiveRunsDto } from '@ecms/contracts';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { FleetDriverProfileModel } from '../../src/modules/fleet/driver-profiles/driver-profile.model';
import { fleetDriverProfileService } from '../../src/modules/fleet/driver-profiles/driver-profile.service';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import {
  DRIVER_PHOTOS_DIR,
  DRIVER_PHOTOS_GO_LIVE_MARK,
  runDriverPhotosGoLive,
} from '../../src/modules/fleet/go-live/driver-photos';
import { env } from '../../src/infrastructure/config/env';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
/** A real scan from the go-live folder, so the Files category's image rules are met for real. */
const REAL_SCAN = join(HERE, '..', '..', 'assets', 'fleet-go-live', DRIVER_PHOTOS_DIR, '0100026.jpg');

const PASSWORD = 'Str0ng#Pass!';
let replset: MongoMemoryReplSet | undefined;
let app: Express;
let adminToken: string;
let dataDir = '';
let photoDir = '';
let jobTitleId = '';
let officeTitleId = '';
let branchId = '';
let departmentId = '';

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
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

let nid = 0;
let phone = 50_000_000;
/** An HR employee through the real direct-registration endpoint, in the given seat. Returns id + CODE. */
const mkEmployee = async (fullNameAr: string, title: string): Promise<{ id: string; code: string }> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `290010101${String(40_000 + nid++).padStart(5, '0')}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `010${String(phone++).padStart(8, '0')}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: title,
        departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  const id = (res.body as { data: { id: string } }).data.id;
  const doc = await EmployeeModel.findById(id, { code: 1 }).lean<{ code: string }>().exec();
  return { id, code: (doc as { code: string }).code };
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: DRIVER_PHOTOS_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const profileOf = async (employeeId: string) =>
  FleetDriverProfileModel.findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
    .lean<{ _id: Types.ObjectId; __v: number; licenseImage: { fileId: Types.ObjectId; fileName: string; size: number } | null } | null>()
    .exec();

let driverA = { id: '', code: '' };
let driverB = { id: '', code: '' };
let office = { id: '', code: '' };

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  // The login IS the seeded admin: the step authors every profile and upload as
  // `env.SEED_ADMIN_EMAIL`, exactly as the vehicles are authored.
  const adminId = await mkUser(env.SEED_ADMIN_EMAIL);
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
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });
  const login = await request(app).post('/api/v1/auth/login').send({ email: env.SEED_ADMIN_EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body as { data: { accessToken: string } }).data.accessToken;

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app).post(path).set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(res.status, path).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchId = await post('/api/v1/platform/branches', { code: '010', name: { ar: 'المهندسين', en: 'Mohandessin' } });
  departmentId = await post('/api/v1/platform/departments', {
    code: 'FL-OPS',
    name: { ar: 'إدارة الحركة', en: 'Fleet Operations' },
    branchId,
  });
  // WHO IS A DRIVER IS THE ORG CHART — the seat carries the flag, or nobody is on the registry.
  jobTitleId = await post('/api/v1/platform/job-titles', {
    code: 'FL-DRV',
    name: { ar: 'سائق', en: 'Driver' },
    jobGrade: 'G1',
    requiresDrivingTest: true,
  });
  officeTitleId = await post('/api/v1/platform/job-titles', {
    code: 'NON-DRV',
    name: { ar: 'موظف مكتب', en: 'Office staff' },
    jobGrade: 'G1',
    requiresDrivingTest: false,
  });
  driverA = await mkEmployee('سائق أ', jobTitleId);
  driverB = await mkEmployee('سائق ب', jobTitleId);
  office = await mkEmployee('موظف مكتب', officeTitleId);
  // The company's own shape: branch code + number, seven digits.
  expect(driverA.code).toMatch(/^010\d{4}$/);

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-photos-'));
  photoDir = join(dataDir, DRIVER_PHOTOS_DIR);
  await mkdir(photoDir, { recursive: true });
  // One scan per driving-seat employee, one for an office employee (nobody's on the registry),
  // one for a code nobody has. Named by CODE, which is the whole mechanism.
  for (const code of [driverA.code, driverB.code, office.code, '0109999']) {
    await copyFile(REAL_SCAN, join(photoDir, `${code}.jpg`));
  }
}, 180_000);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await disconnectMongo();
  await replset?.stop();
});

describe('a refusal writes its reason and claims nothing', () => {
  it('refuses a folder holding a file that is not an image', async () => {
    await writeFile(join(photoDir, 'notes.txt'), 'not a scan', 'utf8');

    await runDriverPhotosGoLive(dataDir);

    expect(await profileOf(driverA.id), 'no profile was opened').toBeNull();
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'plan', notImages: ['notes.txt'], duplicates: [] });
    expect((doc?.leaseUntil as Date).getTime(), 'no lease to wait out').toBeLessThanOrEqual(Date.now());
    await rm(join(photoDir, 'notes.txt'));
  });
});

describe('the run that can proceed', () => {
  it('attaches each scan to the driver whose CODE names it, enrolling those not yet on file', async () => {
    await runDriverPhotosGoLive(dataDir);

    for (const driver of [driverA, driverB]) {
      const profile = await profileOf(driver.id);
      expect(profile, `${driver.code} has a profile now`).not.toBeNull();
      expect(profile?.licenseImage?.fileName, 'the scan named for the code').toBe(`${driver.code}.jpg`);
      expect(profile?.licenseImage?.size, 'the real bytes').toBeGreaterThan(1000);
    }
    expect(await profileOf(office.id), 'an office employee is not a driver — no profile is invented').toBeNull();

    const doc = await run();
    expect(doc?.status, 'finished').toBe('done');
    expect(doc?.outcome).toMatchObject({
      attached: 2,
      kept: 0,
      enrolled: 2,
      unmatched: [`${office.code}.jpg`, '0109999.jpg'].sort(),
      exited: [],
    });
  });

  it('a later boot writes nothing at all — not a version bump, not a new file version', async () => {
    const before = await profileOf(driverA.id);

    await runDriverPhotosGoLive(dataDir);

    const after = await profileOf(driverA.id);
    expect(after?.__v).toBe(before?.__v);
    expect(String(after?.licenseImage?.fileId)).toBe(String(before?.licenseImage?.fileId));
  });
});

describe('a run that died is finished by the next boot — without re-uploading what landed', () => {
  it('takes over an expired lease, attaches only what is missing, keeps the rest', async () => {
    // A third driver, ALREADY on file without a scan — the registry's own «record the licence»
    // path had enrolled them. The take-over must attach to that profile, not open a second one.
    const driverC = await mkEmployee('سائق ج', jobTitleId);
    const adminId = String((await userService.findByEmail(env.SEED_ADMIN_EMAIL))?._id);
    await fleetDriverProfileService.create({ employeeId: driverC.id }, adminId);
    await copyFile(REAL_SCAN, join(photoDir, `${driverC.code}.jpg`));
    // Driver A lost their scan; driver B still has theirs.
    await FleetDriverProfileModel.updateOne({ employeeId: new Types.ObjectId(driverA.id) }, { $set: { licenseImage: null } }).exec();
    const bBefore = await profileOf(driverB.id);
    await FleetGoLiveRunModel.updateOne(
      { key: DRIVER_PHOTOS_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();

    await runDriverPhotosGoLive(dataDir);

    expect((await profileOf(driverA.id))?.licenseImage?.fileName, 'A got theirs back').toBe(`${driverA.code}.jpg`);
    expect((await profileOf(driverC.id))?.licenseImage?.fileName, 'C got theirs on the existing profile').toBe(`${driverC.code}.jpg`);
    expect(await FleetDriverProfileModel.countDocuments({ employeeId: new Types.ObjectId(driverC.id) }).exec(), 'one profile for C').toBe(1);
    const bAfter = await profileOf(driverB.id);
    expect(String(bAfter?.licenseImage?.fileId), 'B was NOT re-uploaded').toBe(String(bBefore?.licenseImage?.fileId));
    expect(bAfter?.__v, 'nor even written').toBe(bBefore?.__v);
    const doc = await run();
    expect(doc?.status).toBe('done');
    expect(doc?.outcome).toMatchObject({ attached: 2, kept: 1, enrolled: 0 });
  });
});

describe('the row is readable over HTTP', () => {
  it('by whoever may create vehicles or manage drivers', async () => {
    const res = await request(app).get('/api/v1/fleet/go-live').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = (res.body as { data: FleetGoLiveRunsDto }).data;
    const mine = body.runs.find((r) => r.key === DRIVER_PHOTOS_GO_LIVE_MARK);
    expect(mine?.status).toBe('done');
    expect(mine?.outcome).toMatchObject({ attached: 2, kept: 1 });
    expect(typeof mine?.startedAt).toBe('string');
  });

  it('and by nobody else', async () => {
    // A signed token for a user with no role at all — the endpoint's gate is the permission.
    const nobody = await mkUser('nobody@ecms.local');
    const token = await authService.signAccessToken(nobody, new Types.ObjectId().toString(), 0);
    const res = await request(app).get('/api/v1/fleet/go-live').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
