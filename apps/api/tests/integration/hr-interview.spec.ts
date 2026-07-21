// Stage 3 — HR / Recruitment: Interviews integration suite. Boots the HR manifest and
// exercises the interview lifecycle on top of Stage-1 applicants and Stage-2 screening:
// admin-configurable stages (default two), scheduling with a panel, per-interviewer
// evaluation state (pending/submitted/skipped), independent panel reassignment, reschedule/
// cancel with panel notifications (Notifications service), the gated pass/fail decision
// (blocked while any interviewer is pending), and applicant progression (pass advances /
// clears; fail rejects). Also proves the workflow entry gate and the create/evaluate/decide
// permission split. Runs against an in-memory Mongo replica set (MONGO_TEST_URI overrides).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type InterviewDto,
  type InterviewStageDto,
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
const FUTURE = '2026-09-01T09:00:00.000Z';
const LATER = '2026-09-08T09:00:00.000Z';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let aliceToken: string; // no HR permissions
let interviewerId: string;
let interviewerToken: string; // interview.view + interview.evaluate; sits on panels
let outsiderId: string;
let outsiderToken: string; // interview.view + interview.evaluate; NOT on panels (unless added)
let phoneCounter = 20_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-interview-test-${Date.now()}`;
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

const stageIdByKey = async (key: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/interview-stages')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: InterviewStageDto[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`interview stage ${key} not seeded`);
  return found.id;
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

const registerApplicant = async (): Promise<ApplicantDto> => {
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
    });
  expect(res.status).toBe(201);
  return res.body.data as ApplicantDto;
};

/** Register an applicant and pass Initial Screening — ready for the first interview. */
const acceptedApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  const screening = (
    await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id })
  ).body.data as ScreeningDto;
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status).toBe(200);
  return applicant;
};

const schedule = (applicantId: string, stageId: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/v1/hr/interviews')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ applicantId, stageId, scheduledAt: FUTURE, interviewerIds: [interviewerId], ...over });

/** The sole interviewer submits their evaluation; returns the interview's new version. */
const soloSubmit = async (interview: InterviewDto): Promise<number> => {
  const res = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', rating: 4, version: interview.version });
  expect(res.status).toBe(200);
  return (res.body.data as InterviewDto).version;
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
  await mkUser('alice@ecms.local'); // no roles

  // Panel members: can view + evaluate, but not schedule, reassign, or decide.
  const panelRole = await rbacService.createRole(
    { name: { en: 'Interviewer', ar: 'مُحاور' }, permissionKeys: ['interview.view', 'interview.evaluate'] },
    adminId,
  );
  interviewerId = await mkUser('interviewer@ecms.local');
  await rbacService.ensureAssignment(interviewerId, String(panelRole._id), 'organization');
  outsiderId = await mkUser('outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(panelRole._id), 'organization');

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
  interviewerToken = await login('interviewer@ecms.local');
  outsiderToken = await login('outsider@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('interview stages (admin-configurable, OQ-31)', () => {
  it('seeds the two default stages in order', async () => {
    const res = await request(app)
      .get('/api/v1/hr/interview-stages')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const stages = (res.body as { data: InterviewStageDto[] }).data;
    expect(stages.map((s) => s.key)).toEqual(['firstInterview', 'secondInterview']);
    expect(stages.map((s) => s.order)).toEqual([1, 2]);
  });

  it('admin adds a stage; alice cannot; duplicate active order conflicts', async () => {
    const created = await request(app)
      .post('/api/v1/hr/interview-stages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'finalPanel', name: { ar: 'اللجنة النهائية', en: 'Final Panel' }, order: 3 });
    expect(created.status).toBe(201);

    const denied = await request(app)
      .post('/api/v1/hr/interview-stages')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ key: 'x', name: { ar: 'x', en: 'x' }, order: 9 });
    expect(denied.status).toBe(403);

    const dup = await request(app)
      .post('/api/v1/hr/interview-stages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'another', name: { ar: 'ب', en: 'b' }, order: 1 });
    expect(dup.status).toBe(409);
  });
});

describe('interviews — permissions & entry gate', () => {
  it('denies a user without interview permissions', async () => {
    const denied = await request(app).get('/api/v1/hr/interviews').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });

  it('refuses to schedule before the applicant passes screening', async () => {
    const applicant = await registerApplicant(); // no screening
    const stage1 = await stageIdByKey('firstInterview');
    const res = await schedule(applicant.id, stage1);
    expect(res.status).toBe(422);
  });

  it('refuses to schedule a later stage before the previous one is passed', async () => {
    const applicant = await acceptedApplicant();
    const stage2 = await stageIdByKey('secondInterview');
    const res = await schedule(applicant.id, stage2);
    expect(res.status).toBe(422);
  });
});

describe('interviews — schedule, notify, reschedule, cancel', () => {
  it('schedules the first interview (panel pending) and notifies the panel', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const res = await schedule(applicant.id, stage1, { location: 'HQ, room 2', notes: 'bring CV' });
    expect(res.status).toBe(201);
    const dto = res.body.data as InterviewDto;
    expect(dto.status).toBe('scheduled');
    expect(dto.outcome).toBe('pending');
    expect(dto.stageOrder).toBe(1);
    expect(dto.panel).toHaveLength(1);
    expect(dto.panel[0]?.interviewerId).toBe(interviewerId);
    expect(dto.panel[0]?.state).toBe('pending');

    const inbox = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${interviewerToken}`);
    expect(inbox.status).toBe(200);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
  });

  it('schedules an interview with NO committee (optional) — panel is empty, assigned later', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const res = await schedule(applicant.id, stage1, { interviewerIds: [] });
    expect(res.status).toBe(201);
    const dto = res.body.data as InterviewDto;
    expect(dto.status).toBe('scheduled');
    expect(dto.panel).toHaveLength(0);
  });

  it('reschedules a scheduled interview (date only, bumping the reschedule count)', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/reschedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scheduledAt: LATER, reason: 'panel conflict', version: created.version });
    expect(res.status).toBe(200);
    const dto = res.body.data as InterviewDto;
    expect(dto.rescheduleCount).toBe(1);
    expect(dto.scheduledAt).toBe(new Date(LATER).toISOString());
    expect(dto.panel).toHaveLength(1); // panel untouched by reschedule
  });

  it('cancels a scheduled interview', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'requisition withdrawn', version: created.version });
    expect(res.status).toBe(200);
    expect((res.body.data as InterviewDto).status).toBe('cancelled');
    const again = await schedule(applicant.id, stage1);
    expect(again.status).toBe(201);
  });
});

