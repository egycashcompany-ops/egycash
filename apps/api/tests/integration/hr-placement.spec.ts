// Placement + reassignment integration suite (RW1–RW5). Boots the HR manifest and exercises the
// rule that a candidate's Position and Branch stay editable until the offer is accepted: the
// audited reassign action, the scope-field sync that makes their history follow them, the
// immutability of every stage record's snapshot, the timeline entries, and the closing of the
// editing window on acceptance.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type InterviewDto,
  type JobOfferDto,
  type RecruitmentTimelineEntryDto,
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
import { actionEnabled, bulkEnvelope, counter, envelope, mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let plainToken: string;
let interviewerId: string;
let interviewerToken: string;
let phoneCounter = 80_000_000;

let BRANCH_A = '';
let BRANCH_B = '';
let DEPT_A = '';
let DEPT_B = '';
let POSITION_A = '';
let POSITION_B = '';
let TITLE_ID = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-placement-test-${Date.now()}`;
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

const register = async (placement?: Record<string, string>): Promise<ApplicantDto> => {
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sourceId: await sourceId(),
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
      ...(placement === undefined ? {} : { placement }),
    });
  expect(res.status).toBe(201);
  // Registration is a workflow action (I6) — the aggregate rides inside the envelope.
  return mutated<ApplicantDto>(res);
};

const getApplicant = async (id: string): Promise<ApplicantDto> => {
  const res = await request(app).get(`/api/v1/hr/applicants/${id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  // A READ is unchanged by I6.
  return res.body.data as ApplicantDto;
};

const reassign = (id: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/hr/applicants/${id}/reassign`).set('Authorization', `Bearer ${adminToken}`).send(body);

const screeningOf = async (applicantId: string): Promise<ScreeningDto> => {
  const res = await request(app)
    .get('/api/v1/hr/screenings')
    .query({ applicantId, pageSize: 10 })
    .set('Authorization', `Bearer ${adminToken}`);
  const [first] = (res.body as { data: ScreeningDto[] }).data;
  if (first === undefined) throw new Error('no screening row');
  return first;
};

const timeline = async (applicantId: string): Promise<RecruitmentTimelineEntryDto[]> => {
  const res = await request(app)
    .get(`/api/v1/hr/applicants/${applicantId}/timeline`)
    .query({ limit: 100 })
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as RecruitmentTimelineEntryDto[];
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

  // A recruiter who may edit applicants but was never granted `applicant.reassign` (RW2).
  const editorRole = await rbacService.createRole(
    { name: { en: 'Recruiter', ar: 'موظف توظيف' }, permissionKeys: ['applicant.view', 'applicant.edit'] },
    adminId,
  );
  const plainId = await mkUser('recruiter@ecms.local');
  await rbacService.ensureAssignment(plainId, String(editorRole._id), 'organization');

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
  plainToken = await login('recruiter@ecms.local');
  interviewerToken = await login('interviewer@ecms.local');

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  BRANCH_A = await mkBranch('101', 'Cairo');
  BRANCH_B = await mkBranch('102', 'Giza');

  const mkDepartment = async (branchId: string, code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ branchId, code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  DEPT_A = await mkDepartment(BRANCH_A, 'DEP-CAI', 'Cairo Ops');
  DEPT_B = await mkDepartment(BRANCH_B, 'DEP-GIZ', 'Giza Ops');

  const mkPosition = async (departmentId: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/job-positions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentId, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  POSITION_A = await mkPosition(DEPT_A, 'Teller');
  POSITION_B = await mkPosition(DEPT_B, 'Driver');

  const titleRes = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-REC-1', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  expect(titleRes.status).toBe(201);
  TITLE_ID = (titleRes.body as { data: { id: string } }).data.id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('placement at intake (RW1)', () => {
  it('accepts a placement and completes it from the seat', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });
    expect(applicant.placement.jobPositionId).toBe(POSITION_A);
    // The seat is the authority on where it sits: department and branch come from it.
    expect(applicant.placement.departmentId).toBe(DEPT_A);
    expect(applicant.placement.branchId).toBe(BRANCH_A);
    // ADR-015 — the scope field mirrors the placement's branch.
    expect(applicant.branchId).toBe(BRANCH_A);
    expect(applicant.placementLabel.position).toBe('Teller');
  });

  it('still registers with no placement at all (ADR-016)', async () => {
    const applicant = await register();
    expect(applicant.placement.jobPositionId).toBeNull();
    expect(applicant.placement.branchId).toBeNull();
  });

  it('refuses an unknown position', async () => {
    const res = await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sourceId: await sourceId(),
        intakeChannel: 'internal',
        identity: { fullNameAr: 'أحمد', nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        placement: { jobPositionId: '64b1f0aaaaaaaaaaaaaaaaab' },
      });
    expect(res.status).toBe(400);
  });
});

describe('reassignment (RW2)', () => {
  it('moves the candidate, records history, and syncs the scope field', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });

    const res = await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_B },
      reason: 'تم فتح شاغر في الجيزة',
      version: applicant.version,
    });
    expect(res.status).toBe(200);
    const body = envelope<ApplicantDto>(res);
    const after = body.data;

    expect(after.placement.jobPositionId).toBe(POSITION_B);
    expect(after.placement.branchId).toBe(BRANCH_B);
    expect(after.branchId).toBe(BRANCH_B);
    expect(after.placementLabel.position).toBe('Driver');

    // I6 — the envelope answers "where do they stand now?" without a follow-up request.
    expect(body.workflow.applicantId).toBe(applicant.id);
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.placement.jobPositionId).toBe(POSITION_B);
    expect(body.workflow.stage?.kind).toBe('screening');
    // …what it just wrote…
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['positionChanged', 'branchChanged']),
    );
    expect(body.timeline.total).toBeGreaterThan(0);
    // …the refreshed counters…
    expect(counter(body.counters, 'screening')).toBeDefined();
    // …and what this caller may do next (a super-admin holds every grant).
    expect(actionEnabled(body.workflow, 'reassign')).toBe(true);
    expect(actionEnabled(body.workflow, 'accept')).toBe(true);

    // The screening row opened at registration follows the candidate's scope (RW2 step 3)…
    const screening = await screeningOf(applicant.id);
    expect(screening.branchId).toBe(BRANCH_B);
    // …but its immutable snapshot still says where it was created (RW4).
    expect(screening.placement.branchId).toBe(BRANCH_A);
  });

  it('writes one timeline entry per moved dimension, correlated as one act (A2)', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });
    await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_B },
      reason: 'إعادة توزيع',
      version: applicant.version,
    });

    const entries = await timeline(applicant.id);
    const moves = entries.filter((e) => e.type === 'positionChanged' || e.type === 'branchChanged');
    expect(moves.length).toBeGreaterThanOrEqual(2);
    // Both dimensions of one move share a correlation id, so the UI can group them.
    expect(new Set(moves.map((m) => m.correlationId)).size).toBe(1);
    expect(moves.every((m) => m.correlationType === 'placementChange')).toBe(true);
  });

  it('requires a reason and refuses a caller without the grant', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });

    const noReason = await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_B },
      version: applicant.version,
    });
    expect(noReason.status).toBe(400);

    const denied = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/reassign`)
      .set('Authorization', `Bearer ${plainToken}`)
      .send({ placement: { jobPositionId: POSITION_B }, reason: 'x', version: applicant.version });
    // `applicant.edit` is NOT enough — reassignment is its own grant (RW2).
    expect(denied.status).toBe(403);
  });

  it('is a no-op when nothing actually moved', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });
    const res = await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_A },
      reason: 'no change',
      version: applicant.version,
    });
    expect(res.status).toBe(200);
    const body = envelope<ApplicantDto>(res);
    expect(body.data.version).toBe(applicant.version);
    // Nothing moved, so nothing was written — but the envelope still reports current truth.
    expect(body.timeline.produced).toEqual([]);
    expect(body.workflow.applicantId).toBe(applicant.id);
  });

  it('applies one placement across a selection with a partial-success envelope (RW17)', async () => {
    const [a, b] = [await register({ jobPositionId: POSITION_A }), await register({ jobPositionId: POSITION_A })];
    const res = await request(app)
      .post('/api/v1/hr/applicants/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'reassign',
        ids: [a.id, b.id],
        placement: { jobPositionId: POSITION_B },
        reason: 'إعادة توزيع جماعية',
      });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(2);
    // I6 — a bulk act reports what the whole batch wrote, plus the refreshed counters.
    expect(result.timeline.produced.length).toBeGreaterThan(0);
    expect(counter(result.counters, 'screening')).toBeDefined();
    expect((await getApplicant(a.id)).placement.branchId).toBe(BRANCH_B);
    expect((await getApplicant(b.id)).placement.branchId).toBe(BRANCH_B);
  });

  // RW17 — the executor must be EXHAUSTIVE over its own action vocabulary. It once handled
  // `withdraw` and fell through to `reassign` for everything else, so a bulk `moveToOffer`
  // silently ran a reassignment with no placement instead of moving anyone.
  it('moves a selection to the Job Offer stage rather than falling through to reassign', async () => {
    const [a, b] = [await register({ jobPositionId: POSITION_A }), await register({ jobPositionId: POSITION_A })];
    const res = await request(app)
      .post('/api/v1/hr/applicants/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'moveToOffer', ids: [a.id, b.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const moved = bulkEnvelope(res);
    expect(moved.succeeded).toBe(2);
    expect(counter(moved.counters, 'jobOffers')).toBeDefined();

    for (const applicant of [a, b]) {
      const after = await getApplicant(applicant.id);
      expect(after.movedToOfferAt).not.toBeNull();
      // The placement is untouched — this was a stage move, not a reassignment.
      expect(after.placement.jobPositionId).toBe(POSITION_A);
    }
  });

  it('opens the screening row for a selection (idempotent under I11)', async () => {
    const a = await register({ jobPositionId: POSITION_A });
    const res = await request(app)
      .post('/api/v1/hr/applicants/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'moveToScreening', ids: [a.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bulkEnvelope(res).succeeded).toBe(1);

    const screenings = await request(app)
      .get('/api/v1/hr/screenings')
      .query({ applicantId: a.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((screenings.body as { data: unknown[] }).data).toHaveLength(1);
  });
});

describe('the editing window closes at acceptance (RW3)', () => {
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
    const interview = mutated<InterviewDto>(
      await request(app)
        .post('/api/v1/hr/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicantId,
          stageId: await stageId(key),
          scheduledAt: '2027-03-01T00:00:00.000Z',
          interviewerIds: [interviewerId],
        }),
    );
    const submitted = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', version: interview.version });
    await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: mutated<InterviewDto>(submitted).version });
  };

  it('follows a live offer into the new placement, then refuses once accepted', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });
    const screening = await screeningOf(applicant.id);
    await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    await passStage(applicant.id, 'firstInterview');
    await passStage(applicant.id, 'secondInterview');

    const moved = await getApplicant(applicant.id);
    await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/move-to-offer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: moved.version });

    const offer = mutated<JobOfferDto>(
      await request(app)
        .post('/api/v1/hr/job-offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicantId: applicant.id,
          terms: {
            jobTitleId: TITLE_ID,
            departmentId: DEPT_A,
            branchId: BRANCH_A,
            jobPositionId: POSITION_A,
            employmentType: 'fullTime',
            probationMonths: 3,
            startDate: '2027-06-01T00:00:00.000Z',
            validUntil: '2027-05-01T00:00:00.000Z',
          },
        }),
    );
    expect(offer.status).toBe('draft');

    // A draft offer is inside the editing window: the package follows the placement (RW2 step 5).
    const current = await getApplicant(applicant.id);
    const res = await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_B },
      reason: 'نُقل الشاغر',
      version: current.version,
    });
    expect(res.status).toBe(200);

    // A READ is unchanged by I6.
    const revised = (
      await request(app).get(`/api/v1/hr/job-offers/${offer.id}`).set('Authorization', `Bearer ${adminToken}`)
    ).body.data as JobOfferDto;
    expect(revised.revisionNumber).toBe(offer.revisionNumber + 1);
    expect(revised.terms?.branchId).toBe(BRANCH_B);
    expect(revised.terms?.jobPositionId).toBe(POSITION_B);
    // The prior package is kept, not overwritten.
    expect(revised.revisions.length).toBe(1);

    const sent = mutated<JobOfferDto>(
      await request(app)
        .post(`/api/v1/hr/job-offers/${offer.id}/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ version: revised.version }),
    );
    await request(app)
      .post(`/api/v1/hr/job-offers/${offer.id}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: sent.version });

    // Acceptance closes the window (RW3/OQ-3) — the accepted snapshot is the contractual artifact.
    const afterAccept = await getApplicant(applicant.id);
    const refused = await reassign(applicant.id, {
      placement: { jobPositionId: POSITION_A },
      reason: 'متأخر',
      version: afterAccept.version,
    });
    expect(refused.status).toBe(422);
  });
});

