// The training sessions list, over real HTTP and a real database.
//
// «هنخلي كل الفلترز multi زي checkbox كدا اقدر اختار اكتر من حاجه»: the sessions screen's status takes
// several values, one comma list, ORed. The status was a union of one value or an array, and the
// comma list the screen sends answered 400 — so the claim is made where only HTTP can make it.
//
// The sessions are written through the model: the list reads their `status`, and building them
// through a course and the transition endpoints would tie this spec to rules it is not about.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type TrainingSessionDto,
  type TrainingSessionStatus,
} from '@ecms/contracts';
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
import { TrainingSessionModel } from '../../src/modules/hr/training/sessions/training-session.model';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-training-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

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
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

let seq = 0;
/** A session in `status`. The list reads its status; the rest is what the row must carry. */
const mkSession = async (status: TrainingSessionStatus): Promise<string> => {
  seq += 1;
  const doc = await TrainingSessionModel.create({
    code: `TS-LIST-${String(seq)}`,
    courseId: new Types.ObjectId(),
    courseKey: 'safety',
    courseName: { ar: 'السلامة', en: 'Safety' },
    status,
    startsAt: new Date('2026-01-10T08:00:00Z'),
    endsAt: new Date('2026-01-10T16:00:00Z'),
  });
  return String(doc._id);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('training-admin@ecms.local');
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
  adminToken = await login('training-admin@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the sessions list filters by several statuses', () => {
  it('answers each status asked about, and only those; one value still works', async () => {
    const scheduled = await mkSession('scheduled');
    const running = await mkSession('running');
    const cancelled = await mkSession('cancelled');
    const list = async (status: string): Promise<TrainingSessionDto[]> => {
      const res = await request(app)
        .get('/api/v1/hr/training/sessions')
        .query({ status, pageSize: 100 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return data<TrainingSessionDto[]>(res);
    };

    const both = await list('scheduled,running');
    expect(both.map((s) => s.id)).toEqual(expect.arrayContaining([scheduled, running]));
    expect(both.map((s) => s.id)).not.toContain(cancelled);
    for (const row of both) expect(['scheduled', 'running']).toContain(row.status);

    const one = await list('cancelled');
    expect(one.map((s) => s.id)).toEqual([cancelled]);

    const bad = await request(app)
      .get('/api/v1/hr/training/sessions')
      .query({ status: 'scheduled,nonsense' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bad.status).toBe(400);
  });
});
