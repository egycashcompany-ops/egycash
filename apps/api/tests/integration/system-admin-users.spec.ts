// SA-2 integration suite: creating and editing accounts, the administrative unlock, and the
// HR-owned employee link — over real HTTP with real RBAC.
//
// Four rules carry this file, and each one is invisible until it silently breaks:
//
//   1. **An account must be reachable.** `findByIdentifier` matches a username, an email or an
//      employee code, and a platform account has no employee code — so an account with neither
//      identifier can never sign in. It used to be creatable and looked entirely normal in a list.
//      Proven by creating each single-identifier variant AND by actually signing in with it.
//   2. **The identifier rule survives editing.** Clearing the email is fine for an account that
//      signs in by username and locks out one that does not; only the STORED state can tell them
//      apart, which is why the check is in the service rather than the schema.
//   3. **Unlock clears the lockout and nothing else.** It is not a status change: a suspended
//      account that is also locked out must stay suspended.
//   4. **The employee link is HR's to write.** Both sides move together, `user.employeeId` is not
//      reachable from the platform update endpoint at all, and the account survives an unlink with
//      its credentials, roles and history intact.
//
// Error mapping is asserted deliberately: 400 = the body could not be READ, 409 = a conflict with
// state, 403 = the grant is missing, 404 = out of scope or absent.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type EmployeeDto,
  type UserDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { userRepository } from '../../src/platform/users/user.repository';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // everything
let adminId: string;
let editorToken: string; // user.view/create/edit — the account administrator, no HR grant
let readerToken: string; // user.view only — the negative control for every write
let branchToken: string; // user.* at BRANCH scope, placed in branch B
let hrLinkToken: string; // user.edit + employee.view — the principal that may link

let BRANCH_A = '';
let BRANCH_B = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-sa-users-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const login = async (identifier: string): Promise<request.Response> =>
  request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });

