// HR-only accounts (see src/hr-only-access.ts): four named users confined to the HR module.
//
// The confinement is only worth having if it holds where it is actually attacked, so this suite is
// written against the three surfaces separately rather than against the reconciler's return value:
//   • the sidebar (GET /platform/me/applications) — including the case the naive fix misses, where
//     the non-HR module is offered by their DEPARTMENT rather than by a grant of their own;
//   • the API, called directly with their own token — a 403 from the server, not a hidden link;
//   • login, which must not enter a TOTP flow for them.
//
// And a control account runs beside them through every one of those checks, because "restricted the
// right people" and "restricted everybody" look identical when only the restricted users are tested.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, type MeDto, type MyApplicationCategoryDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { seedDevData } from '../../src/seed-data';
import { env } from '../../src/infrastructure/config/env';
import { rbacService } from '../../src/platform/rbac';
import { roleRepository } from '../../src/platform/rbac/rbac.repository';
import { userService } from '../../src/platform/users';
import { userRepository } from '../../src/platform/users/user.repository';
import { settingsService } from '../../src/platform/settings';
import { branchService, departmentService } from '../../src/platform/organization';
import { applicationRepository } from '../../src/platform/applications/application.repository';
import { userApplicationService } from '../../src/platform/user-applications';
import { departmentApplicationService } from '../../src/platform/department-applications';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import {
  derivedHrRoleKey,
  parseIdentifierList,
  reconcileHrOnlyUsers,
  type HrOnlyUserReport,
} from '../../src/hr-only-access';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

/**
 * The four accounts the confinement was decided for — their REAL emails, so the suite exercises the
 * shipped configuration rather than a stand-in. Email is the identifier this system holds unique,
 * and `HR_ONLY_USER_IDENTIFIERS` is read from env below instead of being restated here: a test that
 * writes out its own list proves the reconciler works, not that it is aimed at the right people.
 */
const CONFINED = [
  { first: 'Mohamed', last: 'Mustafa', email: 'mohamed.mustafa@egycash.com.eg' },
  { first: 'Samer', last: 'Mohammed', email: 'samer.mohammed@egycash.com.eg' },
  { first: 'Mohamed', last: 'Essam', email: 'mohamed.essam@egycash.com.eg' },
  { first: 'Saif', last: 'AlDin Muhammad', email: 'saif.aldin@egycash.com.eg' },
];

/** Same department, same role, same grants — and deliberately not on the confinement list. */
const CONTROL = { first: 'Karim', last: 'Unaffected', email: 'karim.unaffected@egycash.com.eg' };

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let departmentId: string;
let mixedRoleId: string;
const userIds = new Map<string, string>();
/** Each confined user's effective permissions BEFORE the reconciliation — the baseline to narrow. */
const permissionsBefore = new Map<string, Record<string, string>>();
let reports: HrOnlyUserReport[] = [];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hronly-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const adminCtx = (): AuthContext => ({
  userId: adminId,
  sessionId: 'hr-only-test',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: { 'setting.edit': 'organization', 'setting.view': 'organization' },
  permissionVersion: 1,
  isPrivileged: true,
});

const setTotpEnforcement = async (enabled: boolean): Promise<void> => {
  await settingsService.set(adminCtx(), {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: enabled,
  });
};

interface LoginBody {
  success: boolean;
  data?: {
    totpRequired: boolean;
    enrollmentRequired?: boolean;
    challengeToken?: string;
    accessToken?: string;
    me?: MeDto;
  };
}

const doLogin = async (email: string, password = PASSWORD) => {
  await getCache().delByPrefix('rl:'); // strict auth rate limits out of the way
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return { status: res.status, body: res.body as LoginBody };
};

const tokenFor = async (email: string): Promise<string> => {
  const login = await doLogin(email);
  const token = login.body.data?.accessToken ?? '';
  expect(token, `${email} could not log in: ${JSON.stringify(login.body)}`).toBeTruthy();
  return token;
};

const get = async (path: string, token: string) =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

const navigationOf = async (token: string): Promise<MyApplicationCategoryDto[]> => {
  const res = await get('/platform/me/applications', token);
  expect(res.status).toBe(200);
  return (res.body as { data: MyApplicationCategoryDto[] }).data;
};

/**
 * Every route the sidebar shows this caller — grouped or not.
 *
 * The confinement question is "which pages can they reach", and a page inside a section is just
 * as reachable as one directly under the module. Reading only `applications` would have made the
 * confinement look tighter than it is the moment somebody grouped a module.
 */
