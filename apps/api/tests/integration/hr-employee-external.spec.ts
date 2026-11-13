// Registering an EXTERNAL person over HTTP — «موظفين خارجيين .. يعني تعيين خارجى .. بالتالى ملهمش
// كود عندنا ولا بيانات .. محتاج أسجل بس أسمهم والإدارة والوظيفة بتاعتهم عشان أقدر أسلملهم عهده فى
// الـ IT وهكذا .. واديله كود بردو».
//
// The claims worth a running server, because each is about several things agreeing at once:
//
//   1. FOUR FIELDS IN, A WHOLE IDENTITY OUT. A name, a branch, a department and a job title are
//      enough, and the server composes the code itself — the branch's own prefix plus the next
//      number on the same global counter every other employee draws from (ADR-017). Only a real
//      sequence and a real branch can show that.
//   2. AND NOTHING ELSE IS INVENTED. No national ID, no salary, no login. A registration that
//      quietly filled any of them in would be writing down facts about somebody the company never
//      employed, and the fields are checked on the stored record, not on the request.
//   3. THEY ARE A FINDABLE EMPLOYEE. The whole point is IT custody, which names an employee — so
//      the person has to come back from the ordinary employee read, inside the ordinary scope.
//
// Everyone here is invented and lives only in this run's in-memory database.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type EmployeeDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const EXTERNAL = '/api/v1/hr/employees/external';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let ADMIN_ID = '';
let adminToken = '';
/** `employee.registerDirect` — the key that puts somebody in the registry. */
let registrarToken = '';
/** `employee.view` only: may read employees, may not register one. */
let viewerToken = '';