const seedUser = async (email: string, branchId: string | null = null): Promise<string> => {
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

const tokenOf = async (email: string): Promise<string> => {
  const res = await login(email);
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

const createUser = (body: Record<string, unknown>, token = adminToken): request.Test =>
  request(app)
    .post('/api/v1/platform/users')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const patchUser = (id: string, body: Record<string, unknown>, token = adminToken): request.Test =>
  request(app)
    .patch(`/api/v1/platform/users/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getUser = async (id: string, token = adminToken): Promise<UserDto> => {
  const res = await request(app)
    .get(`/api/v1/platform/users/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<UserDto>(res);
};

const unlock = (id: string, token = adminToken): request.Test =>
  request(app).post(`/api/v1/platform/users/${id}/unlock`).set('Authorization', `Bearer ${token}`).send({});

const linkEmployee = (employeeId: string, userId: string, token = adminToken): request.Test =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/user-link`)
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });

const unlinkEmployee = (employeeId: string, token = adminToken): request.Test =>
  request(app)
    .delete(`/api/v1/hr/employees/${employeeId}/user-link`)
    .set('Authorization', `Bearer ${token}`);

let nameSeq = 0;
const names = (): Record<string, unknown> => {
  nameSeq += 1;
  return {
    firstName: { ar: `أ${String(nameSeq)}`, en: `A${String(nameSeq)}` },
    lastName: { ar: `ب${String(nameSeq)}`, en: `B${String(nameSeq)}` },
  };
};

let nidSeq = 40_000;
const nextNid = (): string => `290010101${String((nidSeq += 1)).padStart(5, '0')}`;
let phoneSeq = 8000;
const nextPhone = (): string => `010123${String((phoneSeq += 1)).padStart(5, '0')}`;

/** An employee created through HR's own path — which auto-provisions a login for it. */
const registerEmployee = async (): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'موظف الاختبار', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: JOB_TITLE_ID,
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_A,
        employmentType: 'fullTime',
        probationMonths: 3,
        startDate: '2024-01-01T00:00:00.000Z',
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
    });
  expect(res.status).toBe(201);
  return data<EmployeeDto>(res);
};

/** An employee with NO login: created through HR, then released through the endpoint under test. */
const employeeWithoutLogin = async (): Promise<EmployeeDto> => {
  const employee = await registerEmployee();
  if (employee.userId === null) return employee;
  const res = await unlinkEmployee(employee.id);
  expect(res.status).toBe(200);
  return data<EmployeeDto>(res);
};

const auditActions = async (entityType: string, entityId: string): Promise<string[]> => {
  const rows = await AuditLogModel.find({
    'entityRef.entityType': entityType,
    'entityRef.entityId': entityId,
  })
    .lean<{ action: string }[]>()
    .exec();
  return rows.map((row) => row.action);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await seedUser('sa-admin@ecms.local');
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
  adminToken = await tokenOf('sa-admin@ecms.local');

  const branchA = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'الرئيسي', en: 'HQ' } });
  expect(branchA.status).toBe(201);
  BRANCH_A = data<{ id: string }>(branchA).id;
  const branchB = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '002', name: { ar: 'فرع ب', en: 'Branch B' } });
  expect(branchB.status).toBe(201);
  BRANCH_B = data<{ id: string }>(branchB).id;
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS', name: { ar: 'العمليات', en: 'Operations' }, branchId: BRANCH_A });
  expect(dept.status).toBe(201);
  DEPARTMENT_ID = data<{ id: string }>(dept).id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'CASHIER', name: { ar: 'صراف', en: 'Cashier' }, jobGrade: 'G3' });
  expect(title.status).toBe(201);
  JOB_TITLE_ID = data<{ id: string }>(title).id;

  const mkPrincipal = async (
    en: string,
    permissionKeys: string[],
    email: string,
    branchId: string | null = null,
    scope: 'organization' | 'branch' = 'organization',
  ): Promise<string> => {
    const role = await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId);
    const userId = await seedUser(email, branchId);
    await rbacService.ensureAssignment(userId, String(role._id), scope);
    return tokenOf(email);
  };

  editorToken = await mkPrincipal(
    'Account administrator',
    ['user.view', 'user.create', 'user.edit'],
    'sa-editor@ecms.local',
  );
  readerToken = await mkPrincipal('Account reader', ['user.view'], 'sa-reader@ecms.local');
  branchToken = await mkPrincipal(
    'Branch account administrator',
    ['user.view', 'user.create', 'user.edit'],
    'sa-branch@ecms.local',
    BRANCH_B,
    'branch',
  );
  hrLinkToken = await mkPrincipal(
    'Linker',
    ['user.view', 'user.edit', 'employee.view'],
    'sa-linker@ecms.local',
  );
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── 1. Creation: the identifier invariant ───────────────────────────────────

describe('an account is created only when it can be signed into', () => {
  it('creates a USERNAME-only account, and that username actually signs in', async () => {
    const res = await createUser({ ...names(), username: 'only.username', locale: 'en' });
    expect(res.status).toBe(201);
    const created = data<UserDto>(res);
    expect(created.username).toBe('only.username');
    expect(created.email).toBeNull();
    expect(created.status).toBe('invited');

    // The point of the invariant: this identifier resolves. Activate through the setup link the
    // creation issued, then sign in by username.
    const token = (res.body as { data: { activationToken: string } }).data.activationToken;
    const activated = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token, password: PASSWORD });
    // Activation answers 204: it consumes the link and returns nothing, because the only thing it
    // could return is the credential state the caller just set.
    expect(activated.status).toBe(204);
    expect((await login('only.username')).status).toBe(200);
  });

  it('creates an EMAIL-only account, and that email actually signs in', async () => {
    const res = await createUser({ ...names(), email: 'only.email@ecms.local', locale: 'en' });
    expect(res.status).toBe(201);
    const created = data<UserDto>(res);
    expect(created.email).toBe('only.email@ecms.local');
    expect(created.username).toBeNull();

    const token = (res.body as { data: { activationToken: string } }).data.activationToken;
    const activated = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token, password: PASSWORD });
    expect(activated.status).toBe(204);
    expect((await login('only.email@ecms.local')).status).toBe(200);
  });

  it('refuses an account with NEITHER identifier', async () => {
    const res = await createUser({ ...names(), locale: 'en' });
    expect(res.status).toBe(400);
  });

  it('refuses the same rule at the service, where internal callers arrive', async () => {
    await expect(
      userService.create(
        {
          ...(names() as { firstName: { ar: string; en: string }; lastName: { ar: string; en: string } }),
          locale: 'en',
          organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
        },
        null,
      ),
    ).rejects.toThrow(/login identifier/);
  });

  it('normalizes the username and keeps it unique among live accounts', async () => {
    const first = await createUser({ ...names(), username: 'Mixed.Case', locale: 'en' });
    expect(first.status).toBe(201);
    expect(data<UserDto>(first).username).toBe('mixed.case');

    const clash = await createUser({ ...names(), username: 'MIXED.case', locale: 'en' });
    expect(clash.status).toBe(409);
  });

  it('keeps the email unique among live accounts', async () => {
    expect((await createUser({ ...names(), email: 'dup@ecms.local' })).status).toBe(201);
    expect((await createUser({ ...names(), email: 'dup@ecms.local' })).status).toBe(409);
  });

  it('accepts both identifiers together', async () => {
    const res = await createUser({ ...names(), username: 'both.ids', email: 'both@ecms.local' });
    expect(res.status).toBe(201);
    const created = data<UserDto>(res);
    expect([created.username, created.email]).toEqual(['both.ids', 'both@ecms.local']);
  });
});

// ── 2. Editing ──────────────────────────────────────────────────────────────

describe('editing an account', () => {
  const mkAccount = async (over: Record<string, unknown> = {}): Promise<UserDto> => {
    const res = await createUser({ ...names(), email: `edit-${String(nameSeq)}@ecms.local`, ...over });
    expect(res.status).toBe(201);
    return data<UserDto>(res);
  };

  it('updates the profile, the identifiers and the placement', async () => {
    const user = await mkAccount();
    const res = await patchUser(user.id, {
      firstName: { ar: 'جديد', en: 'New' },
      username: 'Renamed.User',
      phone: '01012345678',
      locale: 'ar',
      organization: { branchId: BRANCH_A },
      version: user.version,
    });
    expect(res.status).toBe(200);
    const updated = data<UserDto>(res);
    expect(updated.firstName.en).toBe('New');
    expect(updated.username).toBe('renamed.user');
    expect(updated.locale).toBe('ar');
    expect(updated.organization.branchId).toBe(BRANCH_A);
  });

  it('lets an account that signs in by username drop its email', async () => {
    const user = await mkAccount({ username: 'keeps.username' });
    const res = await patchUser(user.id, { email: null, version: user.version });
    expect(res.status).toBe(200);
    expect(data<UserDto>(res).email).toBeNull();
  });

  it('refuses to clear the ONLY identifier an account has', async () => {
    const user = await mkAccount();
    expect(user.username).toBeNull();
    const res = await patchUser(user.id, { email: null, version: user.version });
    expect(res.status).toBe(422);
    // And the account is untouched — a refused edit must not half-apply.
    expect((await getUser(user.id)).email).toBe(user.email);
  });

  it('refuses a duplicate email or username on update', async () => {
    const taken = await mkAccount({ username: 'taken.name' });
    const other = await mkAccount();
    expect((await patchUser(other.id, { email: taken.email, version: other.version })).status).toBe(409);
    expect((await patchUser(other.id, { username: 'taken.name', version: other.version })).status).toBe(409);
  });

  it('rejects an attempt to set employeeId — the link is not this endpoint’s to write', async () => {
    const user = await mkAccount();
    const res = await patchUser(user.id, {
      employeeId: '64b1f0dddddddddddddddd01',
      version: user.version,
    });
    // `.strict()` turns an undeclared key into a validation failure rather than a silent no-op.
    expect(res.status).toBe(400);
    expect((await getUser(user.id)).employeeId).toBeNull();
  });

  it('answers 409 on a stale version', async () => {
    const user = await mkAccount();
    await patchUser(user.id, { locale: 'ar', version: user.version });
    const stale = await patchUser(user.id, { locale: 'en', version: user.version });
    expect(stale.status).toBe(409);
  });
});

// ── 3. Unlock ───────────────────────────────────────────────────────────────

describe('the administrative unlock', () => {
  const account = async (): Promise<UserDto> => {
    const res = await createUser({ ...names(), email: `locked-${String(nameSeq)}@ecms.local` });
    return data<UserDto>(res);
  };

  /** Arm the lockout the way a run of failed logins does. */
  const lockedAccount = async (): Promise<UserDto> => {
    const user = await account();
    await userService.recordFailedLogin(user.id, 1, 30);
    return user;
  };

  // The two fields are asserted separately because they cannot both be non-default at once: the
  // counter RESETS at the moment it trips the lock. Testing them together would prove neither.
  it('clears the failed-login counter of an account that has not locked yet', async () => {
    const user = await account();
    await userService.recordFailedLogin(user.id, 5, 30);
    await userService.recordFailedLogin(user.id, 5, 30);
    expect((await userRepository.findById(user.id))?.security.failedLogins).toBe(2);

    expect((await unlock(user.id)).status).toBe(200);
    const after = await userRepository.findById(user.id);
    expect(after?.security.failedLogins).toBe(0);
    expect(after?.security.lockedUntil).toBeNull();
  });

  it('clears the lockout window of an account that has locked', async () => {
    const user = await lockedAccount();
    const before = await userRepository.findById(user.id);
    expect(before?.security.lockedUntil).not.toBeNull();

    const res = await unlock(user.id);
    expect(res.status).toBe(200);
    const after = await userRepository.findById(user.id);
    expect(after?.security.lockedUntil).toBeNull();
  });

  it('does not change the lifecycle status', async () => {
    const user = await lockedAccount();
    await request(app)
      .post(`/api/v1/platform/users/${user.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'suspended', version: user.version });

    const res = await unlock(user.id);
    expect(res.status).toBe(200);
    // Unlocking a disabled account must not quietly re-enable it.
    expect(data<UserDto>(res).status).toBe('suspended');
  });

  it('is audited as its own act', async () => {
    const user = await lockedAccount();
    await unlock(user.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await auditActions('user', user.id)).toContain('unlock');
  });
});

