// Sprint 4.2 — HR / Recruitment: Initial Screening (Stage 2) integration suite. Boots the
// HR manifest and exercises the screening lifecycle on top of Stage-1 applicants: open a
// screening (one per applicant), accumulate notes while pending (the "needs more
// information" flow, OQ-32), and decide to a single terminal outcome — Accepted or
// Rejected. A rejection transitions the applicant to the terminal `rejected` status (which
// frees the live National-ID); an acceptance leaves the applicant live. Also proves the
// `decide` permission is separate from `edit`, and permission gating. Runs against an
// in-memory Mongo replica set (MONGO_TEST_URI overrides), as in hr-recruitment.spec.ts.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let aliceToken: string; // no HR permissions
let screenerToken: string; // screening.view/create/edit but NOT screening.decide
let phoneCounter = 10_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-screening-test-${Date.now()}`;
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

const sourceIdByKey = async (key: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`source ${key} not seeded`);
  return found.id;
};

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

const registerApplicant = async (
  over: Record<string, unknown> = {},
): Promise<ApplicantDto> => {
  const sourceId = await sourceIdByKey('internalHr');
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      jobRequisitionId: REQUISITION_ID,
      sourceId,
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
      ...over,
    });
  expect(res.status).toBe(201);
  return res.body.data as ApplicantDto;
};

const openScreening = (applicantId: string, token = adminToken, note?: string) =>
  request(app)
    .post('/api/v1/hr/screenings')
    .set('Authorization', `Bearer ${token}`)
    .send(note === undefined ? { applicantId } : { applicantId, note });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  await mkUser('alice@ecms.local'); // no roles

  // A recruiter who can screen and note, but cannot make the terminal decision (OQ-32).
  const screenerRole = await rbacService.createRole(
    {
      name: { en: 'Screener', ar: 'مسؤول الفرز' },
      permissionKeys: ['screening.view', 'screening.create', 'screening.edit'],
    },
    adminId,
  );
  const screenerId = await mkUser('screener@ecms.local');
  await rbacService.ensureAssignment(screenerId, String(screenerRole._id), 'organization');

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
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
  aliceToken = await login('alice@ecms.local');
  screenerToken = await login('screener@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('screening — permissions', () => {
  it('denies a user without screening permissions', async () => {
    const denied = await request(app)
      .get('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('screening — create', () => {
  it('opens a pending screening (one per applicant) and stores an initial note', async () => {
    const applicant = await registerApplicant();
    const res = await openScreening(applicant.id, adminToken, 'looks promising');
    expect(res.status).toBe(201);
    const dto = res.body.data as ScreeningDto;
    expect(dto.status).toBe('pending');
    expect(dto.applicantId).toBe(applicant.id);
    expect(dto.applicantCode).toBe(applicant.code);
    expect(dto.decision).toBeNull();
    expect(dto.notes.map((n) => n.text)).toEqual(['looks promising']);
  });

  it('rejects a second screening for the same applicant', async () => {
    const applicant = await registerApplicant();
    expect((await openScreening(applicant.id)).status).toBe(201);
    expect((await openScreening(applicant.id)).status).toBe(409);
  });

  it('refuses to screen an applicant that is not in the active pipeline', async () => {
    const applicant = await registerApplicant();
    const withdrawn = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'not interested', version: applicant.version });
    expect(withdrawn.status).toBe(200);
    const res = await openScreening(applicant.id);
    expect(res.status).toBe(422);
  });
});

describe('screening — notes (needs more information)', () => {
  it('appends a note and stays pending', async () => {
    const applicant = await registerApplicant();
    const screening = (await openScreening(applicant.id, adminToken, 'first')).body.data as ScreeningDto;
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'requested transcripts', version: screening.version });
    expect(res.status).toBe(200);
    const dto = res.body.data as ScreeningDto;
    expect(dto.status).toBe('pending');
    expect(dto.notes.map((n) => n.text)).toEqual(['first', 'requested transcripts']);
  });
});

describe('screening — decide', () => {
  it('accepts a screening and leaves the applicant live', async () => {
    const applicant = await registerApplicant();
    const screening = (await openScreening(applicant.id)).body.data as ScreeningDto;
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    expect(res.status).toBe(200);
    expect((res.body.data as ScreeningDto).status).toBe('accepted');
    expect((res.body.data as ScreeningDto).decision?.outcome).toBe('accepted');

    const after = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('new');
  });

  it('rejects a screening, transitioning the applicant to rejected', async () => {
    const applicant = await registerApplicant();
    const screening = (await openScreening(applicant.id)).body.data as ScreeningDto;
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', reason: 'insufficient experience', version: screening.version });
    expect(res.status).toBe(200);
    expect((res.body.data as ScreeningDto).decision?.reason).toBe('insufficient experience');

    const after = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('rejected');
  });

  it('requires a reason to reject', async () => {
    const applicant = await registerApplicant();
    const screening = (await openScreening(applicant.id)).body.data as ScreeningDto;
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', version: screening.version });
    expect(res.status).toBe(400);
  });

  it('refuses to decide a screening twice', async () => {
    const applicant = await registerApplicant();
    const screening = (await openScreening(applicant.id)).body.data as ScreeningDto;
    const first = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: (first.body.data as ScreeningDto).version });
    expect(second.status).toBe(422);
  });

  it('frees the live National ID once the applicant is rejected', async () => {
    const nid = '29001011500018';
    const first = await registerApplicant({
      identity: { fullNameAr: 'خالد', nationality: 'Egyptian', nationalId: nid },
    });
    const screening = (await openScreening(first.id)).body.data as ScreeningDto;
    const decide = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', reason: 'failed screening', version: screening.version });
    expect(decide.status).toBe(200);
    // The same National ID may now be registered again (rejected is not "live").
    const reused = await registerApplicant({
      identity: { fullNameAr: 'خالد', nationality: 'Egyptian', nationalId: nid },
    });
    expect(reused.status).toBe('new');
  });
});

describe('screening — decide permission is separate from edit (OQ-32)', () => {
  it('lets a screener create and note, but not decide', async () => {
    const applicant = await registerApplicant();
    const created = await openScreening(applicant.id, screenerToken, 'screened by recruiter');
    expect(created.status).toBe(201);
    const screening = created.body.data as ScreeningDto;

    const noted = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/notes`)
      .set('Authorization', `Bearer ${screenerToken}`)
      .send({ note: 'follow-up call done', version: screening.version });
    expect(noted.status).toBe(200);

    const deniedDecide = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${screenerToken}`)
      .send({ outcome: 'accepted', version: (noted.body.data as ScreeningDto).version });
    expect(deniedDecide.status).toBe(403);

    const adminDecide = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: (noted.body.data as ScreeningDto).version });
    expect(adminDecide.status).toBe(200);
  });
});
