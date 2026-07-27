// Evaluation batch integration suite (RW8/RW8b/RW8c). Boots the HR manifest and exercises the
// group form of the external checks: drafting from the phase's waiting queue, membership rules,
// issue (which freezes membership and queues the package), returning results, deciding items
// through the underlying evaluation record, void, close and cancel.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type BatchCandidateDto,
  type BulkActionResultDto,
  type EvaluationBatchDto,
  type EvaluationBatchSummaryDto,
  type EvaluationDto,
  type EvaluationPhaseDto,
  type InterviewDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { buildEvaluationBatchPackage } from '../../src/modules/hr/recruitment/evaluation-batches';
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
let medicToken: string;
let interviewerId: string;
let interviewerToken: string;
let phoneCounter = 70_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-batch-test-${Date.now()}`;
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

const phaseByKey = async (key: string): Promise<EvaluationPhaseDto> => {
  const res = await request(app)
    .get('/api/v1/hr/evaluation-phases')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: EvaluationPhaseDto[] }).data.find((p) => p.key === key);
  if (found === undefined) throw new Error(`phase ${key} not seeded`);
  return found;
};

const stageId = async (key: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/interview-stages')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`stage ${key} not seeded`);
  return found.id;
};

const passStage = async (applicantId: string, key: string): Promise<void> => {
  const interview = (
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        applicantId,
        stageId: await stageId(key),
        scheduledAt: '2027-03-01T00:00:00.000Z',
        interviewerIds: [interviewerId],
      })
  ).body.data as InterviewDto;
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: interview.version });
  await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'passed', version: (submitted.body.data as InterviewDto).version });
};

/** An applicant who has cleared screening + both interview rounds — sitting in the phase queues. */
const readyApplicant = async (): Promise<ApplicantDto> => {
  const registered = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      jobRequisitionId: REQUISITION_ID,
      sourceId: await sourceId(),
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(registered.status).toBe(201);
  const applicant = registered.body.data as ApplicantDto;
  const screening = (
    await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id })
  ).body.data as ScreeningDto;
  await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  await passStage(applicant.id, 'firstInterview');
  await passStage(applicant.id, 'secondInterview');
  return applicant;
};

const createBatch = async (applicantIds: string[], title = 'دفعة'): Promise<EvaluationBatchDto> => {
  const phase = await phaseByKey('securityCheck');
  const res = await request(app)
    .post('/api/v1/hr/evaluation-batches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ phaseId: phase.id, title, applicantIds });
  expect(res.status).toBe(201);
  return res.body.data as EvaluationBatchDto;
};

const issue = async (batch: EvaluationBatchDto): Promise<EvaluationBatchDto> => {
  const res = await request(app)
    .post(`/api/v1/hr/evaluation-batches/${batch.id}/issue`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: batch.version });
  expect(res.status).toBe(200);
  return res.body.data as EvaluationBatchDto;
};

const getBatch = async (id: string): Promise<EvaluationBatchDto> => {
  const res = await request(app)
    .get(`/api/v1/hr/evaluation-batches/${id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as EvaluationBatchDto;
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

  // RW7 — a company doctor sees the medical phase only; the security batch must stay closed to them.
  const medicRole = await rbacService.createRole(
    { name: { en: 'Doctor', ar: 'طبيب' }, permissionKeys: ['medicalCheck.view', 'medicalCheck.manage'] },
    adminId,
  );
  const medicId = await mkUser('doctor@ecms.local');
  await rbacService.ensureAssignment(medicId, String(medicRole._id), 'organization');

  const panelRole = await rbacService.createRole(
    { name: { en: 'Interviewer', ar: 'مُحاور' }, permissionKeys: ['interview.view', 'interview.evaluate'] },
    adminId,
  );
  interviewerId = await mkUser('interviewer@ecms.local');
  await rbacService.ensureAssignment(interviewerId, String(panelRole._id), 'organization');

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
  medicToken = await login('doctor@ecms.local');
  interviewerToken = await login('interviewer@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('batch candidates', () => {
  it('lists applicants waiting at the phase and drops the ones already batched', async () => {
    const applicant = await readyApplicant();
    const phase = await phaseByKey('securityCheck');

    const before = await request(app)
      .get('/api/v1/hr/evaluation-batches/candidates')
      .query({ phaseId: phase.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    const pool = before.body.data as BatchCandidateDto[];
    expect(pool.map((c) => c.applicantId)).toContain(applicant.id);

    await createBatch([applicant.id]);

    const after = await request(app)
      .get('/api/v1/hr/evaluation-batches/candidates')
      .query({ phaseId: phase.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as BatchCandidateDto[]).map((c) => c.applicantId)).not.toContain(applicant.id);
  });

  it('refuses a phase the caller cannot manage (RW7)', async () => {
    const phase = await phaseByKey('securityCheck');
    const denied = await request(app)
      .get('/api/v1/hr/evaluation-batches/candidates')
      .query({ phaseId: phase.id })
      .set('Authorization', `Bearer ${medicToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('drafting a batch', () => {
  it('allocates a SEC code, opens each evaluation and stamps the batch on it', async () => {
    const applicant = await readyApplicant();
    const batch = await createBatch([applicant.id], 'دفعة يوليو');

    expect(batch.code).toMatch(/^SEC-\d{4}-\d{6}$/);
    expect(batch.status).toBe('draft');
    expect(batch.counts).toMatchObject({ total: 1, pending: 1, approved: 0, rejected: 0, voided: 0 });
    const item = batch.items[0]!;
    expect(item.applicantId).toBe(applicant.id);
    // I1 — the item drives the applicant's ordinary evaluation record, it does not replace it.
    const evaluation = await request(app)
      .get(`/api/v1/hr/evaluations/${item.evaluationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(evaluation.status).toBe(200);
    expect((evaluation.body.data as EvaluationDto).batchCode).toBe(batch.code);
    expect((evaluation.body.data as EvaluationDto).status).toBe('waiting');
  });

  it('never lists a national id unmasked', async () => {
    const applicant = await readyApplicant();
    const batch = await createBatch([applicant.id]);
    const masked = batch.items[0]!.nationalIdMasked;
    expect(masked === null || masked.includes('*')).toBe(true);
  });

  it('refuses an individual phase — Medical Check is never batched (RW9)', async () => {
    const applicant = await readyApplicant();
    const medical = await phaseByKey('medicalExam');
    const res = await request(app)
      .post('/api/v1/hr/evaluation-batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phaseId: medical.id, applicantIds: [applicant.id] });
    expect(res.status).toBe(422);
  });

  it('refuses a selection where nobody is eligible', async () => {
    const applicant = await readyApplicant();
    await createBatch([applicant.id]);
    const phase = await phaseByKey('securityCheck');
    // The same applicant is already held by an open batch of this phase.
    const again = await request(app)
      .post('/api/v1/hr/evaluation-batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phaseId: phase.id, applicantIds: [applicant.id] });
    expect(again.status).toBe(422);
  });

  it('adds and removes members while the batch is a draft', async () => {
    const [a, b] = [await readyApplicant(), await readyApplicant()];
    const batch = await createBatch([a.id]);

    const added = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${batch.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [b.id], version: batch.version });
    expect(added.status).toBe(200);
    expect((added.body.data as EvaluationBatchDto).counts.total).toBe(2);

    const removed = await request(app)
      .delete(`/api/v1/hr/evaluation-batches/${batch.id}/items/${b.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (added.body.data as EvaluationBatchDto).version });
    expect(removed.status).toBe(200);
    expect((removed.body.data as EvaluationBatchDto).counts.total).toBe(1);
  });
});

describe('issuing a batch', () => {
  it('freezes membership, stamps sentAt and queues the package', async () => {
    const applicant = await readyApplicant();
    const other = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    expect(issued.status).toBe('issued');
    expect(issued.issuedAt).not.toBeNull();
    expect(issued.sentAt).not.toBeNull();
    expect(issued.package.status).toBe('queued');

    const late = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [other.id], version: issued.version });
    expect(late.status).toBe(422);

    const removal = await request(app)
      .delete(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: issued.version });
    expect(removal.status).toBe(422);
  });

  it('refuses to issue an empty draft', async () => {
    const applicant = await readyApplicant();
    const batch = await createBatch([applicant.id]);
    const emptied = await request(app)
      .delete(`/api/v1/hr/evaluation-batches/${batch.id}/items/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: batch.version });
    const res = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${batch.id}/issue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (emptied.body.data as EvaluationBatchDto).version });
    expect(res.status).toBe(422);
  });

  it('builds a package the batch can still use when the PDF driver is disabled (RW8b)', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    // The worker job runs inline here — in production it is dispatched from the outbox.
    await buildEvaluationBatchPackage(issued.id);

    const built = await getBatch(issued.id);
    expect(built.package.status).toBe('ready');
    // No CHROMIUM_PATH in CI: the ZIP still exists, the missing list.pdf is reported.
    expect(built.package.archiveFileId).not.toBeNull();
    if (built.package.listPdfFileId === null) expect(built.package.error).not.toBeNull();
  });
});

describe('returning results and deciding items (RW8c)', () => {
  it('stamps returnedAt on the first upload and attributes a per-applicant document', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    const uploaded = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/results`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(issued.version))
      .field('applicantId', applicant.id)
      .attach('file', Buffer.from('%PDF-1.4 clearance'), {
        filename: 'clearance.pdf',
        contentType: 'application/pdf',
      });
    expect(uploaded.status).toBe(201);
    const withResult = uploaded.body.data as EvaluationBatchDto;
    expect(withResult.returnedAt).not.toBeNull();
    expect(withResult.returnedDocuments).toHaveLength(1);
    expect(withResult.items[0]!.resultFileId).not.toBeNull();
  });

  it('decides the item THROUGH the evaluation record (I1)', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));
    const evaluationId = issued.items[0]!.evaluationId;

    const decided = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'approved', version: issued.version });
    expect(decided.status).toBe(200);
    const after = decided.body.data as EvaluationBatchDto;
    expect(after.items[0]!.result).toBe('approved');
    expect(after.counts).toMatchObject({ pending: 0, approved: 1 });

    const evaluation = await request(app)
      .get(`/api/v1/hr/evaluations/${evaluationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((evaluation.body.data as EvaluationDto).status).toBe('approved');
  });

  it('requires a reason to reject, and a rejection removes the applicant from the pipeline', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    const noReason = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'rejected', version: issued.version });
    // The reason gate lives in the schema, so a missing one is a validation failure, not a
    // business-rule refusal.
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'rejected', reason: 'تحريات سلبية', version: issued.version });
    expect(rejected.status).toBe(200);

    const profile = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((profile.body.data as ApplicantDto).status).toBe('rejected');
  });

  it('voids an item without deleting it, and a voided item can no longer be decided', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    const voided = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'انسحب المرشح', version: issued.version });
    expect(voided.status).toBe(200);
    const after = voided.body.data as EvaluationBatchDto;
    // Nothing is removed, ever — the item stays with its reason.
    expect(after.items).toHaveLength(1);
    expect(after.items[0]!.result).toBe('voided');
    expect(after.items[0]!.reason).toBe('انسحب المرشح');
    expect(after.counts).toMatchObject({ total: 1, voided: 1, pending: 0 });

    const late = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'approved', version: after.version });
    expect(late.status).toBe(422);
  });

  it('bulk approves a selection and reports partial success per item', async () => {
    const [a, b] = [await readyApplicant(), await readyApplicant()];
    const issued = await issue(await createBatch([a.id, b.id]));

    const res = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/items/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', ids: [a.id, b.id, '64b1f0aaaaaaaaaaaaaaaaab'] });
    expect(res.status).toBe(200);
    const envelope = res.body.data as BulkActionResultDto;
    expect(envelope.requested).toBe(3);
    expect(envelope.succeeded).toBe(2);
    expect(envelope.failed).toBe(1);

    expect((await getBatch(issued.id)).counts).toMatchObject({ approved: 2, pending: 0 });
  });
});