const routesOf = (nav: MyApplicationCategoryDto[]): string[] =>
  nav.flatMap((c) =>
    [...c.applications, ...c.sections.flatMap((s) => s.applications)].map((a) => a.route),
  );

const applicationIdByRoute = async (route: string): Promise<string> => {
  const doc = await applicationRepository.findOne({ route });
  expect(doc, `no catalogued application at ${route}`).not.toBeNull();
  return String(doc?._id);
};

const createUser = async (person: {
  first: string;
  last: string;
  email: string;
}): Promise<string> => {
  const { user } = await userService.create(
    {
      email: person.email,
      firstName: { ar: person.first, en: person.first },
      lastName: { ar: person.last, en: person.last },
      locale: 'en',
      organization: { branchId: null, departmentId, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  return id;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  // The REAL seed path — the same one `npm run seed` runs, so the navigation catalog (and its
  // permission keys) and the reconciliation step are the shipped ones, not a copy.
  const seeded = await seedDevData();
  adminId = seeded.adminId;

  const branch = await branchService.create(
    { code: 'HRO', name: { ar: 'فرع', en: 'Branch' } },
    adminId,
  );
  const department = await departmentService.create(
    {
      code: 'HRO-OPS',
      name: { ar: 'إدارة', en: 'Operations' },
      branchId: String(branch._id),
    },
    adminId,
  );
  departmentId = String(department._id);

  // A role that grants HR *and* Fleet — the case a confinement cannot resolve by keeping or
  // revoking the assignment wholesale, and the one their HR access has to survive.
  const mixedRole = await rbacService.createRole(
    {
      name: { ar: 'مختلط', en: 'HR + Fleet' },
      permissionKeys: [
        'applicant.view',
        'applicant.create',
        'employee.view',
        'fleetVehicle.view',
        'fleetDriver.view',
      ],
    },
    adminId,
  );
  mixedRoleId = String(mixedRole._id);

  // The department itself is granted a Fleet application. This is the leak a per-user grant prune
  // alone would not close: nothing about these users' own records would mention Fleet, and their
  // sidebar would still offer it.
  await departmentApplicationService.assign(
    departmentId,
    await applicationIdByRoute('/fleet/vehicles'),
    adminId,
  );

  const hrAppId = await applicationIdByRoute('/applicants');
  const fleetAppId = await applicationIdByRoute('/fleet/drivers');

  for (const person of [...CONFINED, CONTROL]) {
    const id = await createUser(person);
    userIds.set(person.email, id);
    await rbacService.ensureAssignment(id, mixedRoleId, 'organization');
    await userApplicationService.assign(id, hrAppId, adminId);
    await userApplicationService.assign(id, fleetAppId, adminId);
    // Every one of them starts with TOTP enrollment forced on (the D6 admin flag), so "TOTP is not
    // required for them" is something the reconciliation had to actually change.
    await userService.setTotpRequired(id, true);
  }

  // Snapshot what each of them held, so "only removed, never added" can be asserted against the
  // real before-state rather than against a list written out by hand in the test.
  for (const person of CONFINED) {
    const id = userIds.get(person.email) ?? '';
    const doc = await userRepository.findById(id);
    const effective = await rbacService.getEffectivePermissions(
      id,
      doc?.security.permissionVersion ?? 0,
    );
    permissionsBefore.set(person.email, effective.permissions);
  }

  // THE SHIPPED CONFIGURATION, not a list this test made up — so a default that stopped naming
  // these four (a typo, a rename, a deleted entry) fails here instead of passing quietly.
  reports = await reconcileHrOnlyUsers(parseIdentifierList(env.HR_ONLY_USER_IDENTIFIERS), {
    actorId: adminId,
  });
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('the four accounts are resolved and confined', () => {
  it('resolves all four by email from the shipped configuration', () => {
    expect(parseIdentifierList(env.HR_ONLY_USER_IDENTIFIERS).sort()).toEqual(
      CONFINED.map((p) => p.email).sort(),
    );
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.outcome === 'reconciled')).toBe(true);
    expect(new Set(reports.map((r) => r.userId))).toEqual(
      new Set(CONFINED.map((p) => userIds.get(p.email))),
    );
  });

  it('refuses a name: identifier by default, and confines nobody through it', async () => {
    // A display name is not unique, so it is not an identity. The fallback exists for a database
    // whose logins are not known yet and has to be switched on deliberately.
    const outsider = await createUser({
      first: 'Mohamed',
      last: 'Untouched',
      email: 'mohamed.untouched@egycash.com.eg',
    });
    await rbacService.ensureAssignment(outsider, mixedRoleId, 'organization');

    const [report] = await reconcileHrOnlyUsers(['name:Mohamed Untouched'], { actorId: adminId });
    expect(report?.outcome).toBe('name-matching-disabled');
    expect(report?.userId).toBeNull();

    const effective = await rbacService.getEffectivePermissions(
      outsider,
      (await userRepository.findById(outsider))?.security.permissionVersion ?? 0,
    );
    expect(effective.permissions['fleetVehicle.view']).toBe('organization');
  });

  it('resolves a name: identifier once the fallback is explicitly enabled', async () => {
    const [report] = await reconcileHrOnlyUsers(['name:Mohamed Untouched'], {
      actorId: adminId,
      allowNameIdentifiers: true,
    });
    expect(report?.outcome).toBe('reconciled');
    expect(report?.revokedAssignments).toBe(1);
  });

  it('refuses an ambiguous name rather than confining the wrong person', async () => {
    // Two accounts sharing a display name: the answer is "this name is not an identifier", never
    // whichever the query happened to return first.
    for (const suffix of ['one', 'two']) {
      const id = await createUser({
        first: 'Ambiguous',
        last: 'Twin',
        email: `ambiguous.twin.${suffix}@egycash.com.eg`,
      });
      await rbacService.ensureAssignment(id, mixedRoleId, 'organization');
    }
    const [report] = await reconcileHrOnlyUsers(['name:Ambiguous Twin'], {
      actorId: adminId,
      allowNameIdentifiers: true,
    });
    expect(report?.outcome).toBe('ambiguous');
    expect(report?.userId).toBeNull();

    for (const suffix of ['one', 'two']) {
      const doc = await userRepository.findByEmail(`ambiguous.twin.${suffix}@egycash.com.eg`);
      const effective = await rbacService.getEffectivePermissions(
        String(doc?._id),
        doc?.security.permissionVersion ?? 0,
      );
      expect(effective.permissions['fleetVehicle.view']).toBe('organization');
    }
  });

  it('leaves them holding HR permissions only — nothing outside the module', async () => {
    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      const me = await get('/auth/me', token);
      expect(me.status).toBe(200);
      const permissions = (me.body as { data: MeDto }).data.permissions;
      const modules = await rbacService.moduleIdsForPermissions(Object.keys(permissions));
      expect(
        [...new Set(modules.values())],
        `${person.email} holds permissions outside HR`,
      ).toEqual(['hr']);
    }
  });

  it('keeps the HR permissions they already had, and grants no new ones', async () => {
    // The mixed role's HR half survives; its Fleet half does not; nothing that was not already
    // theirs appears (`applicant.edit` was in the catalog but never in their role).
    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      const me = await get('/auth/me', token);
      const permissions = (me.body as { data: MeDto }).data.permissions;
      expect(Object.keys(permissions).sort()).toEqual([
        'applicant.create',
        'applicant.view',
        'employee.view',
      ]);
    }
  });

  it('is exactly the old permission set narrowed to HR — same keys, same scopes', async () => {
    // The strongest form of "only removed, never added": what they hold afterwards must equal what
    // they held before, minus everything outside HR, DOWN TO THE DATA SCOPE. A rewritten assignment
    // that quietly widened `department` to `organization` would pass a key-only check and fail here.
    for (const person of CONFINED) {
      const before = permissionsBefore.get(person.email) ?? {};
      const modules = await rbacService.moduleIdsForPermissions(Object.keys(before));
      const expected = Object.fromEntries(
        Object.entries(before).filter(([key]) => modules.get(key) === 'hr'),
      );
      expect(Object.keys(expected).length, 'the baseline should not be empty').toBeGreaterThan(0);

      const id = userIds.get(person.email) ?? '';
      const doc = await userRepository.findById(id);
      const after = await rbacService.getEffectivePermissions(
        id,
        doc?.security.permissionVersion ?? 0,
      );
      expect(after.permissions).toEqual(expected);
    }
  });

  it('confines them through a role that is NOT a system role', async () => {
    // Load-bearing: a system role would make them privileged, and a privileged account is exactly
    // the one the R13 policy forces TOTP enrollment on.
    const role = await roleRepository.findByKey(derivedHrRoleKey(mixedRoleId));
    expect(role).not.toBeNull();
    expect(role?.isSystem).toBe(false);
    const modules = await rbacService.moduleIdsForPermissions(role?.permissionKeys ?? []);
    expect([...new Set(modules.values())]).toEqual(['hr']);
  });

  it('replaces an all-HR SYSTEM role too — holding one is what makes an account privileged', async () => {
    // `employee-self-service` grants leave.view + leave.request: entirely HR, and yet keeping it
    // would leave the holder privileged and back inside the mandatory-enrollment flow. Any of these
    // four who is also an employee gets it from the Leave module's boot migration, so this is the
    // realistic case, not a contrived one.
    const ess = await roleRepository.findByKey('employee-self-service');
    expect(ess?.isSystem, 'employee-self-service should be a system role').toBe(true);

    const victimId = userIds.get(CONFINED[0]?.email ?? '') ?? '';
    await rbacService.ensureAssignment(victimId, String(ess?._id), 'organization');
    let effective = await rbacService.getEffectivePermissions(
      victimId,
      (await userRepository.findById(victimId))?.security.permissionVersion ?? 0,
    );
    expect(effective.isPrivileged, 'the system role should have made them privileged').toBe(true);

    await reconcileHrOnlyUsers([CONFINED[0]?.email ?? ''], { actorId: adminId });

    effective = await rbacService.getEffectivePermissions(
      victimId,
      (await userRepository.findById(victimId))?.security.permissionVersion ?? 0,
    );
    expect(effective.isPrivileged).toBe(false);
    // The permissions themselves survive — it is the system-ness that was dropped, not the access.
    expect(effective.permissions['leave.view']).toBe('organization');
    expect(effective.permissions['leave.request']).toBe('organization');

    const derived = await roleRepository.findByKey(derivedHrRoleKey(String(ess?._id)));
    expect(derived?.isSystem).toBe(false);
    // The whole ESS grant set, copied verbatim — AT-6 added the two attendance self-service keys
    // to that role, and the confinement's job is to drop the system-ness, never the access.
    expect(derived?.permissionKeys.sort()).toEqual([
      'attendance.requestRegularization',
      'attendance.view',
      'leave.request',
      'leave.view',
    ]);

    // And with enforcement on they still are not asked for TOTP.
    await setTotpEnforcement(true);
    const login = await doLogin(CONFINED[0]?.email ?? '');
    expect(login.body.data?.totpRequired).toBe(false);
    await setTotpEnforcement(false);
  });

  it('derives the confined role from the SOURCE role, so a narrower user cannot be widened', async () => {
    // A second mixed role with a different HR half must produce its OWN derivative — a single
    // shared role would have to hold the union, silently widening whoever held the narrower one.
    const otherRole = await rbacService.createRole(
      {
        name: { ar: 'مختلط ٢', en: 'HR (narrow) + IT' },
        permissionKeys: ['applicant.view', 'itAsset.view'],
      },
      adminId,
    );
    const narrowId = await createUser({
      first: 'Nadia',
      last: 'Narrow',
      email: 'nadia.narrow@egycash.com.eg',
    });
    await rbacService.ensureAssignment(narrowId, String(otherRole._id), 'organization');
    await reconcileHrOnlyUsers(['nadia.narrow@egycash.com.eg'], { actorId: adminId });

    const derived = await roleRepository.findByKey(derivedHrRoleKey(String(otherRole._id)));
    expect(derived?.permissionKeys.sort()).toEqual(['applicant.view']);

    // …and the four keep exactly what their own source role granted, unchanged by the above.
    const theirs = await roleRepository.findByKey(derivedHrRoleKey(mixedRoleId));
    expect(theirs?.permissionKeys.sort()).toEqual([
      'applicant.create',
      'applicant.view',
      'employee.view',
    ]);
  });

  it('is idempotent — a second run finds nothing left to change', async () => {
    const second = await reconcileHrOnlyUsers(
      CONFINED.map((p) => p.email),
      { actorId: adminId },
    );
    expect(second.every((r) => r.outcome === 'reconciled')).toBe(true);
    expect(second.every((r) => r.revokedAssignments === 0)).toBe(true);
    expect(second.every((r) => r.revokedApplications === 0)).toBe(true);
  });
});

