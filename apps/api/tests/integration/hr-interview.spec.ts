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
import { actionEnabled, bulkEnvelope, counter, envelope, mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
const FUTURE = '2026-09-01T09:00:00.000Z';
const LATER = '2026-09-08T09:00:00.000Z';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminUserId: string;
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
  return mutated<ApplicantDto>(res);
};

/** Register an applicant and pass Initial Screening — ready for the first interview. */
const acceptedApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  const screening = mutated<ScreeningDto>(
    await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id }),
  );
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
  return mutated<InterviewDto>(res).version;
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
  adminUserId = adminId;
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
    const body = envelope<InterviewDto>(res);
    const dto = body.data;
    expect(dto.status).toBe('scheduled');
    expect(dto.outcome).toBe('pending');
    expect(dto.stageOrder).toBe(1);
    expect(dto.panel).toHaveLength(1);
    expect(dto.panel[0]?.interviewerId).toBe(interviewerId);
    expect(dto.panel[0]?.state).toBe('pending');

    // I6 — the round is where the candidate now stands, and the response says so with the actions
    // that follow from it, the entry it wrote, and the counters the board redraws.
    expect(body.workflow.applicantId).toBe(applicant.id);
    expect(body.workflow.stage?.kind).toBe('interview');
    expect(body.workflow.stage?.refId).toBe(stage1);
    expect(body.workflow.status).toBe('scheduled');
    expect(actionEnabled(body.workflow, 'start')).toBe(true);
    expect(actionEnabled(body.workflow, 'decide')).toBe(true);
    expect(actionEnabled(body.workflow, 'cancel')).toBe(true);
    expect(body.timeline.produced.map((e) => e.type)).toContain('interviewScheduled');
    expect(counter(body.counters, `interview:${stage1}`)).toBeDefined();

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
    const dto = mutated<InterviewDto>(res);
    expect(dto.status).toBe('scheduled');
    expect(dto.panel).toHaveLength(0);
  });

  it('reschedules a scheduled interview (date only, bumping the reschedule count)', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = mutated<InterviewDto>(await schedule(applicant.id, stage1));
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/reschedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scheduledAt: LATER, reason: 'panel conflict', version: created.version });
    expect(res.status).toBe(200);
    const body = envelope<InterviewDto>(res);
    const dto = body.data;
    expect(dto.rescheduleCount).toBe(1);
    expect(dto.scheduledAt).toBe(new Date(LATER).toISOString());
    expect(dto.panel).toHaveLength(1); // panel untouched by reschedule
    // A reschedule moves the date, not the round — the state is unchanged and nothing was written.
    expect(body.workflow.status).toBe('scheduled');
    expect(body.timeline.produced).toEqual([]);
    expect(counter(body.counters, `interview:${stage1}`)).toBeDefined();
  });

  it('cancels a scheduled interview', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = mutated<InterviewDto>(await schedule(applicant.id, stage1));
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'requisition withdrawn', version: created.version });
    expect(res.status).toBe(200);
    const body = envelope<InterviewDto>(res);
    expect(body.data.status).toBe('cancelled');
    // I14 — cancelling a ROUND is not a lifecycle exit: the candidate is still live, and the
    // envelope reports that instead of leaving the client to infer it from the cancelled row.
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.timeline.produced.map((e) => e.type)).toEqual(['interviewCancelled']);

    const again = await schedule(applicant.id, stage1);
    expect(again.status).toBe(201);
  });
});