describe('interviews — awaiting scheduling (pipeline entry)', () => {
  const awaitingIds = async (): Promise<string[]> => {
    const res = await request(app)
      .get('/api/v1/hr/interviews/awaiting')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return (res.body.data as { applicantId: string }[]).map((r) => r.applicantId);
  };

  it('surfaces a screening-approved applicant, then drops them once scheduled', async () => {
    const applicant = await acceptedApplicant();
    expect(await awaitingIds()).toContain(applicant.id);

    const stage1 = await stageIdByKey('firstInterview');
    expect((await schedule(applicant.id, stage1)).status).toBe(201);
    expect(await awaitingIds()).not.toContain(applicant.id);
  });

  it('excludes an applicant who has not passed screening', async () => {
    const applicant = await registerApplicant(); // no accepted screening
    expect(await awaitingIds()).not.toContain(applicant.id);
  });

  it('a restored applicant resumes at the EXACT stage they left (back in awaiting interviews)', async () => {
    // Approved in screening → awaiting their first interview.
    const applicant = await acceptedApplicant();
    expect(await awaitingIds()).toContain(applicant.id);

    // Withdrawn from the interview stage → drops out of the pipeline entirely.
    const withdrawn = (
      await request(app)
        .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'paused', version: applicant.version })
    ).body.data as { version: number };
    expect(await awaitingIds()).not.toContain(applicant.id);

    // Restored → resumes at the INTERVIEW stage (their accepted screening is intact), NOT back at
    // screening. Visibility is derived from the applicant's records, so they reappear in the
    // interviews awaiting queue — the accepted screening was never lost.
    const restored = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: withdrawn.version });
    expect(restored.status).toBe(200);
    expect(await awaitingIds()).toContain(applicant.id);
  });
});