// ── 4. Authorization and scope ──────────────────────────────────────────────

describe('every new surface is authorized server-side', () => {
  it('refuses creation without user.create', async () => {
    expect((await createUser({ ...names(), username: 'nope.create' }, readerToken)).status).toBe(403);
  });

  it('refuses an edit and an unlock without user.edit', async () => {
    const user = data<UserDto>(await createUser({ ...names(), email: 'ro@ecms.local' }));
    expect((await patchUser(user.id, { locale: 'ar', version: user.version }, readerToken)).status).toBe(403);
    expect((await unlock(user.id, readerToken)).status).toBe(403);
  });

  it('refuses the employee link pair without user.edit', async () => {
    const employee = await employeeWithoutLogin();
    const user = data<UserDto>(await createUser({ ...names(), email: 'nolink@ecms.local' }));
    expect((await linkEmployee(employee.id, user.id, readerToken)).status).toBe(403);
    expect((await unlinkEmployee(employee.id, readerToken)).status).toBe(403);
  });

  it('hides an out-of-scope account from a branch-scoped administrator', async () => {
    // The account sits in branch A; the administrator's grant covers branch B.
    const user = data<UserDto>(
      await createUser({
        ...names(),
        email: 'branch-a@ecms.local',
        organization: { branchId: BRANCH_A, departmentId: null, sectionId: null, jobTitleId: null },
      }),
    );
    expect((await patchUser(user.id, { locale: 'ar', version: user.version }, branchToken)).status).toBe(404);
    expect((await unlock(user.id, branchToken)).status).toBe(404);
  });

  it('lets that same administrator work inside their own branch', async () => {
    const user = data<UserDto>(
      await createUser({
        ...names(),
        email: 'branch-b@ecms.local',
        organization: { branchId: BRANCH_B, departmentId: null, sectionId: null, jobTitleId: null },
      }),
    );
    expect((await patchUser(user.id, { locale: 'ar', version: user.version }, branchToken)).status).toBe(200);
  });
});

