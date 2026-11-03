// The employee's photo and the welcome card, over HTTP against a running server.
//
// «عايزك تضيف فى بروفايل كل شخص صورة شخصية ليه .. ويقدر الـ HR يضيفهاله» — and the welcome page
// shows every signed-in person their own birthday. The claims below are about four things agreeing
// at once — the route guard, the scoped employee lookup, HR's ADR-023 photo rule and the Files
// service — which no unit test holds together, so the roles here are spelled out key by key.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type EmployeeDto,
  type EmployeeTimelineItemDto,
  type MyEmployeeSummaryDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { FileModel } from '../../src/platform/files/file.model';
import { FileCategoryModel } from '../../src/platform/files/file-category.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let ADMIN_ID = '';
let adminToken = '';
/** `employee.view` only, organization-wide: may look at a photo, may not change one. */
let viewerToken = '';
/** `employee.view` + `employee.editPersonal`: HR, who sets the photo. */
let editorToken = '';
/** `employee.view` scoped to ANOTHER branch: the employee is outside their reach. */
let farViewerToken = '';
/** No employee key, and no employee behind the account. */
let outsiderToken = '';
/** Every generic file key that does not break glass, and no employee key. */
let clerkToken = '';
/** The employee themselves, signing in with their code. */
let employeeToken = '';

let BRANCH_ID = '';
let OTHER_BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';
let employee: EmployeeDto;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('first-photo-bytes'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('second-photo')]);
const PDF = Buffer.from('%PDF-1.7\nnot a photo');

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorOf = (res: request.Response): { code: string; message: string } =>
  (res.body as { error: { code: string; message: string } }).error;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-photo-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (identifier: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send(
      identifier.includes('@')
        ? { email: identifier, password: PASSWORD }
        : { identifier, password: PASSWORD },
    );
  expect(res.status, `login ${identifier}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

/** A role holding exactly these keys, assigned at this scope to a fresh account. */
const accountWith = async (
  email: string,
  keys: string[],
  scope: 'organization' | 'branch' = 'organization',
  branchId: string | null = null,
): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    ADMIN_ID,
  );
  const userId = await mkUser(email, branchId);
  await rbacService.ensureAssignment(userId, String(role._id), scope);
  return login(email);
};

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

/** 2 YY MM DD GG SSS G C — born 1990-03-07 in Cairo; the serial keeps each person distinct. */
let serial = 100;
const nationalId = (): string => `2900307011${String(serial++).padStart(3, '0')}1`;

const register = async (fullNameAr: string): Promise<EmployeeDto> => {
  const res = await asAdmin('post', '/hr/employees/direct').send({
    personal: {
      identity: {
        fullNameAr,
        fullNameEn: 'Photo Person',
        nationalId: nationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `0101${String(serial).padStart(7, '0')}` },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId: JOB_TITLE_ID,
      branchId: BRANCH_ID,
      departmentId: DEPARTMENT_ID,
      employmentType: 'fullTime',
      salary: { amount: 15000, currency: 'EGP' },
      probationMonths: 0,
      startDate: '2026-01-01T00:00:00.000Z',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<EmployeeDto>(res);
};

const photoPath = (id: string): string => `/api/v1/hr/employees/${id}/photo`;

const uploadPhoto = (
  token: string,
  id: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
) =>
  request(app)
    .post(photoPath(id))
    .set('Authorization', `Bearer ${token}`)
    .attach('file', bytes, { filename, contentType });

/** The raw bytes, whatever the content type says. */
const getPhoto = (token: string, path: string) =>
  request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

const fileRow = (id: string) =>
  FileModel.findById(id)
    .lean<{
      isDeleted: boolean;
      mime: string;
      entityRef: { moduleId: string; entityType: string; entityId: string };
      categoryId: unknown;
    }>()
    .exec();

// ── Boot ──────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  ADMIN_ID = await mkUser('photo-admin@ecms.local');
  await rbacService.ensureAssignment(ADMIN_ID, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: ADMIN_ID,
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
  adminToken = await login('photo-admin@ecms.local');

  BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: '001',
      name: { ar: 'الرئيسي', en: 'HQ' },
    }),
  ).id;
  OTHER_BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: '002',
      name: { ar: 'الفرع الثاني', en: 'Second' },
    }),
  ).id;
  DEPARTMENT_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/departments').send({
      code: 'DEP-PHOTO',
      name: { ar: 'التشغيل', en: 'Operations' },
      branchId: BRANCH_ID,
    }),
  ).id;
  JOB_TITLE_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/job-titles').send({
      code: 'JT-PHOTO',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G5',
    }),
  ).id;

  viewerToken = await accountWith('photo-viewer@ecms.local', ['employee.view']);
  editorToken = await accountWith('photo-editor@ecms.local', [
    'employee.view',
    'employee.editPersonal',
  ]);
  farViewerToken = await accountWith(
    'photo-far@ecms.local',
    ['employee.view'],
    'branch',
    OTHER_BRANCH_ID,
  );
  outsiderToken = await accountWith('photo-outsider@ecms.local', ['applicant.view']);
  clerkToken = await accountWith('photo-clerk@ecms.local', [
    'file.view',
    'file.download',
    'file.edit',
    'file.delete',
  ]);

  // The employee, with the login hiring provisioned for them, activated the way the setup link
  // would — then signing in by their code, as an employee does.
  const registered = await register('موظف بصورة');
  employee = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${registered.id}`));
  expect(employee.userId).not.toBeNull();
  await userService.setPassword(String(employee.userId), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(employee.userId));
  employeeToken = await login(employee.code);
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── The welcome card ──────────────────────────────────────────────────────────

