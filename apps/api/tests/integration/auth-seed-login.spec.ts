// Regression: the seed ↔ login contract. Every seeded account is privileged, and TOTP is
// enforced for privileged accounts by default — so without the seed's dev-login convenience a
// fresh `npm run seed` would leave you unable to log in with email/password. This exercises the
// REAL seed path (`seedDevData`, imported — not a copy) and asserts a plain password login yields
// a token and a working /me. If the seed's enforcement-disable is ever removed, this fails.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingKeys, type MeDto } from '@ecms/contracts';
import { type Express } from 'express';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { env } from '../../src/infrastructure/config/env';
import { seedDevData } from '../../src/seed-data';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-seedlogin-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

interface LoginBody {
  success: boolean;
  data?: { totpRequired: boolean; accessToken?: string; me?: MeDto };
}

const doLogin = async (email: string, password: string) => {
  await getCache().delByPrefix('rl:'); // keep strict auth rate-limits out of the way
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const setCookie = res.headers['set-cookie'];
  const cookie =
    setCookie === undefined
      ? null
      : ([setCookie].flat().find((c: string) => c.startsWith('ecms_refresh=')) ?? null);
  return { status: res.status, body: res.body as LoginBody, cookie };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri() });
  app = buildApp();
  await seedDevData(); // the real seed — no external enforcement toggle
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('seed → password login (regression)', () => {
  it('the seed disables TOTP enforcement for privileged accounts at organization scope', async () => {
    const enforced = await settingsService.resolve<boolean>(SettingKeys.TotpEnforcedForPrivileged, {
      userId: null,
      branchId: null,
    });
    expect(enforced).toBe(false);
  });

  it('the seeded admin logs in with email/password and gets a token + working /me', async () => {
    const result = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.data?.totpRequired).toBe(false);
    const token = result.body.data?.accessToken ?? '';
    expect(token).toBeTruthy();
    expect(result.cookie).toContain('HttpOnly');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect((me.body as { data: MeDto }).data.permissions['user.view']).toBe('organization');
  });

  it('the seeded admin has a functional data-driven sidebar out of the box (first-run bootstrap)', async () => {
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    const token = login.body.data?.accessToken ?? '';
    const res = await request(app)
      .get('/api/v1/platform/me/applications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = (
      res.body as {
        data: { name: { en: string }; applications: { route: string }[] }[];
      }
    ).data;

    // Default categories are seeded and returned in sortOrder.
    expect(groups.map((g) => g.name.en)).toEqual(['HR', 'Organization', 'Administration']);
    // Applications map to the app's real client routes, granted directly to the admin.
    const routes = groups.flatMap((g) => g.applications.map((a) => a.route));
    expect(routes).toContain('/applicants');
    expect(routes).toContain('/organization/branches');
    expect(routes).toContain('/organization/applications');
    expect(routes).toHaveLength(15); // 7 (HR) + 6 (Organization) + 2 (Administration)
  });

  it('re-running the seed is idempotent — no duplicate categories/applications/grants', async () => {
    await seedDevData();
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    const token = login.body.data?.accessToken ?? '';
    const res = await request(app)
      .get('/api/v1/platform/me/applications')
      .set('Authorization', `Bearer ${token}`);
    const groups = (res.body as { data: { applications: unknown[] }[] }).data;
    expect(groups).toHaveLength(3);
    expect(groups.reduce((n, g) => n + g.applications.length, 0)).toBe(15);
  });

  it('the seeded HR user also logs in with email/password', async () => {
    const result = await doLogin(env.SEED_HR_EMAIL, env.SEED_HR_PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.data?.totpRequired).toBe(false);
    expect(result.body.data?.accessToken).toBeTruthy();
  });

  it('rejects a wrong password with a stable error code', async () => {
    const result = await doLogin(env.SEED_ADMIN_EMAIL, 'Definitely#Wrong1');
    expect(result.status).toBe(401);
  });
});