describe('navigation shows them HR and nothing else', () => {
  it('returns only the HR category', async () => {
    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      const nav = await navigationOf(token);
      expect(
        nav.map((c) => c.name.en),
        `${person.email} sees a non-HR module`,
      ).toEqual(['HR']);
    }
  });

  it('hides the Fleet application their DEPARTMENT is granted', async () => {
    // The department grant is untouched (it belongs to the department, not to them) — it is the
    // permission filter that keeps it out of their sidebar.
    const deptApps = await departmentApplicationService.listApplications(departmentId);
    expect(deptApps.map((a) => a.route)).toContain('/fleet/vehicles');

    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      const routes = routesOf(await navigationOf(token));
      expect(routes).toContain('/applicants');
      expect(routes.some((route) => route.startsWith('/fleet'))).toBe(false);
    }
  });
});

describe('the API refuses non-HR modules for them, whatever the sidebar says', () => {
  const FORBIDDEN = [
    '/fleet/vehicles',
    '/fleet/drivers',
    '/it/assets',
    '/it/tickets',
    '/platform/users',
    '/platform/branches',
    '/platform/roles',
  ];

  it('answers 403 on a direct call to every non-HR surface', async () => {
    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      for (const path of FORBIDDEN) {
        const res = await get(path, token);
        expect(res.status, `${person.email} reached ${path}`).toBe(403);
      }
    }
  });

  it('still serves them their own HR surfaces', async () => {
    for (const person of CONFINED) {
      const token = await tokenFor(person.email);
      expect((await get('/hr/applicants', token)).status).toBe(200);
      expect((await get('/hr/employees', token)).status).toBe(200);
    }
  });
});