describe('GET /hr/employees/me/summary', () => {
  it('answers the signed-in employee with their own card — and nothing else of the record', async () => {
    const res = await request(app)
      .get('/api/v1/hr/employees/me/summary')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const card = data<MyEmployeeSummaryDto>(res);
    expect(Object.keys(card).sort()).toEqual(
      [
        'birthDate',
        'branch',
        'code',
        'department',
        'employeeId',
        'fullNameAr',
        'fullNameEn',
        'hasPhoto',
        'jobTitle',
      ].sort(),
    );
    expect(card).toEqual({
      employeeId: employee.id,
      code: employee.code,
      fullNameAr: 'موظف بصورة',
      fullNameEn: 'Photo Person',
      // Derived from the national id, and given as the calendar day — not an instant.
      birthDate: '1990-03-07',
      hasPhoto: false,
      jobTitle: { ar: 'سائق', en: 'Driver' },
      department: { ar: 'التشغيل', en: 'Operations' },
      branch: { ar: 'الرئيسي', en: 'HQ' },
    });
    expect(card.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain('nationalId');
    expect(wire).not.toContain('15000');
    expect(wire).not.toContain('primaryPhone');
  });

  it('answers 404 to an account with no employee behind it, like /me', async () => {
    const card = await request(app)
      .get('/api/v1/hr/employees/me/summary')
      .set('Authorization', `Bearer ${outsiderToken}`);
    const profile = await request(app)
      .get('/api/v1/hr/employees/me')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(card.status).toBe(404);
    expect(errorOf(card).code).toBe(errorOf(profile).code);
    expect(errorOf(card).message).toBe(errorOf(profile).message);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(app).get('/api/v1/hr/employees/me/summary')).status).toBe(401);
  });
});

// ── The photo ─────────────────────────────────────────────────────────────────

describe('the photo, before there is one', () => {
  it('answers 404 to the employee and to a viewer', async () => {
    expect((await getPhoto(employeeToken, '/api/v1/hr/employees/me/photo')).status).toBe(404);
    expect((await getPhoto(viewerToken, photoPath(employee.id))).status).toBe(404);
  });

  it('answers 404 on /me/photo to an account with no employee', async () => {
    expect((await getPhoto(outsiderToken, '/api/v1/hr/employees/me/photo')).status).toBe(404);
  });
});