describe('stage recommendations (RW5)', () => {
  it('records an advisory recommendation without moving the candidate', async () => {
    const applicant = await register({ jobPositionId: POSITION_A });
    const screening = await screeningOf(applicant.id);
    await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });

    const stages = await request(app)
      .get('/api/v1/hr/interview-stages')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const first = (stages.body as { data: { id: string; key: string }[] }).data.find(
      (s) => s.key === 'firstInterview',
    );
    const interview = mutated<InterviewDto>(
      await request(app)
        .post('/api/v1/hr/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicantId: applicant.id,
          stageId: first?.id,
          scheduledAt: '2027-03-01T00:00:00.000Z',
          interviewerIds: [interviewerId],
        }),
    );

    const res = await request(app)
      .patch(`/api/v1/hr/interviews/${interview.id}/recommendation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        recommendedPlacement: { jobPositionId: POSITION_B },
        recommendationNote: 'أنسب لوظيفة سائق',
        version: interview.version,
      });
    expect(res.status).toBe(200);
    const recommended = envelope<InterviewDto>(res);
    expect(recommended.data.recommendedPlacement?.jobPositionId).toBe(POSITION_B);
    // RW5 — a recommendation is advisory: the candidate has NOT moved.
    expect(recommended.workflow.placement.jobPositionId).toBe(POSITION_A);
    expect(recommended.workflow.stage?.kind).toBe('interview');

    // Advisory only — the candidate has NOT moved.
    expect((await getApplicant(applicant.id)).placement.jobPositionId).toBe(POSITION_A);
  });
});