// I11 — the queue is REAL rows whose status is `waiting`, materialized when screening is
// accepted. There is no derived "who ought to be here" read model to disagree with them.
describe('interviews — the waiting queue is persisted rows', () => {
  const waitingIds = async (): Promise<string[]> => {
    const res = await request(app)
      .get('/api/v1/hr/interviews?status=waiting&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return (res.body.data as InterviewDto[]).map((r) => r.applicantId); // a read
  };

  it('materializes a waiting round on screening approval, then leaves it once scheduled', async () => {
    const applicant = await acceptedApplicant();
    expect(await waitingIds()).toContain(applicant.id);

    const stage1 = await stageIdByKey('firstInterview');
    expect((await schedule(applicant.id, stage1)).status).toBe(201);
    expect(await waitingIds()).not.toContain(applicant.id);
  });

  it('opens no round for an applicant who has not passed screening', async () => {
    const applicant = await registerApplicant(); // no accepted screening
    expect(await waitingIds()).not.toContain(applicant.id);
  });

  it('a restored applicant resumes at the EXACT stage they left, on a new attempt', async () => {
    // Approved in screening → a waiting first round exists for them.
    const applicant = await acceptedApplicant();
    expect(await waitingIds()).toContain(applicant.id);

    // Withdrawn from the interview stage → drops out of the pipeline entirely.
    const withdrawRes = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'paused', version: applicant.version });
    const withdrawBody = envelope<ApplicantDto>(withdrawRes);
    const withdrawn = withdrawBody.data;
    // I6/I14 — the withdrawal closed the open round, and the envelope reports the closure it
    // produced rather than only the applicant row it wrote.
    expect(withdrawBody.workflow.stage).toBeNull();
    expect(withdrawBody.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['withdrawn', 'interviewCancelled']),
    );
    expect(await waitingIds()).not.toContain(applicant.id);

    // Restored → resumes at the INTERVIEW stage (their accepted screening is intact), NOT back at
    // screening. The round they left was CLOSED by the withdrawal, so the reactivation opens a
    // fresh attempt at that same stage — history is never revived (I11/I12/I14).
    const restored = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: withdrawn.version });
    expect(restored.status).toBe(200);
    expect(await waitingIds()).toContain(applicant.id);

    // The envelope names the exact stage they resumed at, and the attempt it opened (I11/I12).
    const restoredBody = envelope<ApplicantDto>(restored);
    expect(restoredBody.workflow.stage?.kind).toBe('interview');
    expect(restoredBody.workflow.status).toBe('waiting');
    expect(restoredBody.workflow.attempt).toBe(2);
    expect(restoredBody.timeline.produced.map((e) => e.type)).toContain('restored');
  });
});