describe('closing and cancelling', () => {
  it('refuses to close while an item is still pending, then closes once every item is decided', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));

    const early = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: issued.version });
    expect(early.status).toBe(422);

    const decided = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'approved', version: issued.version });

    const closed = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${issued.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (decided.body.data as EvaluationBatchDto).version });
    expect(closed.status).toBe(200);
    expect((closed.body.data as EvaluationBatchDto).status).toBe('closed');
  });

  it('cancels with a reason, keeps the record, and returns the candidate to the queue', async () => {
    const applicant = await readyApplicant();
    const phase = await phaseByKey('securityCheck');
    const batch = await createBatch([applicant.id]);

    const cancelled = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${batch.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'أُلغيت الجولة', version: batch.version });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.data as EvaluationBatchDto).status).toBe('cancelled');
    expect((cancelled.body.data as EvaluationBatchDto).cancelledReason).toBe('أُلغيت الجولة');

    // A cancelled batch is kept forever, and its members are selectable again.
    const list = await request(app)
      .get('/api/v1/hr/evaluation-batches')
      .query({ pageSize: 100, status: 'cancelled' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((list.body.data as EvaluationBatchSummaryDto[]).map((b) => b.id)).toContain(batch.id);

    const pool = await request(app)
      .get('/api/v1/hr/evaluation-batches/candidates')
      .query({ phaseId: phase.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((pool.body.data as BatchCandidateDto[]).map((c) => c.applicantId)).toContain(applicant.id);
  });

  it('a closed batch can no longer be changed', async () => {
    const applicant = await readyApplicant();
    const issued = await issue(await createBatch([applicant.id]));
    const decided = await request(app)
      .patch(`/api/v1/hr/evaluation-batches/${issued.id}/items/${applicant.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'approved', version: issued.version });
    const closed = (
      await request(app)
        .post(`/api/v1/hr/evaluation-batches/${issued.id}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ version: (decided.body.data as EvaluationBatchDto).version })
    ).body.data as EvaluationBatchDto;

    const res = await request(app)
      .post(`/api/v1/hr/evaluation-batches/${closed.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'متأخر', version: closed.version });
    expect(res.status).toBe(422);
  });
});

describe('batch list and access', () => {
  it('lists batches and hides the security phase from a caller who only sees medical (RW7)', async () => {
    const applicant = await readyApplicant();
    const batch = await createBatch([applicant.id]);

    const mine = await request(app)
      .get('/api/v1/hr/evaluation-batches')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(mine.status).toBe(200);
    expect((mine.body.data as EvaluationBatchSummaryDto[]).map((b) => b.id)).toContain(batch.id);

    const denied = await request(app)
      .get(`/api/v1/hr/evaluation-batches/${batch.id}`)
      .set('Authorization', `Bearer ${medicToken}`);
    expect(denied.status).toBe(403);
  });

  it('keeps another phase out of an UNFILTERED list — one collection, per-phase sight', async () => {
    const applicant = await readyApplicant();
    const batch = await createBatch([applicant.id]);

    const theirs = await request(app)
      .get('/api/v1/hr/evaluation-batches')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${medicToken}`);
    expect(theirs.status).toBe(200);
    expect((theirs.body.data as EvaluationBatchSummaryDto[]).map((b) => b.id)).not.toContain(batch.id);
  });

  it('refuses a phase filter the caller cannot view', async () => {
    const phase = await phaseByKey('securityCheck');
    const denied = await request(app)
      .get('/api/v1/hr/evaluation-batches')
      .query({ phaseId: phase.id })
      .set('Authorization', `Bearer ${medicToken}`);
    expect(denied.status).toBe(403);
  });
});
