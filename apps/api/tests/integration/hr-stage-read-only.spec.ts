// A stage the candidate has moved past is READ-ONLY — enforced on the server, not only hidden.
//
// THE COMPLAINT THIS ANSWERS. «Action buttons show on stages the applicant has already finished.»
// A candidate standing at «الفحص الأمني» still had «بدء المقابلة» and «تعديل القرار» offered on
// their screening, and «نقل لمرحلة عرض العمل» on their finished first interview — and pressing one
// did what it said. Hiding the buttons is a courtesy; this is the control, because a tab left open
// while a colleague advanced the candidate, or a request sent by hand, meets the server and not
// the page.
//
// It also pins the two things a cruder rule would have broken:
//   • the security check and the medical check are OPEN TOGETHER (`openEvaluationPhases` opens
//     every applicable phase at once), so both must stay decidable — a rule that picked "the one
//     current stage" would close whichever of the two it did not pick;
//   • moving to the Job Offer stage stays HR's own call, and becomes available the moment there is
//     nothing left to decide rather than being blocked for ever.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EvaluationDto,
  type InterviewDto,
  type RecruitmentTimelineEntryDto,
  type ScreeningDto,
  type WorkflowStateDto,
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
import { mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let interviewerId = '';
let interviewerToken = '';
let phoneCounter = 71_000_000;

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-stage-read-only-${String(Date.now())}`;
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
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

const sourceId = async (): Promise<string> => {
  const found = data<{ id: string; key: string }[]>(
    await asAdmin('get', '/hr/applicant-sources').query({ pageSize: 50 }),
  ).find((s) => s.key === 'internalHr');
  if (found === undefined) throw new Error('internalHr source not seeded');
  return found.id;
};

const stageIdOf = async (key: string): Promise<string> => {
  const found = data<{ id: string; key: string }[]>(
    await asAdmin('get', '/hr/interview-stages').query({ pageSize: 50 }),
  ).find((s) => s.key === key);
  if (found === undefined) throw new Error(`stage ${key} not seeded`);
  return found.id;
};

const register = async (fullNameAr: string): Promise<ApplicantDto> => {
  const res = await asAdmin('post', '/hr/applicants').send({
    sourceId: await sourceId(),
    intakeChannel: 'internal',
    identity: { nationalId: nextNationalId(), fullNameAr, nationality: 'Egyptian' },
    contact: { primaryPhone: nextPhone() },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return mutated<ApplicantDto>(res);
};

const screeningOf = async (applicantId: string): Promise<ScreeningDto> => {
  const row = data<ScreeningDto[]>(
    await asAdmin('get', '/hr/screenings').query({ applicantId, pageSize: 10 }),
  )[0];
  if (row === undefined) throw new Error('registration did not open a screening');
  return row;
};

const interviewsOf = async (applicantId: string): Promise<InterviewDto[]> =>
  data<InterviewDto[]>(await asAdmin('get', '/hr/interviews').query({ applicantId, pageSize: 20 }));

const evaluationsOf = async (applicantId: string): Promise<EvaluationDto[]> =>
  data<EvaluationDto[]>(await asAdmin('get', '/hr/evaluations').query({ applicantId, pageSize: 20 }));

const workflowOf = (applicantId: string) =>
  asAdmin('get', `/hr/applicants/${applicantId}/workflow-state`);

/** Pass one round the way the product does: panel recommendation, then the decision. */
const passRound = async (applicantId: string, stageKey: string): Promise<InterviewDto> => {
  const created = mutated<InterviewDto>(
    await asAdmin('post', '/hr/interviews').send({
      applicantId,
      stageId: await stageIdOf(stageKey),
      scheduledAt: '2027-03-01T00:00:00.000Z',
      interviewerIds: [interviewerId],
    }),
  );
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${created.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: created.version });
  expect(submitted.status, `panel evaluation: ${JSON.stringify(submitted.body)}`).toBe(200);
  const decided = await asAdmin('post', `/hr/interviews/${created.id}/decide`).send({
    outcome: 'passed',
    version: mutated<InterviewDto>(submitted).version,
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  return mutated<InterviewDto>(decided);
};

/** A candidate standing at the checks: screening accepted, both rounds passed. */
const atTheChecks = async (
  name: string,
): Promise<{ applicant: ApplicantDto; screening: ScreeningDto; firstRound: InterviewDto }> => {
  const applicant = await register(name);
  const screening = await screeningOf(applicant.id);
  const accepted = await asAdmin('post', `/hr/screenings/${screening.id}/decide`).send({
    outcome: 'accepted',
    version: screening.version,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const firstRound = await passRound(applicant.id, 'firstInterview');
  await passRound(applicant.id, 'secondInterview');
  return { applicant, screening: mutated<ScreeningDto>(accepted), firstRound };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('read-only-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const panelRole = await rbacService.createRole(
    { name: { en: 'Interviewer', ar: 'مُحاور' }, permissionKeys: ['interview.view', 'interview.evaluate'] },
    adminId,
  );
  interviewerId = await mkUser('read-only-panel@ecms.local');
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
  adminToken = await login('read-only-admin@ecms.local');
  interviewerToken = await login('read-only-panel@ecms.local');
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('a stage the candidate has moved past', () => {
  it('refuses to re-decide the screening, and says where the candidate actually is', async () => {
    const { screening } = await atTheChecks('مُرشَّح الفرز');
    const res = await asAdmin('patch', `/hr/screenings/${screening.id}/decision`).send({
      outcome: 'rejected',
      reason: 'إعادة نظر',
      version: screening.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    // By the time the candidate is at the checks, the refusal is the CORRECTION rule's: the rounds
    // after the screening are decided, so there is nothing left to correct without sending them
    // back. Either way the flip is refused and the message says which stage stands in the way.
    expect(JSON.stringify(res.body)).toContain('no longer be corrected');
  });

  it('refuses to re-decide a finished interview round', async () => {
    const { firstRound } = await atTheChecks('مُرشَّح المقابلة');
    const res = await asAdmin('patch', `/hr/interviews/${firstRound.id}/decision`).send({
      outcome: 'failed',
      notes: 'إعادة نظر',
      version: firstRound.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it('refuses to start an earlier round again — which used to re-open it on a new attempt', async () => {
    // `assertStageEntry` only ever looked BACKWARDS (did they pass the previous round?), and
    // `completed` is terminal for a round, so `ensureStageRecord` obliged with attempt 2 and pulled
    // the candidate back down the pipeline.
    const { applicant } = await atTheChecks('مُرشَّح البداية');
    const before = (await interviewsOf(applicant.id)).length;
    const res = await asAdmin('post', '/hr/interviews/start').send({
      applicantId: applicant.id,
      stageId: await stageIdOf('firstInterview'),
      interviewerIds: [],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((await interviewsOf(applicant.id)).length, 'a refused start must open nothing').toBe(before);
  });

  it('reports the passed stages on the workflow state, so a page need not guess', async () => {
    const { applicant, screening, firstRound } = await atTheChecks('مُرشَّح الحالة');
    const state = data<WorkflowStateDto>(await workflowOf(applicant.id));
    const byId = new Map(state.stageRecords.map((r) => [r.recordId, r]));
    expect(byId.get(screening.id)?.passed, 'the screening is behind them').toBe(true);
    expect(byId.get(firstRound.id)?.passed, 'the first round is behind them').toBe(true);
    for (const evaluation of await evaluationsOf(applicant.id)) {
      expect(byId.get(evaluation.id)?.passed, `${evaluation.phaseKey} is where they stand`).toBe(false);
    }
  });
});

describe('correcting a decision (D7) — allowed while nothing has been built on it', () => {
  /** A candidate whose screening has just been accepted: the first round exists and is untouched. */
  const justAccepted = async (name: string) => {
    const applicant = await register(name);
    const screening = await screeningOf(applicant.id);
    const accepted = await asAdmin('post', `/hr/screenings/${screening.id}/decide`).send({
      outcome: 'accepted',
      version: screening.version,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    return { applicant, screening: mutated<ScreeningDto>(accepted) };
  };

  it('flips an accepted screening back to rejected while the round it opened is untouched', async () => {
    const { applicant, screening } = await justAccepted('مُرشَّح التصحيح');
    const waiting = await interviewsOf(applicant.id);
    expect(waiting.map((i) => i.status), 'acceptance opens the first round').toContain('waiting');

    const res = await asAdmin('patch', `/hr/screenings/${screening.id}/decision`).send({
      outcome: 'rejected',
      reason: 'ظهرت مخالفة بعد القبول',
      version: screening.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // THE UNDO: the round the acceptance opened is closed through the lifecycle (I14) — cancelled,
    // not deleted, which is how this system retires work and what lets a later re-acceptance open
    // a fresh attempt instead of reviving a stale row (I11/I12).
    const after = await interviewsOf(applicant.id);
    expect(after.every((i) => i.status === 'cancelled'), JSON.stringify(after.map((i) => i.status))).toBe(true);
    expect(data<ApplicantDto>(await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe('rejected');
  });

  it('refuses the same correction once the round has been started', async () => {
    const { applicant, screening } = await justAccepted('مُرشَّح المتأخر');
    const started = await asAdmin('post', '/hr/interviews/start').send({
      applicantId: applicant.id,
      stageId: await stageIdOf('firstInterview'),
      interviewerIds: [],
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);

    const res = await asAdmin('patch', `/hr/screenings/${screening.id}/decision`).send({
      outcome: 'rejected',
      reason: 'بعد فوات الأوان',
      version: screening.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain('no longer be corrected');
    // And nothing moved: the round is still running and the candidate is still active.
    expect(data<ApplicantDto>(await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe('new');
  });

  it('reports correctability on the workflow state, beside — not instead of — passed', async () => {
    const { applicant, screening } = await justAccepted('مُرشَّح الحالة الثانية');
    const row = data<WorkflowStateDto>(await workflowOf(applicant.id)).stageRecords.find(
      (r) => r.recordId === screening.id,
    );
    // The screening is BEHIND the candidate and its decision is still correctable. One flag could
    // not say both, which is how «تعديل القرار» came to be offered on a stage long left behind.
    expect(row?.passed).toBe(true);
    expect(row?.correctable).toBe(true);
  });

  it('records the correction on the timeline with the old decision, the new one and who made it', async () => {
    const { applicant, screening } = await justAccepted('مُرشَّح السجل الثاني');
    await asAdmin('patch', `/hr/screenings/${screening.id}/decision`).send({
      outcome: 'rejected',
      reason: 'سبب التصحيح',
      version: screening.version,
    });
    const entries = data<RecruitmentTimelineEntryDto[]>(
      await asAdmin('get', `/hr/applicants/${applicant.id}/timeline`).query({ limit: 100 }),
    );
    const correction = entries.find(
      (e) => e.type === 'screeningDecided' && e.fromStatus === 'accepted' && e.toStatus === 'rejected',
    );
    expect(correction, JSON.stringify(entries.map((e) => [e.type, e.fromStatus, e.toStatus]))).toBeDefined();
    expect(correction?.reason).toBe('سبب التصحيح');
    expect(correction?.actorKind).toBe('user');
    expect(correction?.actorUserId).not.toBeNull();
    // The first decision is still there, unedited — a correction appends, it does not rewrite (I9).
    expect(
      entries.some((e) => e.type === 'screeningDecided' && e.fromStatus === 'waiting' && e.toStatus === 'accepted'),
    ).toBe(true);
  });

  it('refuses a correction on a check once the candidate is past it', async () => {
    // The checks are the last gating stage, so "past" here means a later check has been decided —
    // which is what the earlier suite covers for the screening and the rounds.
    const { applicant } = await atTheChecks('مُرشَّح الفحص المصحَّح');
    const open = (await evaluationsOf(applicant.id)).filter((e) => e.status === 'waiting');
    const first = open[0];
    if (first === undefined) throw new Error('no open check');
    const decided = await asAdmin('patch', `/hr/evaluations/${first.id}/decision`).send({
      decision: 'approved',
      version: first.version,
    });
    expect(decided.status).toBe(200);
    // Correcting it while its siblings are still waiting is allowed — nothing was built on it.
    const corrected = await asAdmin('patch', `/hr/evaluations/${first.id}/decision`).send({
      decision: 'rejected',
      reason: 'تصحيح نتيجة الفحص',
      version: mutated<EvaluationDto>(decided).version,
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
  });
});

describe('the checks are parallel, and both stay decidable', () => {
  it('decides the security check AND the medical examination — neither closes the other', async () => {
    const { applicant } = await atTheChecks('مُرشَّح الفحوص');
    const open = (await evaluationsOf(applicant.id)).filter((e) => e.status === 'waiting');
    expect(open.length, 'more than one phase must open together for this to mean anything').toBeGreaterThan(1);
    for (const evaluation of open) {
      const res = await asAdmin('patch', `/hr/evaluations/${evaluation.id}/decision`).send({
        decision: 'approved',
        version: evaluation.version,
      });
      expect(res.status, `${evaluation.phaseKey}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });
});

