// What the Administrative Affairs suites share (design §19.8): a real mongo booted with every
// module, as production boots; two branches; and signed-in people with exactly the grants a case
// needs — the whole register at organization scope, the catalog key held only in branch A (which
// OD-04 A turns away from every master-data write), and someone holding no key of this module.
// Written once, so each suite states its cases and not its plumbing; the warehouse and supplier
// suites add their people here as they ship.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { expect } from 'vitest';
import { SettingKeys, platformPermissions } from '@ecms/contracts';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { buildApp } from '../../../src/app';
import { moduleManifests } from '../../../src/modules';
import { administrationPermissions } from '../../../src/modules/administration/administration.module';
import { rbacService } from '../../../src/platform/rbac';
import { userService } from '../../../src/platform/users';
import { settingsService } from '../../../src/platform/settings';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

export interface AdministrationWorld {
  app: Express;
  branchAId: string;
  branchBId: string;
  /** Super-admin: every key, organization-wide. */
  adminToken: string;
  /** `administrationCatalog.manage` at organization scope — the master-data desk. */
  managerToken: string;
  /** `administrationCatalog.manage` at BRANCH scope, placed in branch A. */
  branchManagerToken: string;
  /** Signed in, with a key of another module only. */
  outsiderToken: string;
}

let replSet: MongoMemoryReplSet | null = null;

const resolveMongoUri = async (label: string): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-administration-${label}-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** One response's `data`. */
export const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

/** One refusal's code and details, as the error handler sends them. */
export const refusal = (
  res: request.Response,
): { code: string; details?: { field?: string; code: string }[] } =>
  (res.body as { error: { code: string; details?: { field?: string; code: string }[] } }).error;

/** The module's routes, as one person calls them. */
export const administrationApi = (app: Express, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/administration${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/administration${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body),
  patch: (path: string, body: Record<string, unknown>) =>
    request(app)
      .patch(`/api/v1/administration${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body),
});

export const bootAdministration = async (label: string): Promise<AdministrationWorld> => {
  await bootPlatform({ mongoUri: await resolveMongoUri(label), modules: moduleManifests });
  const app = buildApp();

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
  const login = async (email: string): Promise<string> => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  };

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...administrationPermissions].map((p) => p.key),
  );
  const adminId = await mkUser(`administration-${label}-admin@ecms.local`);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  // The seeded admin is privileged; a second factor is not what these suites test.
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
  const adminToken = await login(`administration-${label}-admin@ecms.local`);

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  const branchAId = await mkBranch('80', 'فرع أ', 'Branch A');
  const branchBId = await mkBranch('81', 'فرع ب', 'Branch B');

  const person = async (
    who: string,
    permissionKeys: string[],
    scope: 'organization' | 'branch',
    branchId: string | null,
  ): Promise<string> => {
    const role = await rbacService.createRole(
      { name: { en: `Administration ${who}`, ar: `الشئون الإدارية ${who}` }, permissionKeys },
      adminId,
    );
    const email = `administration-${label}-${who}@ecms.local`;
    const id = await mkUser(email, branchId);
    await rbacService.ensureAssignment(id, String(role._id), scope);
    return login(email);
  };

  return {
    app,
    branchAId,
    branchBId,
    adminToken,
    managerToken: await person('manager', ['administrationCatalog.manage'], 'organization', null),
    branchManagerToken: await person(
      'branch-manager',
      ['administrationCatalog.manage'],
      'branch',
      branchAId,
    ),
    outsiderToken: await person('outsider', ['itVendor.view'], 'organization', null),
  };
};

export const stopAdministration = async (): Promise<void> => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
  replSet = null;
};
