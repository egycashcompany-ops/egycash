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
  type BulkActionResultDto,
  type EvaluationDto,
  type RecruitmentStageCountsDto,
  type RecruitmentTimelineEntryDto,
  type ReturnToStagePreviewDto,
  type EvaluationPhaseDto,
  type InterviewDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { migrateRecruitmentWorkflow } from '../../src/modules/hr/recruitment/recruitment.migration';
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
let interviewerId: string;
let interviewerToken: string;
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

const stageId = async (key: string): Promise<string> => {
  const res = await request(app).get('/api/v1/hr/interview-stages').query({ pageSize: 50 }).set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`stage ${key} not seeded`);
  return found.id;
};

const passStage = async (applicantId: string, key: string): Promise<void> => {
  const interview = (
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId: await stageId(key), scheduledAt: '2027-03-01T00:00:00.000Z', interviewerIds: [interviewerId] })
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

/** An applicant who has cleared screening + both interview rounds — eligible for evaluations. */
const readyApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  const screening = (
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId: applicant.id })
  ).body.data as ScreeningDto;
  await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  await passStage(applicant.id, 'firstInterview');
  await passStage(applicant.id, 'secondInterview');
  return applicant;
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
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });

  adminToken = await login('admin@ecms.local');
  aliceToken = await login('alice@ecms.local');
  interviewerToken = await login('interviewer@ecms.local');
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
  it('opens a waiting evaluation (idempotent) and attaches then removes a file', async () => {
    const applicant = await readyApplicant();
    const phase = await phaseByKey('securityCheck');

    const opened = await open(applicant.id, phase.id);
    expect(opened.status).toBe(201);
    const evaluation = opened.body.data as EvaluationDto;
    expect(evaluation.status).toBe('waiting');
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
    const applicant = await readyApplicant();
    // securityCheck is the first phase (no prior-phase gate); the reject behavior is what's asserted.
    const phase = await phaseByKey('securityCheck');
    const evaluation = (await open(applicant.id, phase.id)).body.data as EvaluationDto;

    // Missing reason → request-schema validation failure (400).
    expect((await decide(evaluation.id, { decision: 'rejected', version: evaluation.version })).status).toBe(400);

    const rejected = await decide(evaluation.id, { decision: 'rejected', reason: 'failed medical', version: evaluation.version });
    expect(rejected.status).toBe(200);
    expect((rejected.body.data as EvaluationDto).status).toBe('rejected');
    // Reject removes the applicant from the active pipeline.
    expect(await applicantStatus(applicant.id)).toBe('rejected');

    // The decision is editable: correcting to approved re-decides the same record. A correction
    // always carries its reason (the rulebook refuses it otherwise).
    const corrected = await decide(evaluation.id, {
      decision: 'approved',
      reason: 'medical report was misread',
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

describe('evaluations — bulk approve/reject (RW10/RW17/I4)', () => {
  const bulk = (body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post('/api/v1/hr/evaluations/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('approves a phase queue and reports one result per id', async () => {
    const phase = await phaseByKey('securityCheck');
    const a = (await open((await readyApplicant()).id, phase.id)).body.data as EvaluationDto;
    const b = (await open((await readyApplicant()).id, phase.id)).body.data as EvaluationDto;

    const res = await bulk({ action: 'approve', ids: [a.id, b.id], phaseId: phase.id });
    expect(res.status).toBe(200);
    const envelope = res.body.data as BulkActionResultDto;
    expect(envelope.requested).toBe(2);
    expect(envelope.succeeded).toBe(2);
    expect(envelope.failed).toBe(0);

    const after = await request(app)
      .get(`/api/v1/hr/evaluations/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as EvaluationDto).status).toBe('approved');
  });

  it('refuses a selection that spans another phase, per id', async () => {
    const security = await phaseByKey('securityCheck');
    const driving = await phaseByKey('drivingTest');
    const mine = (await open((await readyApplicant()).id, security.id)).body.data as EvaluationDto;
    const other = (await open((await readyApplicant()).id, driving.id)).body.data as EvaluationDto;

    const res = await bulk({ action: 'approve', ids: [mine.id, other.id], phaseId: security.id });
    expect(res.status).toBe(200);
    const envelope = res.body.data as BulkActionResultDto;
    expect(envelope.succeeded).toBe(1);
    expect(envelope.failed).toBe(1);
    expect(envelope.results.find((r) => r.id === other.id)?.ok).toBe(false);
  });

  it('requires a reason to reject, and rejects the applicants when given one', async () => {
    const phase = await phaseByKey('securityCheck');
    const applicant = await readyApplicant();
    const evaluation = (await open(applicant.id, phase.id)).body.data as EvaluationDto;

    expect((await bulk({ action: 'reject', ids: [evaluation.id], phaseId: phase.id })).status).toBe(400);

    const res = await bulk({
      action: 'reject',
      ids: [evaluation.id],
      phaseId: phase.id,
      reason: 'security clearance denied',
    });
    expect(res.status).toBe(200);
    expect((res.body.data as BulkActionResultDto).succeeded).toBe(1);
    expect(await applicantStatus(applicant.id)).toBe('rejected');
  });

  it('needs the manage permission', async () => {
    const phase = await phaseByKey('securityCheck');
    const evaluation = (await open((await readyApplicant()).id, phase.id)).body.data as EvaluationDto;
    const res = await bulk({ action: 'approve', ids: [evaluation.id], phaseId: phase.id }, aliceToken);
    expect(res.status).toBe(403);
  });
});

describe('recruitment — aggregated stage counters (RW15/I3)', () => {
  const counts = async (token = adminToken): Promise<RecruitmentStageCountsDto> => {
    const res = await request(app)
      .get('/api/v1/hr/recruitment/stage-counts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.data as RecruitmentStageCountsDto;
  };

  const stageByKey = (dto: RecruitmentStageCountsDto, key: string) =>
    dto.stages.find((s) => s.key === key);

  it('returns every stage once, in display order, with a generation timestamp', async () => {
    const dto = await counts();
    expect(new Date(dto.generatedAt).getTime()).not.toBeNaN();
    expect(dto.stages.map((s) => s.order)).toEqual(dto.stages.map((_, i) => i));

    const keys = dto.stages.map((s) => s.key);
    expect(keys).toContain('applicants');
    expect(keys).toContain('screening');
    expect(keys).toContain('jobOffers');
    expect(keys).toContain('employeesReady');
    expect(new Set(keys).size).toBe(keys.length);

    // The two catalog-driven kinds get one entry per active stage / phase.
    const phaseList = await phases();
    for (const phase of phaseList.filter((p) => p.active)) {
      expect(keys).toContain(`evaluation:${phase.id}`);
    }
    const evaluation = stageByKey(dto, `evaluation:${(await phaseByKey('securityCheck')).id}`);
    expect(evaluation?.kind).toBe('evaluation');
    expect(evaluation?.refId).toBe((await phaseByKey('securityCheck')).id);
    expect(evaluation?.name?.en).toBe((await phaseByKey('securityCheck')).name.en);
  });

  it('counts the waiting bucket, and moves an applicant between buckets on a decision', async () => {
    const phase = await phaseByKey('securityCheck');
    const key = `evaluation:${phase.id}`;
    const before = stageByKey(await counts(), key);

    const evaluation = (await open((await readyApplicant()).id, phase.id)).body.data as EvaluationDto;
    const opened = stageByKey(await counts(), key);
    expect(opened?.count).toBe((before?.count ?? 0) + 1);
    expect(opened?.buckets.waiting).toBe(opened?.count);

    await decide(evaluation.id, { decision: 'approved', version: evaluation.version });
    const decided = stageByKey(await counts(), key);
    // The record left `waiting` for `approved` — the navigation number drops, the tab badge rises.
    expect(decided?.count).toBe(before?.count ?? 0);
    expect(decided?.buckets.approved).toBe((opened?.buckets.approved ?? 0) + 1);
  });

  it('omits stages the caller cannot view rather than reporting them as zero', async () => {
    const dto = await counts(aliceToken); // no HR permissions at all
    expect(dto.stages).toEqual([]);
  });
});

describe('recruitment — boot migration (I8, idempotent)', () => {
  // Only the seeded three — an earlier test in this file adds an admin-created phase.
  const SEEDED = ['securityCheck', 'drivingTest', 'medicalExam'];

  const phaseShape = async () =>
    (await phases())
      .filter((p) => p.active && SEEDED.includes(p.key))
      .map((p) => ({ key: p.key, order: p.order, kind: p.kind, resource: p.permissionResource }));

  it('leaves the seeded catalog in business order, with Medical last', async () => {
    expect(await phaseShape()).toEqual([
      { key: 'securityCheck', order: 1, kind: 'batch', resource: 'securityCheck' },
      { key: 'drivingTest', order: 2, kind: 'batch', resource: 'drivingTest' },
      { key: 'medicalExam', order: 3, kind: 'individual', resource: 'medicalCheck' },
    ]);
  });

  it('is a no-op when re-run — the reorder never fires twice', async () => {
    const before = await phaseShape();
    await migrateRecruitmentWorkflow();
    await migrateRecruitmentWorkflow();
    expect(await phaseShape()).toEqual(before);
  });

  it('leaves live records untouched on a second run', async () => {
    const phase = await phaseByKey('securityCheck');
    const evaluation = (await open((await readyApplicant()).id, phase.id)).body.data as EvaluationDto;
    await migrateRecruitmentWorkflow();

    const after = await request(app)
      .get(`/api/v1/hr/evaluations/${evaluation.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(200);
    const dto = after.body.data as EvaluationDto;
    expect(dto.status).toBe('waiting');
    expect(dto.version).toBe(evaluation.version);
  });
});

describe('recruitment — return to an earlier stage (RW13/A8)', () => {
  const preview = (applicantId: string, kind: string, refId?: string) =>
    request(app)
      .get(`/api/v1/hr/applicants/${applicantId}/return-to-stage/preview`)
      .query(refId === undefined ? { kind } : { kind, refId })
      .set('Authorization', `Bearer ${adminToken}`);

  const returnTo = (
    applicantId: string,
    target: Record<string, unknown>,
    body: Record<string, unknown>,
    token = adminToken,
  ) =>
    request(app)
      .post(`/api/v1/hr/applicants/${applicantId}/return-to-stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target, ...body });

  const applicantVersion = async (id: string): Promise<number> => {
    const res = await request(app)
      .get(`/api/v1/hr/applicants/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    return (res.body.data as ApplicantDto).version;
  };

  const evaluationsOf = async (applicantId: string): Promise<EvaluationDto[]> => {
    const res = await request(app)
      .get('/api/v1/hr/evaluations')
      .query({ applicantId, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    return res.body.data as EvaluationDto[];
  };

  it('previews the consequences without changing anything', async () => {
    const applicant = await readyApplicant();
    const phase = await phaseByKey('securityCheck');
    const evaluation = (await open(applicant.id, phase.id)).body.data as EvaluationDto;
    const stage1 = await stageId('firstInterview');

    const res = await preview(applicant.id, 'interview', stage1);
    expect(res.status).toBe(200);
    const dto = res.body.data as ReturnToStagePreviewDto;
    expect(dto.target.refId).toBe(stage1);
    expect(dto.newAttempt).toBeGreaterThan(1);
    expect(dto.supersedes.map((s) => s.entityId)).toContain(evaluation.id);

    // Nothing moved.
    const after = await request(app)
      .get(`/api/v1/hr/evaluations/${evaluation.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as EvaluationDto).status).toBe('waiting');
  });

  it('supersedes forward records without deleting them and opens the next attempt', async () => {
    const applicant = await readyApplicant();
    const phase = await phaseByKey('securityCheck');
    const evaluation = (await open(applicant.id, phase.id)).body.data as EvaluationDto;
    await decide(evaluation.id, { decision: 'approved', version: evaluation.version });
    const stage1 = await stageId('firstInterview');

    const res = await returnTo(
      applicant.id,
      { kind: 'interview', refId: stage1 },
      { reason: 'the wrong candidate was interviewed', version: await applicantVersion(applicant.id) },
    );
    expect(res.status).toBe(200);
    const body = res.body.data as { newAttempt: number; superseded: { entityId: string }[] };
    expect(body.newAttempt).toBeGreaterThan(1);
    expect(body.superseded.map((s) => s.entityId)).toContain(evaluation.id);

    // The decided evaluation still exists, with its decision intact — only the marker was added.
    const kept = await request(app)
      .get(`/api/v1/hr/evaluations/${evaluation.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(kept.status).toBe(200);
    expect((kept.body.data as EvaluationDto).status).toBe('approved');

    // The interview stage re-opened: a fresh waiting round on attempt 2.
    const rounds = await request(app)
      .get('/api/v1/hr/interviews')
      .query({ applicantId: applicant.id, stageId: stage1, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const waiting = (rounds.body.data as InterviewDto[]).filter((i) => i.status === 'waiting');
    expect(waiting).toHaveLength(1);

    // The superseded approval no longer counts: the candidate is back in the interviews, so the
    // evaluation phase refuses to open until they clear them again. The retired record is still
    // listed — superseded, never deleted.
    expect((await open(applicant.id, phase.id)).status).toBe(422);
    expect((await evaluationsOf(applicant.id)).map((e) => e.id)).toContain(evaluation.id);
  });

  it('refuses a target that is not behind the applicant', async () => {
    const applicant = await readyApplicant();
    const stage2 = await stageId('secondInterview');
    const res = await returnTo(
      applicant.id,
      { kind: 'interview', refId: stage2 },
      { reason: 'nothing to undo', version: await applicantVersion(applicant.id) },
    );
    expect(res.status).toBe(422);
  });

  it('requires a reason and the returnToStage permission', async () => {
    const applicant = await readyApplicant();
    const stage1 = await stageId('firstInterview');
    const version = await applicantVersion(applicant.id);

    expect((await returnTo(applicant.id, { kind: 'interview', refId: stage1 }, { version })).status).toBe(400);
    const denied = await returnTo(
      applicant.id,
      { kind: 'interview', refId: stage1 },
      { reason: 'no rights', version },
      aliceToken,
    );
    expect(denied.status).toBe(403);
  });
});

describe('recruitment — persisted waiting queues (I11)', () => {
  const stageRows = async (path: string, query: Record<string, unknown>) => {
    const res = await request(app)
      .get(path)
      .query({ ...query, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as { id: string; status: string }[];
  };

  it('opens the screening row at registration, not on first use', async () => {
    const applicant = await registerApplicant();
    const rows = await stageRows('/api/v1/hr/screenings', { applicantId: applicant.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('waiting');
  });

  it('opens the first interview round when screening is accepted', async () => {
    const applicant = await registerApplicant();
    const screening = (
      await request(app)
        .post('/api/v1/hr/screenings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicantId: applicant.id })
    ).body.data as ScreeningDto;
    expect(await stageRows('/api/v1/hr/interviews', { applicantId: applicant.id })).toHaveLength(0);

    await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });

    const rounds = await stageRows('/api/v1/hr/interviews', { applicantId: applicant.id });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.status).toBe('waiting');
  });

  it('opens every applicable evaluation phase once the interviews are cleared', async () => {
    const applicant = await readyApplicant();
    const rows = await stageRows('/api/v1/hr/evaluations', { applicantId: applicant.id });
    // securityCheck + medicalExam apply to everyone; drivingTest only to drivers.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.status === 'waiting')).toBe(true);
    const keys = (
      await request(app)
        .get('/api/v1/hr/evaluations')
        .query({ applicantId: applicant.id, pageSize: 50 })
        .set('Authorization', `Bearer ${adminToken}`)
    ).body.data as EvaluationDto[];
    expect(keys.map((e) => e.phaseKey)).toContain('securityCheck');
    expect(keys.map((e) => e.phaseKey)).not.toContain('drivingTest');
  });

  it('counts the waiting rows in the aggregated counters', async () => {
    const applicant = await registerApplicant();
    const res = await request(app)
      .get('/api/v1/hr/recruitment/stage-counts')
      .set('Authorization', `Bearer ${adminToken}`);
    const screening = (res.body.data as RecruitmentStageCountsDto).stages.find(
      (s) => s.key === 'screening',
    );
    expect(screening?.count).toBeGreaterThan(0);
    expect((await stageRows('/api/v1/hr/screenings', { applicantId: applicant.id }))[0]?.status).toBe(
      'waiting',
    );
  });
});

describe('recruitment — candidate timeline (RW14/I5)', () => {
  const timelineOf = async (
    applicantId: string,
    query: Record<string, unknown> = {},
  ): Promise<RecruitmentTimelineEntryDto[]> => {
    const res = await request(app)
      .get(`/api/v1/hr/applicants/${applicantId}/timeline`)
      .query(query)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as RecruitmentTimelineEntryDto[];
  };

  it('records the workflow events a candidate produces, newest first', async () => {
    const applicant = await readyApplicant();
    const entries = await timelineOf(applicant.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.type)).toContain('screeningDecided');
    expect(entries.map((e) => e.type)).toContain('interviewCompleted');
    // Newest first, and every entry carries its own immutable id.
    const times = entries.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(new Set(entries.map((e) => e.eventId)).size).toBe(entries.length);
  });

  it('filters by entry type', async () => {
    const applicant = await readyApplicant();
    const decided = await timelineOf(applicant.id, { type: 'screeningDecided' });
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((e) => e.type === 'screeningDecided')).toBe(true);
  });

  it('appends a user-authored note and needs the edit permission', async () => {
    const applicant = await registerApplicant();
    const denied = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/timeline/notes`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ note: 'no rights' });
    expect(denied.status).toBe(403);

    const res = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/timeline/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'called the candidate, no answer' });
    expect(JSON.stringify(res.body)).toContain('success');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as RecruitmentTimelineEntryDto).type).toBe('note');

    const notes = await timelineOf(applicant.id, { type: 'note' });
    expect(notes.map((e) => e.note)).toContain('called the candidate, no answer');
  });

  it('keeps the entries of a superseded attempt, flagged rather than removed', async () => {
    const applicant = await readyApplicant();
    const before = await timelineOf(applicant.id);
    const stage1 = await stageId('firstInterview');

    const version = (
      (
        await request(app)
          .get(`/api/v1/hr/applicants/${applicant.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).body.data as ApplicantDto
    ).version;
    const returned = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/return-to-stage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ target: { kind: 'interview', refId: stage1 }, reason: 'panel error', version });
    expect(returned.status).toBe(200);

    const after = await timelineOf(applicant.id);
    // Nothing was removed, and the return itself is on the record with its reason.
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    const ret = after.find((e) => e.type === 'returnedToStage');
    expect(ret?.reason).toBe('panel error');
  });
});