const BRANCH_CODE = '001';
let BRANCH_ID = '';
let OTHER_BRANCH_ID = '';
let DEPARTMENT_ID = '';
/** A department of the OTHER branch — the pair the server must refuse. */
let OTHER_DEPARTMENT_ID = '';
let SECTION_ID = '';
let JOB_TITLE_ID = '';

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-external-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
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
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const accountWith = async (email: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    ADMIN_ID,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

/** The whole request: a name, where they sit, what they do. */
const registerExternal = (token: string, body: Record<string, unknown>) =>
  request(app).post(EXTERNAL).set('Authorization', `Bearer ${token}`).send(body);

/** A fresh external code per request — the company's own name for the person, letters and all. */
let codeSerial = 0;
const nextCode = (): string => `EX-${String(++codeSerial).padStart(3, '0')}`;

const wellFormed = (fullNameAr: string): Record<string, unknown> => ({
  code: nextCode(),
  fullNameAr,
  branchId: BRANCH_ID,
  departmentId: DEPARTMENT_ID,
  jobTitleId: JOB_TITLE_ID,
});

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  ADMIN_ID = await mkUser('external-admin@ecms.local');
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
  adminToken = await login('external-admin@ecms.local');

  BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: BRANCH_CODE,
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
      code: 'DEP-EXT',
      name: { ar: 'تقنية المعلومات', en: 'IT' },
      branchId: BRANCH_ID,
    }),
  ).id;
  OTHER_DEPARTMENT_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/departments').send({
      code: 'DEP-EXT-2',
      name: { ar: 'التشغيل', en: 'Operations' },
      branchId: OTHER_BRANCH_ID,
    }),
  ).id;
  SECTION_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/sections').send({
      code: 'SEC-EXT',
      name: { ar: 'الدعم الفني', en: 'Support' },
      departmentId: DEPARTMENT_ID,
    }),
  ).id;
  JOB_TITLE_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/job-titles').send({
      code: 'JT-EXT',
      name: { ar: 'فني', en: 'Technician' },
      jobGrade: 'G5',
    }),
  ).id;

  registrarToken = await accountWith('external-registrar@ecms.local', [
    'employee.registerDirect',
    'employee.view',
  ]);
  viewerToken = await accountWith('external-viewer@ecms.local', ['employee.view']);
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('POST /hr/employees/external', () => {
  it('registers the person and keeps the code exactly as it was typed', async () => {
    const body = { ...wellFormed('شركة الحراسة محمد على'), code: 'GUARD-7A' };

    const res = await registerExternal(registrarToken, body);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const employee = data<EmployeeDto>(res);
    expect(employee.code).toBe('GUARD-7A');
    expect(employee.personal.fullNameAr).toBe('شركة الحراسة محمد على');
    expect(employee.origin).toBe('external');
    expect(employee.status).toBe('active');
  });

  /**
   * The code is a NAME, not an issued employee code: it is not composed from the branch and it is
   * not the employee number wearing a prefix. The number is still drawn — every employee has one —
   * and the two simply do not match, which is the difference this test exists to hold.
   */
  it('does not compose the code from the branch, and does not tie it to the number', async () => {
    const employee = data<EmployeeDto>(
      await registerExternal(registrarToken, { ...wellFormed('خارجي بكود حروف'), code: 'ABC123' }),
    );

    expect(employee.code).toBe('ABC123');
    expect(employee.code.startsWith(BRANCH_CODE)).toBe(false);
    expect(employee.employeeNumber).toMatch(/^\d{4,}$/);
    expect(employee.code).not.toContain(employee.employeeNumber);
  });

  /** «ملهمش كود عندنا ولا بيانات» — so nothing but what was asked for may end up on the record. */
  it('invents nothing: no national ID, no salary, no probation, no login', async () => {
    const employee = data<EmployeeDto>(
      await registerExternal(registrarToken, wellFormed('سائق خارجي أحمد')),
    );

    expect(employee.personal.nationalIdMasked).toBeNull();
    expect(employee.employment.salary).toBeNull();
    expect(employee.probation).toBeNull();
    expect(employee.userId).toBeNull();
    expect(employee).not.toHaveProperty('provisionedLogin');
  });

  /** The NUMBER still comes from the one global counter, even though the code no longer does. */
  it('draws each one from the global employee counter', async () => {
    const first = data<EmployeeDto>(await registerExternal(registrarToken, wellFormed('خارجي أول')));
    const second = data<EmployeeDto>(
      await registerExternal(registrarToken, wellFormed('خارجي ثان')),
    );

    expect(Number(second.employeeNumber)).toBe(Number(first.employeeNumber) + 1);
  });

  /** The point of the whole thing: IT hands custody to an employee, so they must read back as one. */
  it('comes back from the ordinary employee read, which is what custody needs', async () => {
    const registered = data<EmployeeDto>(
      await registerExternal(registrarToken, wellFormed('فني خارجي سعيد')),
    );

    const res = await request(app)
      .get(`/api/v1/hr/employees/${registered.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(data<EmployeeDto>(res).code).toBe(registered.code);
  });

  it('accepts a section of the chosen department', async () => {
    const res = await registerExternal(registrarToken, {
      ...wellFormed('خارجي بقسم'),
      sectionId: SECTION_ID,
    });

    expect(res.status).toBe(201);
    expect(data<EmployeeDto>(res).employment.sectionId).toBe(SECTION_ID);
  });
});

describe('the code HR types', () => {
  /** «واسمح ان الكود يتكتب فيه حروف انجليزي» — the whole reason this is not the employee pattern. */
  it.each([['letters only', 'EXTERNAL'], ['letters and digits', 'EX2026A'], ['a hyphen', 'EX-01']])(
    'accepts %s',
    async (_label, code) => {
      const res = await registerExternal(registrarToken, {
        ...wellFormed('خارجي بكود مقبول'),
        code,
      });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(data<EmployeeDto>(res).code).toBe(code);
    },
  );

  /** One code, one person, company-wide — and the second attempt is a 409, not a 500 from the index. */
  it('refuses a code another external person already holds', async () => {
    await registerExternal(registrarToken, { ...wellFormed('صاحب الكود'), code: 'TAKEN-1' });

    const res = await registerExternal(registrarToken, {
      ...wellFormed('من يريد نفس الكود'),
      code: 'TAKEN-1',
    });

    expect(res.status).toBe(409);
  });

  /**
   * The check is the WHOLE registry, not the external corner of it. An ordinary employee is hired
   * with a typed code here and an external person then asks for that same code: one code, one
   * person, company-wide — «مينفعش أكتب نفس الكود حتى لو لفرع تاني» applies to these people too.
   */
  it('refuses a code an ordinary employee already holds', async () => {
    const hired = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `${BRANCH_CODE}8801`,
        personal: {
          identity: {
            fullNameAr: 'موظف أصيل',
            fullNameEn: 'Hired Person',
            nationalId: '29003070118801',
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: '01020000801' },
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
          salary: { amount: 10000, currency: 'EGP' },
          probationMonths: 0,
          startDate: '2026-01-01T00:00:00.000Z',
        },
      });
    expect(hired.status, JSON.stringify(hired.body)).toBe(201);
    const taken = data<EmployeeDto>(hired).code;

    const res = await registerExternal(registrarToken, {
      ...wellFormed('خارجي يطلب كود موظف'),
      code: taken,
    });

    expect(res.status).toBe(409);
  });
});

describe('GET /hr/employees/external/last-code', () => {
  /** «عرفنى تحته كدا أخر كود كام للموظفين الخارجيين دول» — the one registered last, not the largest. */
  it('answers with the code of the external person registered most recently', async () => {
    await registerExternal(registrarToken, { ...wellFormed('أقدم خارجي'), code: 'HINT-1' });
    await registerExternal(registrarToken, { ...wellFormed('أحدث خارجي'), code: 'HINT-2' });

    const res = await request(app)
      .get('/api/v1/hr/employees/external/last-code')
      .set('Authorization', `Bearer ${registrarToken}`);

    expect(res.status).toBe(200);
    expect(data<{ code: string | null }>(res).code).toBe('HINT-2');
  });

  it('refuses a reader who may not register, and an unauthenticated caller', async () => {
    const path = '/api/v1/hr/employees/external/last-code';
    expect((await request(app).get(path).set('Authorization', `Bearer ${viewerToken}`)).status).toBe(
      403,
    );
    expect((await request(app).get(path)).status).toBe(401);
  });
});

describe('what it refuses', () => {
  it('refuses a department that belongs to another branch', async () => {
    const res = await registerExternal(registrarToken, {
      ...wellFormed('خارجي بإدارة غريبة'),
      departmentId: OTHER_DEPARTMENT_ID,
    });

    expect(res.status).toBe(422);
  });

  it.each([
    ['no code', { code: undefined }],
    ['a one-character code', { code: 'A' }],
    ['a code with Arabic letters', { code: 'كود1' }],
    ['a code with a space', { code: 'EX 01' }],
    ['a code past twenty characters', { code: 'E'.repeat(21) }],
    ['no name', { fullNameAr: '' }],
    ['a one-letter name', { fullNameAr: 'م' }],
    ['a Latin name', { fullNameAr: 'External Person' }],
    ['no branch', { branchId: undefined }],
    ['no department', { departmentId: undefined }],
    ['no job title', { jobTitleId: undefined }],
  ])('refuses %s', async (_label, patch) => {
    const body: Record<string, unknown> = { ...wellFormed('خارجي صحيح'), ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete body[key];
    }

    expect((await registerExternal(registrarToken, body)).status).toBe(400);
  });

  it('refuses a reader who may see employees but not register one', async () => {
    expect((await registerExternal(viewerToken, wellFormed('خارجي ممنوع'))).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(app).post(EXTERNAL).send(wellFormed('خارجي بلا دخول'))).status).toBe(401);
  });
});