describe('interviews — panel reassignment (independent of scheduling)', () => {
  it('changes the panel without touching the schedule; retains states, adds pending, drops removed', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = mutated<InterviewDto>(await schedule(applicant.id, stage1));

    // The seated interviewer submits before we reassign.
    const v1 = await soloSubmit(created);

    // Add the outsider to the panel — schedule (date/time) unchanged.
    const added = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/panel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ interviewerIds: [interviewerId, outsiderId], version: v1 });
    expect(added.status).toBe(200);
    const withBoth = mutated<InterviewDto>(added);
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
    const droppedBody = envelope<InterviewDto>(dropped);
    expect(droppedBody.data.panel.map((p) => p.interviewerId)).toEqual([outsiderId]);
    // Reassigning the panel is not a move — the round stays where it was and wrote no history.
    expect(droppedBody.workflow.status).toBe('scheduled');
    expect(droppedBody.timeline.produced).toEqual([]);
  });

  it('does not allow a panel member to reassign the panel', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = mutated<InterviewDto>(await schedule(applicant.id, stage1));
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
    const interview = mutated<InterviewDto>(await schedule(applicant.id, stage1));

    const evalRes = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', rating: 4, notes: 'strong communicator', version: interview.version });
    expect(evalRes.status).toBe(200);
    const evalBody = envelope<InterviewDto>(evalRes);
    const dto = evalBody.data;
    expect(dto.panel.find((p) => p.interviewerId === interviewerId)?.state).toBe('submitted');
    // I6 — the envelope an INTERVIEWER receives is built from THEIR permissions: they may not
    // decide, and the response says so rather than offering a button the gate would refuse.
    expect(evalBody.workflow.status).toBe('scheduled');
    expect(actionEnabled(evalBody.workflow, 'decide')).toBe(false);
    expect(evalBody.timeline.produced).toEqual([]);

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
    const interview = mutated<InterviewDto>(await schedule(applicant.id, stage1));

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
    const interview = mutated<InterviewDto>(
      await schedule(applicant.id, stage1, { interviewerIds: [interviewerId, outsiderId] }),
    );
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
    const v1 = mutated<InterviewDto>(submitted).version;
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
    const skippedBody = envelope<InterviewDto>(skipped);
    expect(skippedBody.data.panel.find((p) => p.interviewerId === outsiderId)?.state).toBe('skipped');

    const decided = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: skippedBody.data.version });
    expect(decided.status).toBe(200);
    const decidedBody = envelope<InterviewDto>(decided);
    expect(decidedBody.data.status).toBe('completed');
    // Passing round 1 opened round 2 (I11), and the envelope already stands there.
    expect(decidedBody.workflow.stage?.kind).toBe('interview');
    expect(decidedBody.workflow.stage?.refId).not.toBe(stage1);
    expect(decidedBody.timeline.produced.map((e) => e.type)).toContain('interviewCompleted');
  });

  it('rejects skipping an interviewer who has already submitted', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const interview = mutated<InterviewDto>(await schedule(applicant.id, stage1));
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

    const i1 = mutated<InterviewDto>(await schedule(applicant.id, stage1));
    const pass1 = await request(app)
      .post(`/api/v1/hr/interviews/${i1.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', notes: 'advance', version: await soloSubmit(i1) });
    expect(pass1.status).toBe(200);
    const pass1Body = envelope<InterviewDto>(pass1);
    expect(pass1Body.data.status).toBe('completed');
    // Passing does not move the lifecycle (I14) — it is progress, not an outcome.
    expect(pass1Body.workflow.applicantStatus).toBe('new');

    const mid = await request(app).get(`/api/v1/hr/applicants/${applicant.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((mid.body.data as ApplicantDto).status).toBe('new');

    const i2 = mutated<InterviewDto>(await schedule(applicant.id, stage2));
    expect(i2.stageOrder).toBe(2);
    const fail2 = await request(app)
      .post(`/api/v1/hr/interviews/${i2.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'failed', notes: 'not a fit', version: await soloSubmit(i2) });
    expect(fail2.status).toBe(200);
    // …but FAILING is: the rejection arrives in the same response as the decision (I6/I14).
    const fail2Body = envelope<InterviewDto>(fail2);
    expect(fail2Body.workflow.applicantStatus).toBe('rejected');
    expect(fail2Body.workflow.stage).toBeNull();
    expect(fail2Body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['interviewCompleted', 'rejected']),
    );
    expect(counter(fail2Body.counters, `interview:${stage2}`)).toBeDefined();

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
    const interview = mutated<InterviewDto>(await schedule(applicant.id, stage1));
    const first = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: await soloSubmit(interview) });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: mutated<InterviewDto>(first).version });
    expect(second.status).toBe(422);
  });
});

describe('interviews — start now (RW12/A3)', () => {
  const start = (applicantId: string, stageId: string, over: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/v1/hr/interviews/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId, ...over });

  it('opens the round in progress, with the caller on the panel and a server timestamp', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const before = Date.now();
    const res = await start(applicant.id, stage1);
    expect(res.status).toBe(201);
    const body = envelope<InterviewDto>(res);
    const dto = body.data;
    expect(dto.status).toBe('inProgress');
    expect(dto.startedAt).not.toBeNull();
    expect(new Date(dto.startedAt as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The CURRENT user is the interviewer — the client never supplies one.
    expect(dto.panel.map((p) => p.interviewerId)).toContain(adminUserId);
    // I6 — "start now" jumps waiting → inProgress in one act, and the envelope reports the state
    // it landed in plus BOTH entries the jump wrote.
    expect(body.workflow.status).toBe('inProgress');
    expect(actionEnabled(body.workflow, 'decide')).toBe(true);
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['interviewStarted']),
    );
    expect(counter(body.counters, `interview:${stage1}`)).toBeDefined();
  });

  it('enforces the same entry gate as scheduling', async () => {
    const applicant = await registerApplicant(); // screening not yet accepted
    const stage1 = await stageIdByKey('firstInterview');
    expect((await start(applicant.id, stage1)).status).toBe(422);
  });

  it('starts a round that was already scheduled and lets it be decided', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const created = mutated<InterviewDto>(await schedule(applicant.id, stage1));

    const started = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: created.version });
    expect(started.status).toBe(200);
    // Starting the round put the caller on the panel, so both members must now submit.
    const afterPanel = mutated<InterviewDto>(started);
    expect(afterPanel.status).toBe('inProgress');
    expect(afterPanel.panel.map((p) => p.interviewerId)).toContain(adminUserId);
    const afterInterviewer = await soloSubmit(afterPanel);
    const adminSubmitted = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/evaluations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ recommendation: 'recommend', rating: 5, version: afterInterviewer });
    expect(adminSubmitted.status).toBe(200);

    const decided = await request(app)
      .post(`/api/v1/hr/interviews/${created.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: mutated<InterviewDto>(adminSubmitted).version });
    expect(decided.status).toBe(200);
    const decidedBody = envelope<InterviewDto>(decided);
    expect(decidedBody.data.status).toBe('completed');
    expect(decidedBody.data.outcome).toBe('passed');
    expect(decidedBody.timeline.produced.map((e) => e.type)).toContain('interviewCompleted');
  });
});

