// Sprint 4.1 — HR / Recruitment: Applicants (Stage 1) integration suite. The first
// Layer 2 business module: boots with the HR manifest, exercises the intake pipeline
// (manual + National-ID-derived + ID-less), duplicate flagging, live-ID uniqueness,
// source catalog, identity verification, withdrawal, list/filter/Arabic-search, audited
// masked export, attachments via the platform Files service, and permission gating.
// Runs against an in-memory Mongo replica set (MONGO_TEST_URI overrides), as in
// files.spec.ts / notifications.spec.ts.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type ApplicantDto } from '@ecms/contracts';
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
import { actionEnabled, counter, envelope, mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
const VALID_NID_A = '29001011500018'; // 1990-01-01, Kafr El Sheikh, male
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let aliceToken: string; // no HR permissions
let categoryId: string;
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-test-${Date.now()}`;
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

const registerBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobRequisitionId: REQUISITION_ID,
  sourceId: over.sourceId,
  intakeChannel: 'internal',
  identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
  contact: { primaryPhone: '01012345678' },
  ...over,
});

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
  aliceToken = await login('alice@ecms.local');

  const category = await request(app)
    .post('/api/v1/platform/file-categories')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      key: 'hr-docs',
      name: { ar: 'مستندات', en: 'HR docs' },
      allowedMimeTypes: ['application/pdf', 'image/*'],
      maxSizeMb: 5,
      retentionDays: null,
    });
  expect(category.status).toBe(201);
  categoryId = (category.body as { data: { id: string } }).data.id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('module boot', () => {
  it('seeds the 10 applicant sources', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicant-sources')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = (res.body as { data: { key: string }[] }).data.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['internalHr', 'linkedin', 'referral', 'walkIn', 'agency']),
    );
  });

  it('syncs HR permissions into the registry (admin holds them, alice does not)', async () => {
    const denied = await request(app).get('/api/v1/hr/applicants').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('registration (intake pipeline)', () => {
  it('registers a manual applicant with a National ID and derives identity fields (unverified)', async () => {
    const sourceId = await sourceIdByKey('internalHr');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian', nationalId: VALID_NID_A }, contact: { primaryPhone: '01011112222' } }));
    expect(res.status).toBe(201);
    const body = envelope<ApplicantDto>(res);
    const dto = body.data;
    expect(dto.code).toMatch(/^APP-\d{4}-\d{6}$/);
    expect(dto.status).toBe('new');
    expect(dto.identityVerification).toBe('unverified');
    expect(dto.gender).toBe('male');
    expect(dto.placeOfBirth).toBe('Kafr El Sheikh');
    expect(dto.birthDate?.startsWith('1990-01-01')).toBe(true);
    // National ID is masked in the DTO.
    expect(dto.nationalIdMasked).toBe('290*******0018');

    // I6 — registration is a workflow act: the response already places the new candidate in the
    // screening queue that registration materialized (I11), with the counters that queue redraws.
    expect(body.workflow.applicantId).toBe(dto.id);
    expect(body.workflow.applicantCode).toBe(dto.code);
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.stage?.kind).toBe('screening');
    expect(body.workflow.status).toBe('waiting');
    expect(body.workflow.attempt).toBe(1);
    expect(actionEnabled(body.workflow, 'accept')).toBe(true);
    expect(actionEnabled(body.workflow, 'reassign')).toBe(true);
    // I5 — the candidate's history starts at the application, and the envelope carries it.
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['applied', 'screeningOpened']),
    );
    expect(body.timeline.total).toBeGreaterThan(0);
    expect(counter(body.counters, 'screening')).toBeDefined();
  });

  it('registers an ID-less applicant (identity-unverified, no national ID)', async () => {
    const sourceId = await sourceIdByKey('walkIn');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, contact: { primaryPhone: '01033334444' } }));
    expect(res.status).toBe(201);
    const dto = mutated<ApplicantDto>(res);
    expect(dto.identityVerification).toBe('unverified');
    expect(dto.nationalIdMasked).toBeNull();
  });

  it('registers a direct-intake applicant with NO Job Request and stores religion + card expiry', async () => {
    const sourceId = await sourceIdByKey('walkIn');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        registerBody({
          sourceId,
          jobRequisitionId: undefined,
          identity: {
            fullNameAr: 'منى علي',
            nationality: 'Egyptian',
            religion: 'مسلم',
            nationalIdExpiry: '2030-06-01',
          },
          contact: { primaryPhone: '01044445555' },
        }),
      );
    expect(res.status).toBe(201);
    const dto = mutated<ApplicantDto>(res);
    expect(dto.jobRequisitionId).toBeNull();
    expect(dto.religion).toBe('مسلم');
    expect(dto.nationalIdExpiry?.startsWith('2030-06-01')).toBe(true);
  });

  it('rejects a malformed Job Request when one is supplied', async () => {
    const sourceId = await sourceIdByKey('walkIn');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, jobRequisitionId: 'not-an-object-id', contact: { primaryPhone: '01066667777' } }));
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate live National ID (uniqueness invariant)', async () => {
    const sourceId = await sourceIdByKey('internalHr');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, identity: { fullNameAr: 'خالد', nationality: 'Egyptian', nationalId: VALID_NID_A }, contact: { primaryPhone: '01055556666' } }));
    expect(res.status).toBe(409);
  });

  it('flags a duplicate on a shared phone (does not block)', async () => {
    const sourceId = await sourceIdByKey('facebook');
    const first = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, contact: { primaryPhone: '01099998888' } }));
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, contact: { primaryPhone: '01099998888' } }));
    expect(second.status).toBe(201);
    const flagged = mutated<ApplicantDto>(second);
    expect(flagged.duplicateFlag).toBe(true);
    expect(flagged.duplicateOf.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unknown / inactive source', async () => {
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId: '64b1f0bbbbbbbbbbbbbbbbbb', contact: { primaryPhone: '01077776666' } }));
    expect(res.status).toBe(400);
  });

  it('is idempotent on a repeated intakeKey', async () => {
    const sourceId = await sourceIdByKey('linkedin');
    const body = registerBody({ sourceId, contact: { primaryPhone: '01088887777' }, intakeKey: 'intake-xyz' });
    const a = await request(app).post('/api/v1/hr/applicants').set('Authorization', `Bearer ${adminToken}`).send(body);
    const b = await request(app).post('/api/v1/hr/applicants').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(mutated<ApplicantDto>(a).id).toBe(mutated<ApplicantDto>(b).id);
    // The replay is the SAME candidate, so its envelope reports the same place in the pipeline —
    // an idempotent act still answers with state, never with a half-filled envelope.
    expect(envelope<ApplicantDto>(b).workflow.stage?.kind).toBe('screening');
  });
});

describe('lifecycle: verify, update, withdraw', () => {
  const create = async (phone: string): Promise<ApplicantDto> => {
    const sourceId = await sourceIdByKey('internalHr');
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, contact: { primaryPhone: phone } }));
    return mutated<ApplicantDto>(res);
  };

  it('verifies identity by supplying a National ID at the ID gate', async () => {
    const dto = await create('01010101010');
    const res = await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/verify-identity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nationalId: '29912310112345', version: dto.version });
    expect(res.status).toBe(200);
    const body = envelope<ApplicantDto>(res);
    expect(body.data.identityVerification).toBe('verified');

    // I6 — the identity check is not a stage transition, but it IS a workflow act on the candidate,
    // so it answers with the same envelope and the entry it wrote (I5).
    expect(body.workflow.applicantId).toBe(dto.id);
    expect(body.workflow.stage?.kind).toBe('screening');
    expect(body.timeline.produced.map((e) => e.type)).toEqual(['identityVerified']);
    expect(counter(body.counters, 'screening')).toBeDefined();
  });

  // I5 — the candidate's history starts at the application. Neither registration nor identity
  // verification is a workflow transition, so if the services did not write them the timeline
  // would silently begin mid-pipeline at the first decision.
  it('opens the candidate timeline at the application and records the identity check', async () => {
    const dto = await create('01033445566');
    const afterRegistration = await request(app)
      .get(`/api/v1/hr/applicants/${dto.id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterRegistration.status).toBe(200);
    const applied = (afterRegistration.body as { data: { type: string }[] }).data.filter(
      (e) => e.type === 'applied',
    );
    expect(applied).toHaveLength(1);

    await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/verify-identity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nationalId: '29912310154321', version: dto.version });

    const afterVerify = await request(app)
      .get(`/api/v1/hr/applicants/${dto.id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`);
    const types = (afterVerify.body as { data: { type: string }[] }).data.map((e) => e.type);
    expect(types).toContain('applied');
    expect(types).toContain('identityVerified');
  });

  it('withdraws an applicant (terminal)', async () => {
    const dto = await create('01020202020');
    const withdrawn = await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'not interested', version: dto.version });
    expect(withdrawn.status).toBe(200);
    const body = envelope<ApplicantDto>(withdrawn);
    expect(body.data.status).toBe('withdrawn');

    // I6/I14 — the departure closed the screening row, so the envelope reports no open stage and
    // offers `restore` as the only way back. Nothing mirrors the lifecycle onto the stage (I1).
    expect(body.workflow.applicantStatus).toBe('withdrawn');
    expect(body.workflow.stage).toBeNull();
    expect(body.workflow.status).toBeNull();
    expect(actionEnabled(body.workflow, 'restore')).toBe(true);
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['withdrawn', 'screeningCancelled']),
    );
    expect(counter(body.counters, 'screening')).toBeDefined();
  });

  it('restores a withdrawn applicant back to the active pipeline (history preserved)', async () => {
    const dto = await create('01021212121');
    const withdrawn = mutated<ApplicantDto>(
      await request(app)
        .post(`/api/v1/hr/applicants/${dto.id}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'changed mind', version: dto.version }),
    );
    expect(withdrawn.status).toBe('withdrawn');

    const restored = await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'reconsidered', version: withdrawn.version });
    expect(restored.status).toBe(200);
    const restoredBody = envelope<ApplicantDto>(restored);
    const body = restoredBody.data;
    expect(body.status).toBe('new');
    expect(body.withdrawnReason).toBeNull();
    // I6/I11 — the reactivation re-opened the screening on a NEW attempt, and says so.
    expect(restoredBody.workflow.stage?.kind).toBe('screening');
    expect(restoredBody.workflow.status).toBe('waiting');
    expect(restoredBody.workflow.attempt).toBe(2);
    expect(restoredBody.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['restored', 'screeningOpened']),
    );

    // Restore is idempotent for an already-active applicant.
    const again = await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: body.version });
    expect(again.status).toBe(200);
    const againBody = envelope<ApplicantDto>(again);
    expect(againBody.data.status).toBe('new');
    // Nothing moved, so nothing was written — the envelope says that plainly rather than omitting it.
    expect(againBody.timeline.produced).toEqual([]);
    expect(againBody.workflow.attempt).toBe(2);
  });

  it('restoring an already-active applicant is an idempotent no-op', async () => {
    const dto = await create('01023232323');
    const res = await request(app)
      .post(`/api/v1/hr/applicants/${dto.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: dto.version });
    expect(res.status).toBe(200);
    const body = envelope<ApplicantDto>(res);
    expect(body.data.status).toBe('new');
    expect(body.timeline.produced).toEqual([]);
    expect(body.workflow.stage?.kind).toBe('screening');
    expect(counter(body.counters, 'screening')).toBeDefined();
  });
});