// ── 5. The employee link (decision E1) ──────────────────────────────────────

describe('the employee link is written by HR, on both sides', () => {
  it('links an existing account and moves BOTH sides together', async () => {
    const employee = await employeeWithoutLogin();
    const user = data<UserDto>(await createUser({ ...names(), email: 'adoptee@ecms.local' }));

    const res = await linkEmployee(employee.id, user.id, hrLinkToken);
    expect(res.status).toBe(200);
    expect(data<EmployeeDto>(res).userId).toBe(user.id);
    expect((await getUser(user.id)).employeeId).toBe(employee.id);
  });

  it('unlinks it again and clears both sides', async () => {
    const employee = await employeeWithoutLogin();
    const user = data<UserDto>(await createUser({ ...names(), email: 'released@ecms.local' }));
    await linkEmployee(employee.id, user.id);

    const res = await unlinkEmployee(employee.id, hrLinkToken);
    expect(res.status).toBe(200);
    expect(data<EmployeeDto>(res).userId).toBeNull();
    expect((await getUser(user.id)).employeeId).toBeNull();
  });

  it('leaves the account itself intact when the link is released', async () => {
    const employee = await employeeWithoutLogin();
    const created = data<UserDto>(
      await createUser({ ...names(), email: 'survivor@ecms.local', username: 'survivor' }),
    );
    await linkEmployee(employee.id, created.id);
    await unlinkEmployee(employee.id);

    const after = await getUser(created.id);
    expect(after.username).toBe('survivor');
    expect(after.email).toBe('survivor@ecms.local');
    expect(after.status).toBe(created.status);
  });

  it('refuses a second login for an employee that already has one', async () => {
    const employee = await registerEmployee();
    expect(employee.userId).not.toBeNull();
    const other = data<UserDto>(await createUser({ ...names(), email: 'second@ecms.local' }));
    expect((await linkEmployee(employee.id, other.id)).status).toBe(409);
  });

  it('refuses an account that already belongs to another employee', async () => {
    const first = await registerEmployee();
    const free = await employeeWithoutLogin();
    expect((await linkEmployee(free.id, first.userId ?? '')).status).toBe(409);
  });

  it('refuses to unlink an employee that has no login', async () => {
    const employee = await employeeWithoutLogin();
    expect((await unlinkEmployee(employee.id)).status).toBe(409);
  });

  it('audits the act against BOTH the employee and the account', async () => {
    const employee = await employeeWithoutLogin();
    const user = data<UserDto>(await createUser({ ...names(), email: 'audited@ecms.local' }));
    await linkEmployee(employee.id, user.id);
    await unlinkEmployee(employee.id);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await auditActions('user', user.id)).toEqual(
      expect.arrayContaining(['employeeLinked', 'employeeUnlinked']),
    );
    expect(await auditActions('employee', employee.id)).toEqual(
      expect.arrayContaining(['employeeLinked', 'employeeUnlinked']),
    );
  });

  it('answers 404 for an employee the caller cannot see', async () => {
    const employee = await employeeWithoutLogin();
    const user = data<UserDto>(await createUser({ ...names(), email: 'oos@ecms.local' }));
    // The branch-scoped administrator sits in branch B; the employee is registered in branch A.
    expect((await linkEmployee(employee.id, user.id, branchToken)).status).toBe(404);
  });
});