describe('moving to the Job Offer stage', () => {
  // THE OFFER RUNS ALONGSIDE THE CHECKS, and that is the design, not an oversight: HR starts the
  // offer when they decide to, and clearing the last check moves the candidate by itself
  // («اي حد يخلص كشف الطبي يظهر … ك جاهزون لعرض العمل»). An earlier version of this suite demanded
  // every check first and took 95 tests across eight suites down with it — the product's own hiring
  // fixtures move to the offer with the checks still open, because that is how hiring works here.
  //
  // So what was wrong was never the move. It was being offered FROM A STAGE THE CANDIDATE HAD
  // LEFT — a finished first interview — which is a question about the page, and the page answers it
  // from `stageRecords` (see `stage-authority.spec.ts`).
  it('is available while the checks are still open', async () => {
    const { applicant } = await atTheChecks('مُرشَّح العرض');
    const state = data<WorkflowStateDto>(await workflowOf(applicant.id));
    expect(state.availableActions.find((a) => a.key === 'moveToOffer')?.enabled).toBe(true);

    const res = await asAdmin('post', `/hr/applicants/${applicant.id}/move-to-offer`).send({
      version: applicant.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('leaves the open checks open — starting the offer decides nothing for them', async () => {
    const { applicant } = await atTheChecks('مُرشَّح التوازي');
    await asAdmin('post', `/hr/applicants/${applicant.id}/move-to-offer`).send({
      version: applicant.version,
    });
    const waiting = (await evaluationsOf(applicant.id)).filter((e) => e.status === 'waiting');
    expect(waiting.length, 'the checks still have to be decided').toBeGreaterThan(0);
    // …and they are still decidable: the offer is not "later" in a way that closes them.
    for (const evaluation of waiting) {
      const res = await asAdmin('patch', `/hr/evaluations/${evaluation.id}/decision`).send({
        decision: 'approved',
        version: evaluation.version,
      });
      expect(res.status, `${evaluation.phaseKey}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it('reports itself DONE rather than blocked once the last check has moved them', async () => {
    const { applicant } = await atTheChecks('مُرشَّح الجاهزية');
    for (const evaluation of (await evaluationsOf(applicant.id)).filter((e) => e.status === 'waiting')) {
      const res = await asAdmin('patch', `/hr/evaluations/${evaluation.id}/decision`).send({
        decision: 'approved',
        version: evaluation.version,
      });
      expect(res.status, `${evaluation.phaseKey}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const moved = data<ApplicantDto>(await asAdmin('get', `/hr/applicants/${applicant.id}`));
    expect(moved.movedToOfferAt, 'clearing the last check moves them').not.toBeNull();

    const state = data<WorkflowStateDto>(await workflowOf(applicant.id));
    const action = state.availableActions.find((a) => a.key === 'moveToOffer');
    expect(action?.enabled).toBe(false);
    expect(action?.reason).toBe('already in the Job Offer stage');
  });
});

describe('«إرجاع إلى مرحلة سابقة» is behind its own key', () => {
  it('refuses a holder of every other applicant authority', async () => {
    const applicant = await register('مُرشَّح الإرجاع');
    const role = await rbacService.createRole(
      {
        name: { en: 'Recruiter', ar: 'مسؤول توظيف' },
        // Everything HR does to a candidate, short of sending them back a stage.
        permissionKeys: [
          'applicant.view',
          'applicant.create',
          'applicant.edit',
          'applicant.delete',
          'applicant.export',
          'applicant.reassign',
          'applicant.moveToOffer',
          'screening.view',
          'screening.decide',
          'interview.view',
          'interview.create',
          'interview.decide',
        ],
      },
      interviewerId,
    );
    const userId = await mkUser('read-only-recruiter@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    const token = await login('read-only-recruiter@ecms.local');
    const res = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/return-to-stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: { kind: 'screening', refId: null }, reason: 'إعادة', version: applicant.version });
    expect(res.status).toBe(403);
  });
});

describe('the timeline says WHICH round or phase, and WHO', () => {
  it('names the phase on an opened check, so two phases are not one event twice', async () => {
    const { applicant } = await atTheChecks('مُرشَّح السجل');
    const entries = data<RecruitmentTimelineEntryDto[]>(
      await asAdmin('get', `/hr/applicants/${applicant.id}/timeline`).query({ limit: 100 }),
    );
    const opened = entries.filter((e) => e.type === 'evaluationOpened');
    expect(opened.length, 'the checks open together').toBeGreaterThan(1);
    for (const entry of opened) {
      expect(entry.stage?.name?.ar, 'an opened check must name itself').toBeTruthy();
    }
    // …and the two entries name DIFFERENT phases, which is what made them look duplicated.
    expect(new Set(opened.map((e) => e.stage?.key)).size).toBe(opened.length);
  });

  it('calls an opened round an opened round, not an appointment nobody made', async () => {
    const { applicant } = await atTheChecks('مُرشَّح الموعد');
    const entries = data<RecruitmentTimelineEntryDto[]>(
      await asAdmin('get', `/hr/applicants/${applicant.id}/timeline`).query({ limit: 100 }),
    );
    expect(entries.some((e) => e.type === 'interviewOpened')).toBe(true);
  });

  it('attributes a materialized stage to the system and a decision to the person', async () => {
    const { applicant, screening } = await atTheChecks('مُرشَّح الفاعل');
    const entries = data<RecruitmentTimelineEntryDto[]>(
      await asAdmin('get', `/hr/applicants/${applicant.id}/timeline`).query({ limit: 100 }),
    );
    const opened = entries.find((e) => e.type === 'evaluationOpened');
    expect(opened?.actorKind, 'nobody chose to open the checks — a decision did').toBe('system');
    const decided = entries.find(
      (e) => e.type === 'screeningDecided' && e.entityRef?.entityId === screening.id,
    );
    expect(decided?.actorKind).toBe('user');
    expect(decided?.actorUserId).not.toBeNull();
  });
});
