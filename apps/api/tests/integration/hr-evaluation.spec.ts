// Evaluation phases (post-interview checks) integration suite. Boots the HR manifest and exercises
// the evaluation-phase engine: the seeded phase catalog, opening an applicant's evaluation, file
// attach/remove, the approve/reject decision (reason gate), the reject → applicant-leaves-pipeline
// hook, decision editability, and the admin-configurable (extensible) catalog.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EvaluationDto,
  type EvaluationPhaseDto,
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
let adminToken: string;
let aliceToken: string;
let phoneCounter = 60_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-eval-test-${Date.now()}`;
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

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

const sourceId = async (): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === 'internalHr');
  if (found === undefined) throw new Error('internalHr source not seeded');
  return found.id;
};

const registerApplicant = async (): Promise<ApplicantDto> => {
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      jobRequisitionId: REQUISITION_ID,
      sourceId: await sourceId(),
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  return res.body.data as ApplicantDto;
};

const phases = async (): Promise<EvaluationPhaseDto[]> => {
  const res = await request(app)
    .get('/api/v1/hr/evaluation-phases')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return (res.body as { data: EvaluationPhaseDto[] }).data;
};

const phaseByKey = async (key: string): Promise<EvaluationPhaseDto> => {
  const found = (await phases()).find((p) => p.key === key);
  if (found === undefined) throw new Error(`phase ${key} not seeded`);
  return found;
};

const open = (applicantId: string, phaseId: string) =>
  request(app)
    .post('/api/v1/hr/evaluations')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ applicantId, phaseId });

const decide = (id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/v1/hr/evaluations/${id}/decision`).set('Authorization', `Bearer ${adminToken}`).send(body);

const applicantStatus = async (id: string): Promise<string> => {
  const res = await request(app).get(`/api/v1/hr/applicants/${id}`).set('Authorization', `Bearer ${adminToken}`);
  return (res.body.data as ApplicantDto).status;
};

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
  await mkUser('alice@ecms.local');

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
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });

  adminToken = await login('admin@ecms.local');
  aliceToken = await login('alice@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('evaluation phases — seeded catalog & permissions', () => {
  it('seeds Security Check / Medical Examination / Driving Test in order', async () => {
    const list = await phases();
    const keys = list.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['securityCheck', 'medicalExam', 'drivingTest']));
    const security = list.find((p) => p.key === 'securityCheck');
    const driving = list.find((p) => p.key === 'drivingTest');
    expect(security?.order).toBe(1);
    expect(driving?.driversOnly).toBe(true);
  });

  it('denies a user without evaluation.view', async () => {
    const denied = await request(app).get('/api/v1/hr/evaluations').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('evaluations — open, files, decision', () => {
  it('opens a pending evaluation (idempotent) and attaches then removes a file', async () => {
    const applicant = await registerApplicant();
    const phase = await phaseByKey('securityCheck');

    const opened = await open(applicant.id, phase.id);
    expect(opened.status).toBe(201);
    const evaluation = opened.body.data as EvaluationDto;
    expect(evaluation.status).toBe('pending');
    expect(evaluation.files).toHaveLength(0);

    // Idempotent: opening the same (applicant, phase) returns the same record.
    const again = await open(applicant.id, phase.id);
    expect((again.body.data as EvaluationDto).id).toBe(evaluation.id);

    const uploaded = await request(app)
      .post(`/api/v1/hr/evaluations/${evaluation.id}/files`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(evaluation.version))
      .attach('file', Buffer.from('%PDF-1.4 security clearance'), {
        filename: 'clearance.pdf',
        contentType: 'application/pdf',
      });
    expect(uploaded.status).toBe(201);
    const withFile = uploaded.body.data as EvaluationDto;
    expect(withFile.files).toHaveLength(1);

    const removed = await request(app)
      .delete(`/api/v1/hr/evaluations/${evaluation.id}/files/${withFile.files[0]!.fileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: withFile.version });
    expect(removed.status).toBe(200);
    expect((removed.body.data as EvaluationDto).files).toHaveLength(0);
  });

  it('requires a reason to reject, removes the applicant from the pipeline, and stays editable', async () => {
    const applicant = await registerApplicant();
    const phase = await phaseByKey('medicalExam');
    const evaluation = (await open(applicant.id, phase.id)).body.data as EvaluationDto;

    // Missing reason → request-schema validation failure (400).
    expect((await decide(evaluation.id, { decision: 'rejected', version: evaluation.version })).status).toBe(400);

    const rejected = await decide(evaluation.id, { decision: 'rejected', reason: 'failed medical', version: evaluation.version });
    expect(rejected.status).toBe(200);
    expect((rejected.body.data as EvaluationDto).status).toBe('rejected');
    // Reject removes the applicant from the active pipeline.
    expect(await applicantStatus(applicant.id)).toBe('rejected');

    // The decision is editable: correcting to approved re-decides the same record.
    const corrected = await decide(evaluation.id, {
      decision: 'approved',
      version: (rejected.body.data as EvaluationDto).version,
    });
    expect(corrected.status).toBe(200);
    expect((corrected.body.data as EvaluationDto).status).toBe('approved');
  });
});

describe('evaluation phases — extensible catalog', () => {
  it('lets an admin add a new phase and rejects an active order clash', async () => {
    const created = await request(app)
      .post('/api/v1/hr/evaluation-phases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'referenceCheck', name: { en: 'Reference Check', ar: 'التحقق من المراجع' }, order: 9 });
    expect(created.status).toBe(201);
    expect((created.body.data as EvaluationPhaseDto).order).toBe(9);

    const clash = await request(app)
      .post('/api/v1/hr/evaluation-phases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'another', name: { en: 'Another', ar: 'أخرى' }, order: 1 });
    expect(clash.status).toBe(409);
  });
});