describe('TOTP', () => {
  // The production default, restored here on purpose: with enforcement OFF every assertion below
  // would pass for the wrong reason.
  beforeEach(async () => {
    await setTotpEnforcement(true);
  });

  it('is not required for the four — no challenge, no enrollment', async () => {
    for (const person of CONFINED) {
      const login = await doLogin(person.email);
      expect(login.status).toBe(200);
      expect(login.body.data?.totpRequired, `${person.email} was asked for TOTP`).toBe(false);
      expect(login.body.data?.enrollmentRequired ?? false).toBe(false);
      expect(login.body.data?.challengeToken).toBeUndefined();
      expect(login.body.data?.accessToken).toBeTruthy();
    }
  });

  it('is explicitly disabled on their accounts, not merely unenforced', async () => {
    for (const person of CONFINED) {
      const doc = await userRepository.findById(userIds.get(person.email) ?? '');
      expect(doc?.security.totp.required).toBe(false);
      expect(doc?.security.totp.enabled).toBe(false);
      expect(doc?.security.totp.secret).toBeNull();
    }
  });

  it('still forces enrollment on a privileged account — the policy is untouched', async () => {
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.data?.totpRequired).toBe(true);
    expect(login.body.data?.enrollmentRequired).toBe(true);
  });

  it('still honours the admin force-on flag for an ordinary user', async () => {
    // The control account kept `totp.required` from the setup — nothing about the confinement
    // relaxed TOTP for anyone else.
    const login = await doLogin(CONTROL.email);
    expect(login.status).toBe(200);
    expect(login.body.data?.totpRequired).toBe(true);
    expect(login.body.data?.enrollmentRequired).toBe(true);
  });
});