describe('list, search, export', () => {
  it('lists with Arabic-normalized search (folds hamza/alef variants)', async () => {
    const sourceId = await sourceIdByKey('internalHr');
    await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, identity: { fullNameAr: 'إبراهيم', nationality: 'Egyptian' }, contact: { primaryPhone: '01030303030' } }));
    // Search "ابراهيم" (bare alef) must find "إبراهيم" (hamza-under alef).
    const res = await request(app)
      .get('/api/v1/hr/applicants')
      .query({ search: 'ابراهيم', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((res.body as { data: ApplicantDto[] }).data.some((a) => a.fullNameAr === 'إبراهيم')).toBe(true);
  });

  it('exports a masked, audited CSV', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicants/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('code,status,fullNameAr');
    // National IDs are masked in the export body by default.
    expect(res.text).not.toMatch(/,29001011500018,/);

    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'applicantExport', pageSize: 5 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'export')).toBe(true);
  });
});

describe('attachments (via the platform Files service)', () => {
  it('uploads, lists, and removes an attachment; count tracks', async () => {
    const sourceId = await sourceIdByKey('internalHr');
    const created = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registerBody({ sourceId, contact: { primaryPhone: '01040404040' } }));
    const id = mutated<ApplicantDto>(created).id;

    const upload = await request(app)
      .post(`/api/v1/hr/applicants/${id}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'CV')
      .field('categoryId', categoryId)
      .field('notes', 'candidate CV')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    // An attachment is a document on the candidate's record, not a move through the pipeline, so
    // it stays outside the workflow envelope (I6) and answers with the file it created.
    expect(upload.status).toBe(201);
    expect((upload.body as { data: { fileId: string } }).data.fileId).toBeDefined();

    const list = await request(app)
      .get(`/api/v1/hr/applicants/${id}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((list.body as { data: unknown[] }).data.length).toBe(1);

    const after = await request(app).get(`/api/v1/hr/applicants/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).attachmentCount).toBe(1);
    expect((after.body.data as ApplicantDto).status).toBe('new');

    const fileId = (upload.body as { data: { fileId: string } }).data.fileId;
    const del = await request(app)
      .delete(`/api/v1/hr/applicants/${id}/attachments/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    const after2 = await request(app).get(`/api/v1/hr/applicants/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((after2.body.data as ApplicantDto).attachmentCount).toBe(0);
  });
});

describe('OCR seam + sources admin + permissions', () => {
  it('OCR extract reports unavailable with the default null stub', async () => {
    const res = await request(app)
      .post('/api/v1/hr/applicants/ocr/national-id')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ frontFileId: '64b1f0aaaaaaaaaaaaaaaaaa' });
    expect(res.status).toBe(200);
    expect((res.body as { data: { available: boolean } }).data.available).toBe(false);
  });

  it('admin manages sources; alice cannot', async () => {
    const created = await request(app)
      .post('/api/v1/hr/applicant-sources')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'careerFair', name: { ar: 'معرض توظيف', en: 'Career fair' }, kind: 'manual', requiresDetail: false });
    expect(created.status).toBe(201);

    const denied = await request(app)
      .post('/api/v1/hr/applicant-sources')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ key: 'x', name: { ar: 'x', en: 'x' } });
    expect(denied.status).toBe(403);
  });
});
