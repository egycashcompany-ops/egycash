// The performance reviews list, over real HTTP and a real database.
//
// «هنخلي كل الفلترز multi زي checkbox كدا اقدر اختار اكتر من حاجه»: the reviews screen's status takes
// several values, one comma list, ORed. The status was a union of one value or an array, and the
// comma list the screen sends answered 400 — so the claim is made where only HTTP can make it.
//
// The reviews are written through the model: the list reads their `status`, and opening them
// through a cycle would tie this spec to the materialization rules it is not about.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type PerformanceReviewDto,
  type PerformanceReviewStatus,
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
import { PerformanceReviewModel } from '../../src/modules/hr/performance/reviews/performance-review.model';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-performance-test-${Date.now()}`;
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

const CYCLE = new Types.ObjectId();
let seq = 0;
/** A review in `status`. The list reads its status; the rest is what the row must carry. */
const mkReview = async (status: PerformanceReviewStatus): Promise<string> => {
  seq += 1;
  const doc = await PerformanceReviewModel.create({
    cycleId: CYCLE,
    cycleName: { ar: 'تقييم ٢٠٢٦', en: 'Review 2026' },
    employeeId: new Types.ObjectId(),
    employeeCode: `EG-${String(5000 + seq)}`,
    employeeName: 'موظف',
    status,
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
  const adminId = await mkUser('performance-admin@ecms.local');
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
  adminToken = await login('performance-admin@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the reviews list filters by several statuses', () => {
  it('answers each status asked about, and only those; one value still works', async () => {
    const draft = await mkReview('draft');
    const submitted = await mkReview('submitted');
    const excused = await mkReview('excused');
    const list = async (status: string): Promise<PerformanceReviewDto[]> => {
      const res = await request(app)
        .get('/api/v1/hr/performance/reviews')
        .query({ status, cycleId: String(CYCLE), pageSize: 100 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return data<PerformanceReviewDto[]>(res);
    };

    const both = await list('draft,submitted');
    expect(both.map((r) => r.id).sort()).toEqual([draft, submitted].sort());

    const one = await list('excused');
    expect(one.map((r) => r.id)).toEqual([excused]);

    const bad = await request(app)
      .get('/api/v1/hr/performance/reviews')
      .query({ status: 'draft,nonsense' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bad.status).toBe(400);
  });
});