describe('what may be filed as a photo', () => {
  it.each([
    ['a text file', 'notes.txt', 'text/plain', Buffer.from('hello')],
    ['a PDF', 'scan.pdf', 'application/pdf', PDF],
    ['a PDF labelled as a PNG', 'scan.png', 'image/png', PDF],
  ])(
    'refuses %s with a validation error naming what is allowed',
    async (_label, filename, type, bytes) => {
      const res = await uploadPhoto(editorToken, employee.id, bytes, filename, type);
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      expect(errorOf(res).message).toBe('the photo must be a JPEG, PNG or WebP image');
    },
  );

  it('refuses a photo over 5 MB, saying the limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await uploadPhoto(editorToken, employee.id, big, 'big.png', 'image/png');
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    expect(errorOf(res).message).toBe('the photo must be 5 MB or smaller');
  });

  it('refuses a request with no file part', async () => {
    const res = await request(app)
      .post(photoPath(employee.id))
      .set('Authorization', `Bearer ${editorToken}`)
      .field('note', 'no file');
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_FAILED');
  });

  it('left the employee without a photo through all of that', async () => {
    const current = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${employee.id}`));
    expect(current.personal.photoFileId).toBeNull();
  });
});

describe('who may set or remove a photo', () => {
  it('refuses a viewer without employee.editPersonal', async () => {
    expect((await uploadPhoto(viewerToken, employee.id, PNG, 'p.png', 'image/png')).status).toBe(
      403,
    );
    const removed = await request(app)
      .delete(photoPath(employee.id))
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(removed.status).toBe(403);
  });

  it('refuses the employee themselves — being the employee writes nothing', async () => {
    expect((await uploadPhoto(employeeToken, employee.id, PNG, 'p.png', 'image/png')).status).toBe(
      403,
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(app)
      .post(photoPath(employee.id))
      .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

describe('setting, reading, replacing and removing the photo', () => {
  let firstFileId = '';
  let secondFileId = '';

  it('files a PNG and answers with the employee, redacted as PATCH /personal answers', async () => {
    const before = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${employee.id}`));
    const res = await uploadPhoto(editorToken, employee.id, PNG, 'face.png', 'image/png');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<EmployeeDto>(res);
    expect(dto.id).toBe(employee.id);
    expect(dto.personal.photoFileId).toMatch(/^[0-9a-f]{24}$/);
    // The editor holds no compensation key, so the salary is redacted exactly as everywhere else.
    expect(dto.compensationVisible).toBe(false);
    expect(dto.employment.salary).toBeNull();
    expect(dto.version).toBe(before.version + 1);
    firstFileId = String(dto.personal.photoFileId);

    const row = await fileRow(firstFileId);
    expect(row?.entityRef).toMatchObject({
      moduleId: 'hr',
      entityType: 'employeePhoto',
      entityId: employee.id,
    });
    expect(row?.mime).toBe('image/png');
    const category = await FileCategoryModel.findById(row?.categoryId)
      .lean<{ key: string; allowedMimeTypes: string[]; maxSizeMb: number }>()
      .exec();
    expect(category?.key).toBe('hr-employee-photo');
    expect([...(category?.allowedMimeTypes ?? [])].sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(category?.maxSizeMb).toBe(5);
  });

  it('serves the bytes to a viewer, with the content type, privately', async () => {
    const res = await getPhoto(viewerToken, photoPath(employee.id));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });

  it('serves the employee their own, with no employee permission at all', async () => {
    const res = await getPhoto(employeeToken, '/api/v1/hr/employees/me/photo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);

    const card = data<MyEmployeeSummaryDto>(
      await request(app)
        .get('/api/v1/hr/employees/me/summary')
        .set('Authorization', `Bearer ${employeeToken}`),
    );
    expect(card.hasPhoto).toBe(true);
  });

  it('refuses a caller without employee.view', async () => {
    expect((await getPhoto(outsiderToken, photoPath(employee.id))).status).toBe(403);
  });

  it('hides it from a viewer whose branch does not reach the employee, as GET /:id does', async () => {
    expect((await getPhoto(farViewerToken, photoPath(employee.id))).status).toBe(404);
    const detail = await request(app)
      .get(`/api/v1/hr/employees/${employee.id}`)
      .set('Authorization', `Bearer ${farViewerToken}`);
    expect(detail.status).toBe(404);
  });

  /**
   * The generic file routes ask HR too. A file clerk holds every file key and no employee key: the
   * photo is invisible to them, its bytes are not served, and they cannot delete it.
   */
  it('does not leak through the generic file routes', async () => {
    const meta = await request(app)
      .get(`/api/v1/platform/files/${firstFileId}`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(meta.status).toBe(404);
    const download = await request(app)
      .get(`/api/v1/platform/files/${firstFileId}/download?mode=ticket`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(download.status).toBe(404);
    const listed = await request(app)
      .get(`/api/v1/platform/files?moduleId=hr&entityType=employeePhoto&entityId=${employee.id}`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(listed.status).toBe(200);
    expect(data<unknown[]>(listed)).toEqual([]);
    const deleted = await request(app)
      .delete(`/api/v1/platform/files/${firstFileId}`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect([403, 404]).toContain(deleted.status);
    expect((await fileRow(firstFileId))?.isDeleted).toBe(false);
  });

  it('records the change on the employee’s timeline', async () => {
    const timeline = data<EmployeeTimelineItemDto[]>(
      await asAdmin('get', `/hr/employees/${employee.id}/timeline`),
    );
    expect(
      timeline.some(
        (item) =>
          item.source === 'personal' && (item.detail ?? '').includes('personal.photoFileId'),
      ),
    ).toBe(true);
  });

  it('replaces it: the new photo is served, the old file is retired and unreadable', async () => {
    const res = await uploadPhoto(editorToken, employee.id, JPEG, 'new.jpg', 'image/jpeg');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    secondFileId = String(data<EmployeeDto>(res).personal.photoFileId);
    expect(secondFileId).not.toBe(firstFileId);

    expect((await fileRow(firstFileId))?.isDeleted).toBe(true);
    expect((await fileRow(secondFileId))?.isDeleted).toBe(false);

    const served = await getPhoto(viewerToken, photoPath(employee.id));
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(served.body as Buffer, JPEG)).toBe(0);

    // Not even somebody who may see every file can read the retired one back.
    const old = await asAdmin('get', `/platform/files/${firstFileId}`);
    expect(old.status).toBe(404);
  });

  it('removes it: the link is cleared, the file retired, and every read says «no photo»', async () => {
    const res = await request(app)
      .delete(photoPath(employee.id))
      .set('Authorization', `Bearer ${editorToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<EmployeeDto>(res);
    expect(dto.personal.photoFileId).toBeNull();
    expect(dto.compensationVisible).toBe(false);

    expect((await fileRow(secondFileId))?.isDeleted).toBe(true);
    expect((await getPhoto(viewerToken, photoPath(employee.id))).status).toBe(404);
    expect((await getPhoto(employeeToken, '/api/v1/hr/employees/me/photo')).status).toBe(404);
    const card = data<MyEmployeeSummaryDto>(
      await request(app)
        .get('/api/v1/hr/employees/me/summary')
        .set('Authorization', `Bearer ${employeeToken}`),
    );
    expect(card.hasPhoto).toBe(false);
  });

  it('removing again is idempotent: the employee comes back unchanged', async () => {
    const before = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${employee.id}`));
    const res = await request(app)
      .delete(photoPath(employee.id))
      .set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(200);
    const dto = data<EmployeeDto>(res);
    expect(dto.personal.photoFileId).toBeNull();
    expect(dto.version).toBe(before.version);
  });
});

describe('an employee outside the caller’s reach', () => {
  it('cannot be given a photo by an editor who cannot reach them', async () => {
    const farEditor = await accountWith(
      'photo-far-editor@ecms.local',
      ['employee.view', 'employee.editPersonal'],
      'branch',
      OTHER_BRANCH_ID,
    );
    const res = await uploadPhoto(farEditor, employee.id, PNG, 'p.png', 'image/png');
    expect(res.status).toBe(404);
    const current = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${employee.id}`));
    expect(current.personal.photoFileId).toBeNull();
  });
});

describe('a link that does not point at this employee’s photo', () => {
  /**
   * `photoFileId` can also be written through the personal-data edit, with any file id. The photo
   * endpoint serves only a file filed as THIS employee's photo, so such a link shows «no photo»
   * rather than whatever document it names.
   */
  it('is answered as «no photo», never with the other file', async () => {
    const other = await register('موظف آخر');
    const filed = await uploadPhoto(editorToken, other.id, PNG, 'other.png', 'image/png');
    expect(filed.status).toBe(200);
    const otherFileId = String(data<EmployeeDto>(filed).personal.photoFileId);

    const current = data<EmployeeDto>(await asAdmin('get', `/hr/employees/${employee.id}`));
    const pointed = await request(app)
      .patch(`/api/v1/hr/employees/${employee.id}/personal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ identity: { photoFileId: otherFileId }, version: current.version });
    expect(pointed.status, JSON.stringify(pointed.body)).toBe(200);

    expect((await getPhoto(viewerToken, photoPath(employee.id))).status).toBe(404);
    expect((await getPhoto(employeeToken, '/api/v1/hr/employees/me/photo')).status).toBe(404);
    // The other employee's own photo is untouched by any of it.
    expect((await getPhoto(viewerToken, photoPath(other.id))).status).toBe(200);
  });
});
