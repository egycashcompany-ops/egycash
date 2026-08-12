// Payroll PY-1 — the pay-item catalog over HTTP.
//
// What this phase must prove is small and load-bearing: the code is a unique handle, what an item
// MEANS cannot be edited after creation, every route is behind its own key, and nothing statutory
// exists yet. The last one is a test about an ABSENCE, which is the only way a decision to not
// invent tax rules survives contact with a later contributor.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type PayItemDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let outsiderToken = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-payroll-test-${Date.now()}`;
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

const login = async (identifier: string): Promise<string> => {
  await getCache().delByPrefix('rl:');
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const post = (body: object, token = adminToken) =>
  request(app).post('/api/v1/hr/payroll/pay-items').set('Authorization', `Bearer ${token}`).send(body);
const patch = (id: string, body: object, token = adminToken) =>
  request(app)
    .patch(`/api/v1/hr/payroll/pay-items/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const get = (query = '', token = adminToken) =>
  request(app).get(`/api/v1/hr/payroll/pay-items${query}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
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
  adminToken = await login('admin@ecms.local');
  await mkUser('outsider@ecms.local');
  outsiderToken = await login('outsider@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the pay-item catalog', () => {
  let housing: PayItemDto;

  it('creates an item and normalizes its code', async () => {
    const created = await post({
      code: 'HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
    expect(created.status).toBe(201);
    housing = created.body.data as PayItemDto;
    expect(housing.code).toBe('HOUSING');
    expect(housing.status).toBe('active');
    // No amount lives on a definition — an amount belongs to an employee or a calculation.
    expect(housing).not.toHaveProperty('amount');
    expect(housing).not.toHaveProperty('taxable');
  });

  it('refuses a second live item with the same code', async () => {
    const clash = await post({
      code: 'HOUSING',
      name: { ar: 'آخر', en: 'Other' },
      kind: 'deduction',
      calcBasis: 'fixed',
    });
    expect(clash.status).toBe(409);
  });

  it('renames and re-orders, but refuses to change what the item means', async () => {
    const renamed = await patch(housing.id, {
      name: { ar: 'بدل السكن', en: 'Housing' },
      sortOrder: 50,
      version: housing.version,
    });
    expect(renamed.status).toBe(200);
    const after = renamed.body.data as PayItemDto;
    expect(after.name).toEqual({ ar: 'بدل السكن', en: 'Housing' });
    expect(after.sortOrder).toBe(50);
    housing = after;

    // The arithmetic is set once: a payslip line will cite this item, so changing its kind or
    // basis would restate history. The contract is `.strict()`, so these are 400s.
    for (const body of [{ kind: 'deduction' }, { calcBasis: 'perDay' }, { code: 'OTHER' }]) {
      const refused = await patch(housing.id, { ...body, version: housing.version });
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('archives rather than deletes, and archiving is reversible', async () => {
    const archived = await patch(housing.id, { status: 'archived', version: housing.version });
    expect(archived.status).toBe(200);
    housing = archived.body.data as PayItemDto;
    expect(housing.status).toBe('archived');

    // Still readable — history must keep naming something real.
    const listed = await get('?status=archived');
    expect((listed.body.data as PayItemDto[]).some((i) => i.id === housing.id)).toBe(true);

    const restored = await patch(housing.id, { status: 'active', version: housing.version });
    expect(restored.status).toBe(200);
    housing = restored.body.data as PayItemDto;
  });

  it('filters by kind and searches by code or name', async () => {
    await post({
      code: 'LATE_DEDUCTION',
      name: { ar: 'خصم تأخير', en: 'Late deduction' },
      kind: 'deduction',
      calcBasis: 'perMinute',
    });

    const earnings = await get('?kind=earning&status=active');
    expect(earnings.status).toBe(200);
    expect((earnings.body.data as PayItemDto[]).every((i) => i.kind === 'earning')).toBe(true);

    const searched = await get('?search=LATE');
    expect((searched.body.data as PayItemDto[]).map((i) => i.code)).toContain('LATE_DEDUCTION');
  });

  it('refuses every route to a caller without the key', async () => {
    expect((await get('', outsiderToken)).status).toBe(403);
    expect(
      (
        await post(
          { code: 'X_ITEM', name: { ar: 'س', en: 'X' }, kind: 'earning', calcBasis: 'fixed' },
          outsiderToken,
        )
      ).status,
    ).toBe(403);
    expect((await patch(housing.id, { sortOrder: 1, version: housing.version }, outsiderToken)).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .delete(`/api/v1/hr/payroll/pay-items/${housing.id}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
      ).status,
    ).toBe(403);
  });

  it('rejects a malformed code rather than storing it', async () => {
    for (const code of ['housing', '1BAD', 'WITH SPACE']) {
      const refused = await post({
        code,
        name: { ar: 'س', en: 'X' },
        kind: 'earning',
        calcBasis: 'fixed',
      });
      expect(refused.status, code).toBe(400);
    }
  });

  // PY-1 ships no run, no payslip and no statutory endpoint. Asserting the absence is what keeps
  // "taxes are out of v1" a decision rather than an oversight somebody fills in quietly.
  it('exposes no run, payslip or statutory surface yet', async () => {
    for (const path of ['/hr/payroll/runs', '/hr/payroll/payslips', '/hr/payroll/tax-rules']) {
      const res = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, path).toBe(404);
    }
  });
});
