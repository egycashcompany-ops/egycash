// /atm/display — how every ATM page reads, over real HTTP and real RBAC.
//
// The owner (2026-11-03): «خلى حجم الكلام فى الصفحات وإذا كان Bold أو لأ + درجة لون خطوط الجداول ..
// أقدر أتحكم فيها من /atm/settings». Pinned here: the pages read as they always did until the card
// saves; every signed-in user reads the value (it says how to draw a page, nothing about the data);
// only `atmSettings.manage` held company-wide saves it; a size, a weight or a line shade the card
// does not offer is a 400 and stores nothing; and what is saved is what every reader reads.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ATM_DEFAULT_DISPLAY,
  SettingKeys,
  platformPermissions,
  type AtmDisplaySetting,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let replenishmentToken: string; // atmReplenishment.view only — reads, never saves
let outsiderToken: string; // no ATM key at all — still reads how the pages draw
let branchHolderToken: string; // atmSettings.manage at BRANCH scope — refused the save

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-display-test-${Date.now()}`;
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
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const read = async (token: string): Promise<AtmDisplaySetting> => {
  const res = await request(app).get('/api/v1/atm/display').set('Authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmDisplaySetting>(res);
};

const save = (token: string, body: unknown) =>
  request(app)
    .put('/api/v1/atm/display')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-display-admin@ecms.local');
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
  adminToken = await login('atm-display-admin@ecms.local');

  const replenishmentRole = await rbacService.createRole(
    { name: { en: 'Repl viewer', ar: 'مشاهد التغذية' }, permissionKeys: ['atmReplenishment.view'] },
    adminId,
  );
  const replenishmentUser = await mkUser('atm-display-repl@ecms.local');
  await rbacService.ensureAssignment(
    replenishmentUser,
    String(replenishmentRole._id),
    'organization',
  );
  replenishmentToken = await login('atm-display-repl@ecms.local');

  await mkUser('atm-display-outsider@ecms.local');
  outsiderToken = await login('atm-display-outsider@ecms.local');

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holder = await mkUser('atm-display-holder@ecms.local');
  await rbacService.ensureAssignment(holder, String(settingsRole._id), 'branch');
  branchHolderToken = await login('atm-display-holder@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('how the ATM pages read', () => {
  it('reads as the pages always did until the card saves — for every signed-in user', async () => {
    expect(await read(adminToken)).toEqual(ATM_DEFAULT_DISPLAY);
    expect(await read(replenishmentToken)).toEqual(ATM_DEFAULT_DISPLAY);
    expect(await read(outsiderToken)).toEqual(ATM_DEFAULT_DISPLAY);
  });

  it('is not read without signing in', async () => {
    const res = await request(app).get('/api/v1/atm/display');
    expect(res.status).toBe(401);
  });

  it('is saved only by atmSettings.manage held company-wide', async () => {
    const chosen = { textSize: 125, bold: true, tableLines: 'strong' };
    expect((await save(replenishmentToken, chosen)).status).toBe(403);
    expect((await save(outsiderToken, chosen)).status).toBe(403);
    expect((await save(branchHolderToken, chosen)).status).toBe(403);
    expect(await read(adminToken)).toEqual(ATM_DEFAULT_DISPLAY);
  });

  it('refuses a size, a weight or a line shade the card does not offer, storing nothing', async () => {
    for (const body of [
      { textSize: 105, bold: false, tableLines: 'normal' },
      { textSize: 100, bold: 'yes', tableLines: 'normal' },
      { textSize: 100, bold: false, tableLines: 'black' },
      { textSize: 100, bold: false },
      { textSize: 100, bold: false, tableLines: 'normal', colour: 'red' },
    ]) {
      const res = await save(adminToken, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await read(adminToken)).toEqual(ATM_DEFAULT_DISPLAY);
  });

  it('answers the save with what every reader now reads', async () => {
    const chosen: AtmDisplaySetting = { textSize: 125, bold: true, tableLines: 'strong' };
    const res = await save(adminToken, chosen);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmDisplaySetting>(res)).toEqual(chosen);
    expect(await read(replenishmentToken)).toEqual(chosen);
    expect(await read(outsiderToken)).toEqual(chosen);

    // And back to how the pages were.
    expect((await save(adminToken, ATM_DEFAULT_DISPLAY)).status).toBe(200);
    expect(await read(replenishmentToken)).toEqual(ATM_DEFAULT_DISPLAY);
  });
});
