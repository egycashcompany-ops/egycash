// The drivers' facts, against a real mongo and the real HR registry — «ضيف الداتا دى بتاعت
// السواقيين عشان كانت ناقصه».
//
//   1. A book with a row that names nobody is a refusal: nothing written, nothing claimed.
//   2. The run fills «الوظيفة / التخصص / الرخصة / تاريخ الرخصة» and the area: from the register by
//      CODE, from the drivers book by PHONE where the register is silent, opening a profile where
//      none exists and filling only the EMPTY fields of one that does — a field a person already
//      set is left as they set it. The words nobody's catalog had («سائق», «Operation») are added
//      under their own names; the six spellings of the two licence classes land on the two items.
//   3. It says who it could not place: an office employee, a code HR does not have.
//   4. A later boot writes nothing at all.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions } from '@ecms/contracts';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetDriverProfileModel } from '../../src/modules/fleet/driver-profiles/driver-profile.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import {
  DRIVER_DETAILS_FILE,
  LEGACY_DRIVERS_FILE,
} from '../../src/modules/fleet/go-live/driver-details-import';
import {
  DRIVER_DETAILS_GO_LIVE_MARK,
  runDriverDetailsGoLive,
} from '../../src/modules/fleet/go-live/driver-details';
import { env } from '../../src/infrastructure/config/env';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replset: MongoMemoryReplSet | undefined;
let app: Express;
let adminToken = '';
let dataDir = '';
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
let phone = 60_000_000;
/** An HR employee through the real direct-registration endpoint. Returns id, CODE and phone. */
const mkEmployee = async (
  fullNameAr: string,
  title: string,
): Promise<{ id: string; code: string; phone: string }> => {
  const primaryPhone = `010${String(phone++).padStart(8, '0')}`;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `290010101${String(50_000 + nid++).padStart(5, '0')}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone },
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
  return { id, code: (doc as { code: string }).code, phone: primaryPhone };
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: DRIVER_DETAILS_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

interface ProfileRow {
  _id: Types.ObjectId;
  __v: number;
  isActive: boolean;
  jobId: Types.ObjectId | null;
  specializationId: Types.ObjectId | null;
  licenseTypeId: Types.ObjectId | null;
  licenseExpiresAt: Date | null;
  area: string | null;
}
const profileOf = async (employeeId: string) =>
  FleetDriverProfileModel.findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
    .lean<ProfileRow | null>()
    .exec();

const itemId = async (kind: string, ar: string): Promise<string | null> => {
  const item = await FleetCatalogItemModel.findOne({ kind, 'name.ar': ar, isDeleted: false })
    .lean<{ _id: Types.ObjectId } | null>()
    .exec();
  return item === null ? null : String(item._id);
};

let fromRegister = { id: '', code: '', phone: '' };
let fromBook = { id: '', code: '', phone: '' };
let alreadyTyped = { id: '', code: '', phone: '' };
let office = { id: '', code: '', phone: '' };
const EXPIRES = '2028-02-25T00:00:00.000Z';
const BOOK_EXPIRES = '2026-10-17T00:00:00.000Z';

/** The two books, as the build ships them — written for the employees this suite made. */
const writeBooks = async (extraDetails: object[] = []): Promise<void> => {
  const details = [
    {
      employee_id: fromRegister.code,
      employee_name: 'حامد السيد حامد عبد الله',
      employee_title: 'سائق ',
      license: 'ثانية',
      license_date: { $date: EXPIRES },
      specialization: 'Operation',
      area: 'اوسيم',
      phone: fromRegister.phone,
      work_status: 1,
      deleted: 0,
    },
    {
      employee_id: alreadyTyped.code,
      employee_name: 'كريم فتحى محمد عيسى',
      employee_title: 'سائق صراف الى',
      license: 'أولى',
      license_date: null,
      specialization: 'ATM',
      area: null,
      phone: alreadyTyped.phone,
      work_status: 1,
      deleted: 0,
    },
    {
      employee_id: office.code,
      employee_name: 'موظف مكتب',
      employee_title: 'منسق جراج',
      license: 'ثانية',
      license_date: { $date: EXPIRES },
      work_status: 1,
      deleted: 0,
    },
    {
      employee_id: '0109999',
      employee_name: 'لا أحد',
      employee_title: 'سائق',
      license: 'أولى',
      work_status: 1,
      deleted: 0,
    },
    ...extraDetails,
  ];
  // The drivers book names its driver by name and PHONE, with the phone as a NUMBER — the
  // leading zero lost — which is exactly how the real one is written.
  const book = [
    {
      _id: { $oid: '6671fff29dce98ef71d0f9c3' },
      Column1: 'اسم فى الدفتر القديم',
      Column3: 'اتانية',
      Column4: { $date: BOOK_EXPIRES },
      Column6: 'بهرمس',
      Column10: Number(fromBook.phone),
      Column13: 0,
    },
    {
      _id: { $oid: '6671fff29dce98ef71d0f9c4' },
      Column1: 'سائق ترك الشركة من زمان',
      Column3: 'أولى',
      Column10: 1234567890,
      Column13: 0,
    },
  ];
  await writeFile(join(dataDir, DRIVER_DETAILS_FILE), JSON.stringify(details), 'utf8');
  await writeFile(join(dataDir, LEGACY_DRIVERS_FILE), JSON.stringify(book), 'utf8');
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
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
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: env.SEED_ADMIN_EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body as { data: { accessToken: string } }).data.accessToken;

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, path).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchId = await post('/api/v1/platform/branches', {
    code: '010',
    name: { ar: 'المهندسين', en: 'Mohandessin' },
  });
  departmentId = await post('/api/v1/platform/departments', {
    code: 'FL-OPS',
    name: { ar: 'إدارة الحركة', en: 'Fleet Operations' },
    branchId,
  });
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
  fromRegister = await mkEmployee('حامد السيد حامد عبد الله', jobTitleId);
  fromBook = await mkEmployee('ماجد سعيد محمود', jobTitleId);
  alreadyTyped = await mkEmployee('كريم فتحى محمد عيسى', jobTitleId);
  office = await mkEmployee('موظف مكتب', officeTitleId);

  // Somebody already set this driver's «الوظيفة» on the screen, to «سائق ب».
  await FleetDriverProfileModel.create({
    employeeId: new Types.ObjectId(alreadyTyped.id),
    kind: 'driver',
    jobId: new Types.ObjectId((await itemId('driverJob', 'سائق ب')) as string),
    isActive: true,
  });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-drivers-'));
}, 180_000);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await disconnectMongo();
  await replset?.stop();
});

describe('a refusal writes its reason and claims nothing', () => {
  it('refuses a register row that names nobody', async () => {
    await writeBooks([{ employee_title: 'سائق', license: 'أولى' }]);

    await runDriverDetailsGoLive(dataDir);

    expect(await profileOf(fromRegister.id), 'no profile was opened').toBeNull();
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'rejected-rows' });
    expect((doc?.leaseUntil as Date).getTime(), 'no lease to wait out').toBeLessThanOrEqual(
      Date.now(),
    );
  });
});

describe('the run that can proceed', () => {
  it('fills the facts from the register by code, and from the drivers book by phone', async () => {
    await writeBooks();

    await runDriverDetailsGoLive(dataDir);

    // «سائق» and «Operation» were nobody's item: added under their own words.
    const driver = await itemId('driverJob', 'سائق');
    const operation = await itemId('driverSpecialization', 'Operation');
    expect(driver, '«سائق» was added to «الوظيفة»').not.toBeNull();
    expect(operation, '«Operation» was added to «التخصص»').not.toBeNull();

    const a = await profileOf(fromRegister.id);
    expect(a?.isActive).toBe(true);
    expect(String(a?.jobId)).toBe(driver);
    expect(String(a?.specializationId)).toBe(operation);
    // «ثانية» is the catalog's «تانيه» — the seeded item, not a second one beside it.
    expect(String(a?.licenseTypeId)).toBe(await itemId('driverLicenseType', 'تانيه'));
    expect(a?.licenseExpiresAt?.toISOString()).toBe(EXPIRES);
    expect(a?.area).toBe('اوسيم');
    expect(await itemId('driverLicenseType', 'ثانية'), 'no second licence class').toBeNull();

    // Not in the register at all — found by the phone the drivers book wrote as a number.
    const b = await profileOf(fromBook.id);
    expect(String(b?.licenseTypeId), '«اتانية» is «تانيه» too').toBe(
      await itemId('driverLicenseType', 'تانيه'),
    );
    expect(b?.licenseExpiresAt?.toISOString()).toBe(BOOK_EXPIRES);
    expect(b?.area).toBe('بهرمس');
    expect(b?.jobId, 'the drivers book has no «الوظيفة»').toBeNull();

    // The field a person set is theirs; the empty ones beside it are filled.
    const c = await profileOf(alreadyTyped.id);
    expect(String(c?.jobId), 'kept as the screen set it').toBe(await itemId('driverJob', 'سائق ب'));
    expect(String(c?.specializationId)).toBe(await itemId('driverSpecialization', 'ATM'));
    expect(String(c?.licenseTypeId)).toBe(await itemId('driverLicenseType', 'اولى'));
    expect(
      await FleetDriverProfileModel.countDocuments({
        employeeId: new Types.ObjectId(alreadyTyped.id),
      }).exec(),
    ).toBe(1);

    expect(
      await profileOf(office.id),
      'an office employee is not a driver — no profile is invented',
    ).toBeNull();

    const doc = await run();
    expect(doc?.status, 'finished').toBe('done');
    expect(doc?.outcome).toMatchObject({
      enrolled: 2,
      keptOnScreen: [`${alreadyTyped.code}: jobId`],
      notDrivers: [`${office.code} — موظف مكتب`],
      unknownCodes: ['0109999 — لا أحد'],
      unmatchedLegacy: ['سائق ترك الشركة من زمان — 01234567890'],
      catalogCreated: ['driverJob: سائق', 'driverSpecialization: Operation'],
    });
  });

  it('a later boot writes nothing at all', async () => {
    const before = await profileOf(fromRegister.id);

    await runDriverDetailsGoLive(dataDir);

    const after = await profileOf(fromRegister.id);
    expect(after?.__v).toBe(before?.__v);
  });
});