// ── 6. Nothing that was protected became reachable ──────────────────────────

describe('the protections that were already there still hold', () => {
  it('still refuses an unauthenticated caller on every new surface', async () => {
    expect((await request(app).post('/api/v1/platform/users').send({})).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/platform/users/64b1f0dddddddddddddddd01/unlock')).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/v1/hr/employees/64b1f0dddddddddddddddd01/user-link').send({})).status,
    ).toBe(401);
  });

  it('keeps an HR-only principal out of account administration', async () => {
    // The shape #157 confines its four accounts to: HR grants, nothing platform-side. The new
    // endpoints must be as closed to them as the old ones are.
    const hrOnly = await (async (): Promise<string> => {
      const role = await rbacService.createRole(
        { name: { en: 'HR only', ar: 'موارد بشرية فقط' }, permissionKeys: ['employee.view'] },
        adminId,
      );
      const userId = await seedUser('sa-hronly@ecms.local');
      await rbacService.ensureAssignment(userId, String(role._id), 'organization');
      return tokenOf('sa-hronly@ecms.local');
    })();

    expect((await createUser({ ...names(), username: 'hronly.try' }, hrOnly)).status).toBe(403);
    const user = data<UserDto>(await createUser({ ...names(), email: 'target@ecms.local' }));
    expect((await patchUser(user.id, { locale: 'ar', version: user.version }, hrOnly)).status).toBe(403);
    expect((await unlock(user.id, hrOnly)).status).toBe(403);
    const employee = await employeeWithoutLogin();
    expect((await linkEmployee(employee.id, user.id, hrOnly)).status).toBe(403);
  });

  it('still protects seeded system roles from an account administrator', async () => {
    // SA-2 adds no role surface; this is the guard that must not have moved.
    const role = await rbacService.ensureSystemRole(
      'super-admin',
      { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
      [],
    );
    const res = await request(app)
      .patch(`/api/v1/platform/roles/${String(role._id)}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ name: { ar: 'x', en: 'x' }, version: 0 });
    // No `role.edit` grant: refused before the protection is even consulted.
    expect(res.status).toBe(403);
  });
});