describe('the control account is untouched', () => {
  beforeEach(async () => {
    await setTotpEnforcement(false);
  });

  it('keeps its Fleet permissions and its mixed role', async () => {
    const controlId = userIds.get(CONTROL.email) ?? '';
    const doc = await userRepository.findById(controlId);
    const effective = await rbacService.getEffectivePermissions(
      controlId,
      doc?.security.permissionVersion ?? 0,
    );
    expect(effective.permissions['fleetVehicle.view']).toBe('organization');
    expect(effective.permissions['applicant.view']).toBe('organization');
  });

  it('still sees Fleet in navigation and still reaches the Fleet API', async () => {
    // Clearing the force-on flag is the only thing done to the control here — it is how the account
    // becomes loggable-in, and it is done by the test, not by the reconciliation.
    const controlId = userIds.get(CONTROL.email) ?? '';
    await userService.setTotpRequired(controlId, false);

    const token = await tokenFor(CONTROL.email);
    const nav = await navigationOf(token);
    const routes = routesOf(nav);
    expect(routes).toContain('/fleet/drivers'); // their own grant
    expect(routes).toContain('/fleet/vehicles'); // their department's grant
    expect(nav.map((c) => c.name.en)).toContain('Fleet');

    expect((await get('/fleet/vehicles', token)).status).toBe(200);
    expect((await get('/hr/applicants', token)).status).toBe(200);
  });

  it('keeps its direct application grants', async () => {
    const granted = await userApplicationService.listApplications(userIds.get(CONTROL.email) ?? '');
    expect(granted.map((a) => a.route).sort()).toEqual(['/applicants', '/fleet/drivers']);
  });
});