describe('interviews — bulk (RW17/I4)', () => {
  it('cancels a selection and reports one result per id', async () => {
    const stage1 = await stageIdByKey('firstInterview');
    const a = mutated<InterviewDto>(await schedule((await acceptedApplicant()).id, stage1));
    const b = mutated<InterviewDto>(await schedule((await acceptedApplicant()).id, stage1));

    const res = await request(app)
      .post('/api/v1/hr/interviews/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'cancel', ids: [a.id, b.id], reason: 'requisition frozen' });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    // I6/RW17 — one entry per round that moved, plus the refreshed board counters.
    expect(result.timeline.produced.map((e) => e.type)).toEqual([
      'interviewCancelled',
      'interviewCancelled',
    ]);
    expect(counter(result.counters, `interview:${stage1}`)).toBeDefined();

    const after = await request(app)
      .get(`/api/v1/hr/interviews/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as InterviewDto).status).toBe('cancelled');
  });

  it('refuses a bulk cancel with no reason', async () => {
    const stage1 = await stageIdByKey('firstInterview');
    const a = mutated<InterviewDto>(await schedule((await acceptedApplicant()).id, stage1));
    const res = await request(app)
      .post('/api/v1/hr/interviews/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'cancel', ids: [a.id] });
    expect(res.status).toBe(400);
  });

  it('schedules one date and panel across a selection of applicants', async () => {
    const stage1 = await stageIdByKey('firstInterview');
    const one = await acceptedApplicant();
    const two = await acceptedApplicant();

    const res = await request(app)
      .post('/api/v1/hr/interviews/bulk/schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        applicantIds: [one.id, two.id],
        stageId: stage1,
        scheduledAt: FUTURE,
        interviewerIds: [interviewerId],
      });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(2);
    expect(result.timeline.produced.map((e) => e.type)).toEqual([
      'interviewScheduled',
      'interviewScheduled',
    ]);
    expect(counter(result.counters, `interview:${stage1}`)).toBeDefined();

    const listed = await request(app)
      .get('/api/v1/hr/interviews')
      .query({ applicantId: one.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((listed.body.data as InterviewDto[])[0]?.status).toBe('scheduled');
  });

  it('starts rounds immediately across a selection of applicants', async () => {
    const stage1 = await stageIdByKey('firstInterview');
    const one = await acceptedApplicant();
    const two = await acceptedApplicant();

    const res = await request(app)
      .post('/api/v1/hr/interviews/bulk/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [one.id, two.id], stageId: stage1 });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(2);
    expect(result.timeline.produced.map((e) => e.type)).toContain('interviewStarted');
    expect(counter(result.counters, `interview:${stage1}`)).toBeDefined();

    const listed = await request(app)
      .get('/api/v1/hr/interviews')
      .query({ applicantId: two.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((listed.body.data as InterviewDto[])[0]?.status).toBe('inProgress');
  });

  /**
   * The bulk routes are `/bulk/start` and `/bulk/schedule`. The single-candidate route is
   * `/start`, and its schema is `.strict()` — posting a bulk body there is a 400, not a partial
   * success. Pinned because the web client once did exactly that and the failure was invisible
   * server-side: every request was well-formed HTTP and simply refused.
   */
  it('refuses a bulk body on the single-candidate start route', async () => {
    const stage1 = await stageIdByKey('firstInterview');
    const one = await acceptedApplicant();
    const res = await request(app)
      .post('/api/v1/hr/interviews/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [one.id], stageId: stage1 });
    expect(res.status).toBe(400);
  });
});

// RW12 — starting one candidate's round stamps the actor and the moment server-side. The client
// sends neither, so a wrong browser clock or a spoofed field cannot rewrite when a round began.
describe('interviews — Start assigns the current user and the server clock', () => {
  it('stamps startedBy/startedAt and seats the caller when starting a scheduled round', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const scheduled = mutated<InterviewDto>(await schedule(applicant.id, stage1));
    expect(scheduled.startedAt).toBeNull();

    const before = Date.now();
    const res = await request(app)
      .post(`/api/v1/hr/interviews/${scheduled.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: scheduled.version });
    expect(res.status).toBe(200);

    const started = mutated<InterviewDto>(res);
    expect(started.status).toBe('inProgress');
    expect(started.startedBy).toBe(adminUserId);
    expect(started.startedAt).not.toBeNull();
    expect(new Date(started.startedAt as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The caller is on the panel afterwards whether or not they were seated before.
    expect(started.panel.map((p) => p.interviewerId)).toContain(adminUserId);
  });

  it('opens the waiting round and starts it in one act for a candidate with no scheduled round', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');

    const res = await request(app)
      .post('/api/v1/hr/interviews/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id, stageId: stage1, interviewerIds: [] });
    expect(res.status).toBe(201);

    const started = mutated<InterviewDto>(res);
    expect(started.status).toBe('inProgress');
    expect(started.startedBy).toBe(adminUserId);
    expect(started.panel.map((p) => p.interviewerId)).toContain(adminUserId);
  });
});

// RW5 — the panel's advisory placement recommendation. Data on the record, never a move.
describe('interviews — placement recommendation', () => {
  it('records, then clears, a recommendation without moving the candidate', async () => {
    const applicant = await acceptedApplicant();
    const stage1 = await stageIdByKey('firstInterview');
    const iv = mutated<InterviewDto>(await schedule(applicant.id, stage1));

    const set = await request(app)
      .patch(`/api/v1/hr/interviews/${iv.id}/recommendation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        recommendedPlacement: {
          jobPositionId: null,
          jobTitleId: null,
          departmentId: null,
          sectionId: null,
          branchId: applicant.placement.branchId,
        },
        recommendationNote: 'better suited to the other branch',
        version: iv.version,
      });
    expect(set.status).toBe(200);
    const setBody = envelope<InterviewDto>(set);
    const withRec = setBody.data;
    expect(withRec.recommendedPlacement).not.toBeNull();
    expect(withRec.recommendationNote).toBe('better suited to the other branch');
    // RW5 — a recommendation is advisory: the candidate's placement in the envelope is unchanged,
    // and nothing was written to their history.
    expect(setBody.workflow.placement).toEqual(applicant.placement);
    expect(setBody.timeline.produced).toEqual([]);

    // The candidate has NOT moved — a recommendation is advisory (RW5).
    const candidate = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((candidate.body.data as ApplicantDto).placement).toEqual(applicant.placement);

    const cleared = await request(app)
      .patch(`/api/v1/hr/interviews/${iv.id}/recommendation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ recommendedPlacement: null, version: withRec.version });
    expect(cleared.status).toBe(200);
    expect(mutated<InterviewDto>(cleared).recommendedPlacement).toBeNull();
  });
});