describe('interviews — panel reassignment (independent of scheduling)', () => {
  it('changes the panel without touching the schedule; retains states, adds pending, drops removed', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = (await schedule(applicant.id, stage1)).body.data as InterviewDto;

    // The seated interviewer submits before we reassign.
    const v1 = await soloSubmit(created);

    // Add the outsider to the panel — schedule (date/time) unchanged.
    const added = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/panel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ interviewerIds: [interviewerId, outsiderId], version: v1 });
    expect(added.status).toBe(200);
    const withBoth = added.body.data as InterviewDto;
    expect(withBoth.scheduledAt).toBe(new Date(FUTURE).toISOString());
    expect(withBoth.panel.map((p) => p.interviewerId).sort()).toEqual([interviewerId, outsiderId].sort());
    // Retained member keeps their submitted state; the new one is pending.
    expect(withBoth.panel.find((p) => p.interviewerId === interviewerId)?.state).toBe('submitted');
    expect(withBoth.panel.find((p) => p.interviewerId === outsiderId)?.state).toBe('pending');

    // Removing a member drops them off.
    const dropped = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/panel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ interviewerIds: [outsiderId], version: withBoth.version });
    expect(dropped.status).toBe(200);
    expect((dropped.body.data as InterviewDto).panel.map((p) => p.interviewerId)).toEqual([outsiderId]);
  });

  it('does not allow a panel member to reassign the panel', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const denied = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/panel`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ interviewerIds: [interviewerId, outsiderId], version: created.version });
    expect(denied.status).toBe(403);
  });
});

describe('interviews — evaluation (per interviewer)', () => {
  it('lets an assigned interviewer evaluate (state → submitted) but refuses a non-panel evaluator', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = (await schedule(applicant.id, stage1)).body.data as InterviewDto;

    const evalRes = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', rating: 4, notes: 'strong communicator', version: interview.version });
    expect(evalRes.status).toBe(200);
    const dto = evalRes.body.data as InterviewDto;
    expect(dto.panel.find((p) => p.interviewerId === interviewerId)?.state).toBe('submitted');

    // A user with the permission but not on the panel is refused.
    const outsider = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ recommendation: 'notRecommend', version: dto.version });
    expect(outsider.status).toBe(403);
  });

  it('separates create/decide from evaluate (an interviewer cannot schedule or decide)', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = (await schedule(applicant.id, stage1)).body.data as InterviewDto;

    const cannotSchedule = await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ applicantId: applicant.id, stageId: stage1, scheduledAt: FUTURE, interviewerIds: [interviewerId] });
    expect(cannotSchedule.status).toBe(403);

    const cannotDecide = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ outcome: 'passed', version: interview.version });
    expect(cannotDecide.status).toBe(403);
  });
});

describe('interviews — decision gate (all interviewers submitted or skipped)', () => {
  it('blocks a decision while any interviewer is pending; unblocks via submit + skip', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = (await schedule(applicant.id, stage1, { interviewerIds: [interviewerId, outsiderId] }))
      .body.data as InterviewDto;
    expect(interview.panel).toHaveLength(2);

    // Both pending → blocked.
    const blocked = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: interview.version });
    expect(blocked.status).toBe(422);

    // One submits; the other still pending → still blocked.
    const submitted = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', version: interview.version });
    expect(submitted.status).toBe(200);
    const v1 = (submitted.body.data as InterviewDto).version;
    const stillBlocked = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: v1 });
    expect(stillBlocked.status).toBe(422);

    // Skip the absent member → now every member is submitted or skipped → decision allowed.
    const skipped = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/panel/skip`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ interviewerId: outsiderId, reason: 'no-show', version: v1 });
    expect(skipped.status).toBe(200);
    expect((skipped.body.data as InterviewDto).panel.find((p) => p.interviewerId === outsiderId)?.state).toBe('skipped');

    const decided = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: (skipped.body.data as InterviewDto).version });
    expect(decided.status).toBe(200);
    expect((decided.body.data as InterviewDto).status).toBe('completed');
  });

  it('rejects skipping an interviewer who has already submitted', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const v1 = await soloSubmit(interview);
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/panel/skip`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ interviewerId, version: v1 });
    expect(res.status).toBe(422);
  });
});

describe('interviews — decide & applicant progression', () => {
  it('passes round 1, then allows round 2; a second-round fail rejects the applicant', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const stage2 = await stageIdByKey('secondInterview');

    const i1 = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const pass1 = await request(app)
      .post(`/api/v1/hr/interviews/${i1.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', notes: 'advance', version: await soloSubmit(i1) });
    expect(pass1.status).toBe(200);
    expect((pass1.body.data as InterviewDto).status).toBe('completed');

    const mid = await request(app).get(`/api/v1/hr/applicants/${applicant.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((mid.body.data as ApplicantDto).status).toBe('new');

    const i2 = (await schedule(applicant.id, stage2)).body.data as InterviewDto;
    expect(i2.stageOrder).toBe(2);
    const fail2 = await request(app)
      .post(`/api/v1/hr/interviews/${i2.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'failed', notes: 'not a fit', version: await soloSubmit(i2) });
    expect(fail2.status).toBe(200);

    const after = await request(app).get(`/api/v1/hr/applicants/${applicant.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('rejected');
  });

  it('rejects a duplicate interview at an already-active stage', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    expect((await schedule(applicant.id, stage1)).status).toBe(201);
    expect((await schedule(applicant.id, stage1)).status).toBe(409);
  });

  it('refuses to decide an interview twice', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = (await schedule(applicant.id, stage1)).body.data as InterviewDto;
    const first = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: await soloSubmit(interview) });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: (first.body.data as InterviewDto).version });
    expect(second.status).toBe(422);
  });
});
