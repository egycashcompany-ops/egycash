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
import { actionEnabled, bulkEnvelope, counter, envelope, mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
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
      sourceId,
      intakeChannel: 'internal',
      identity: { nationalId: nextNationalId(), fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
      ...over,
    });
  expect(res.status).toBe(201);
  return mutated<ApplicantDto>(res);
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
  it('opens a waiting screening (one per applicant) and stores an initial note', async () => {
    const applicant = await registerApplicant();
    const res = await openScreening(applicant.id, adminToken, 'looks promising');
    expect(res.status).toBe(201);
    const body = envelope<ScreeningDto>(res);
    const dto = body.data;
    expect(dto.status).toBe('waiting');
    expect(dto.applicantId).toBe(applicant.id);
    expect(dto.applicantCode).toBe(applicant.code);
    expect(dto.decision).toBeNull();
    expect(dto.notes.map((n) => n.text)).toEqual(['looks promising']);

    // I6 — the same response says where the candidate now stands, so the client asks nothing else.
    expect(body.workflow.applicantId).toBe(applicant.id);
    expect(body.workflow.applicantCode).toBe(applicant.code);
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.stage?.kind).toBe('screening');
    expect(body.workflow.status).toBe('waiting');
    // Capability lives in `availableActions` and nowhere else (I10).
    expect(actionEnabled(body.workflow, 'accept')).toBe(true);
    expect(actionEnabled(body.workflow, 'reject')).toBe(true);
    expect(body.timeline.total).toBeGreaterThan(0);
    expect(counter(body.counters, 'screening')?.count).toBeGreaterThan(0);
  });

  it('is idempotent while waiting, and refuses once the screening is decided', async () => {
    const applicant = await registerApplicant();
    const first = mutated<ScreeningDto>(await openScreening(applicant.id));
    // The record is materialized at registration (I11), so opening again returns the same row.
    const again = await openScreening(applicant.id);
    expect(again.status).toBe(201);
    expect(mutated<ScreeningDto>(again).id).toBe(first.id);

    await request(app)
      .post(`/api/v1/hr/screenings/${first.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: first.version });
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

// I11 — the queue is REAL rows whose status is `waiting`, materialized at registration. There is
// no derived "who ought to be here" read model that could disagree with them.
describe('screening — the waiting queue is persisted rows', () => {
  const waitingIds = async (): Promise<string[]> => {
    const res = await request(app)
      .get('/api/v1/hr/screenings?status=waiting&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // A read — the list endpoint answers with the page it always did (I6 leaves GETs alone).
    return (res.body.data as ScreeningDto[]).map((r) => r.applicantId);
  };

  it('materializes a waiting screening at registration; the DECISION is what clears it', async () => {
    const applicant = await registerApplicant();
    expect(await waitingIds()).toContain(applicant.id);

    // Opening does not clear the queue — the record was already waiting (I11).
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));
    expect(await waitingIds()).toContain(applicant.id);

    const decided = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    expect(decided.status).toBe(200);
    expect(await waitingIds()).not.toContain(applicant.id);

    // I6 — the counters that ride along are the REFRESHED ones, so the badge the client redraws
    // matches the queue this very request just changed.
    const body = envelope<ScreeningDto>(decided);
    expect(counter(body.counters, 'screening')).toBeDefined();
    expect(body.workflow.stage?.kind).not.toBe('screening');
  });

  /**
   * I14/I1/I10 — a departed candidate leaves the queue because their record carries a terminal
   * STATUS, not because anything mirrors the lifecycle onto the stage. Reactivation therefore
   * re-opens the stage on a NEW attempt; the closed attempt stays readable forever.
   */
  it('closes the waiting screening on withdrawal and re-opens a new attempt on restore', async () => {
    const applicant = await registerApplicant();
    expect(await waitingIds()).toContain(applicant.id);

    const withdrawRes = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'not interested', version: applicant.version });
    const withdrawBody = envelope<ApplicantDto>(withdrawRes);
    const withdrawn = withdrawBody.data;
    // I6 — a lifecycle exit reports the state it produced: nowhere to stand, nothing open (I14).
    expect(withdrawBody.workflow.applicantStatus).toBe('withdrawn');
    expect(withdrawBody.workflow.stage).toBeNull();
    expect(withdrawBody.workflow.status).toBeNull();
    expect(actionEnabled(withdrawBody.workflow, 'restore')).toBe(true);
    expect(withdrawBody.timeline.produced.map((e) => e.type)).toContain('withdrawn');
    expect(counter(withdrawBody.counters, 'screening')).toBeDefined();
    expect(await waitingIds()).not.toContain(applicant.id);

    // The record is CLOSED, not deleted and not flagged — its own status says so.
    const own = async (): Promise<ScreeningDto[]> => {
      const res = await request(app)
        .get(`/api/v1/hr/screenings?applicantId=${applicant.id}&pageSize=50`)
        .set('Authorization', `Bearer ${adminToken}`);
      return res.body.data as ScreeningDto[]; // a read — unchanged by I6
    };
    const afterWithdraw = await own();
    expect(afterWithdraw).toHaveLength(1);
    expect(afterWithdraw[0]?.status).toBe('cancelled');
    expect(afterWithdraw[0]?.attempt).toBe(1);

    const restored = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: withdrawn.version });
    expect(restored.status).toBe(200);
    expect(await waitingIds()).toContain(applicant.id);

    // I6 — the reactivation answers with the NEW attempt it just materialized (I11/I12), so the
    // screen the user is looking at can redraw itself without asking where the candidate went.
    const restoredBody = envelope<ApplicantDto>(restored);
    expect(restoredBody.workflow.applicantStatus).toBe('new');
    expect(restoredBody.workflow.stage?.kind).toBe('screening');
    expect(restoredBody.workflow.status).toBe('waiting');
    expect(restoredBody.workflow.attempt).toBe(2);
    expect(restoredBody.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['restored', 'screeningOpened']),
    );
    expect(counter(restoredBody.counters, 'screening')).toBeDefined();

    // Attempt 1 is untouched history; attempt 2 is the live row (I11/I12).
    const afterRestore = await own();
    expect(afterRestore).toHaveLength(2);
    const byAttempt = new Map(afterRestore.map((r) => [r.attempt, r.status]));
    expect(byAttempt.get(1)).toBe('cancelled');
    expect(byAttempt.get(2)).toBe('waiting');
  });
});

describe('screening — notes (needs more information)', () => {
  it('appends a note and stays pending', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id, adminToken, 'first'));
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'requested transcripts', version: screening.version });
    expect(res.status).toBe(200);
    const body = envelope<ScreeningDto>(res);
    const dto = body.data;
    expect(dto.status).toBe('waiting');
    expect(dto.notes.map((n) => n.text)).toEqual(['first', 'requested transcripts']);

    // I6 — an action that moves nothing still answers with the envelope: the state is unchanged and
    // the timeline produced nothing, which is a truthful answer rather than a missing one.
    expect(body.workflow.stage?.kind).toBe('screening');
    expect(body.workflow.status).toBe('waiting');
    expect(body.timeline.produced).toEqual([]);
    expect(actionEnabled(body.workflow, 'accept')).toBe(true);
    expect(counter(body.counters, 'screening')).toBeDefined();
  });
});

describe('screening — decide', () => {
  it('accepts a screening and leaves the applicant live', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    expect(res.status).toBe(200);
    const body = envelope<ScreeningDto>(res);
    expect(body.data.status).toBe('accepted');
    expect(body.data.decision?.outcome).toBe('accepted');

    // I6 — the decision's own response carries the candidate FORWARD: acceptance materializes the
    // first interview round (I11), and the envelope already says the candidate stands there. This
    // is the whole point of the invariant — no follow-up request, and no window in which the client
    // could read a different answer than the one this action produced.
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.stage?.kind).toBe('interview');
    expect(body.workflow.status).toBe('waiting');
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['screeningDecided', 'interviewScheduled']),
    );
    expect(body.timeline.latest.length).toBeGreaterThan(0);
    expect(counter(body.counters, 'screening')).toBeDefined();
    expect(counter(body.counters, 'applicants')).toBeDefined();

    // The read is unchanged (I6 touches mutations only).
    const after = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('new');
  });

  it('rejects a screening, transitioning the applicant to rejected', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', reason: 'insufficient experience', version: screening.version });
    expect(res.status).toBe(200);
    const body = envelope<ScreeningDto>(res);
    expect(body.data.decision?.reason).toBe('insufficient experience');

    // The lifecycle moved with the decision, and the envelope says so without a second request.
    expect(body.workflow.applicantStatus).toBe('rejected');
    expect(body.workflow.stage).toBeNull();
    expect(actionEnabled(body.workflow, 'reactivate')).toBe(true);
    expect(body.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['screeningDecided', 'rejected']),
    );
    expect(counter(body.counters, 'screening')).toBeDefined();

    const after = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('rejected');
  });

  it('requires a reason to reject', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', version: screening.version });
    expect(res.status).toBe(400);
  });

  it('refuses to decide a screening twice', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));
    const first = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: screening.version });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: mutated<ScreeningDto>(first).version });
    expect(second.status).toBe(422);
  });

  it('frees the live National ID once the applicant is rejected', async () => {
    const nid = '29001011500018';
    const first = await registerApplicant({
      identity: { fullNameAr: 'خالد', nationality: 'Egyptian', nationalId: nid },
    });
    const screening = mutated<ScreeningDto>(await openScreening(first.id));
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
    const createdBody = envelope<ScreeningDto>(created);
    const screening = createdBody.data;

    // I6/I10 — the envelope the screener receives already tells them they may NOT decide, and why,
    // rather than leaving the UI to guess and the request to fail at the gate.
    expect(actionEnabled(createdBody.workflow, 'accept')).toBe(false);
    expect(
      createdBody.workflow.availableActions.find((a) => a.key === 'accept')?.reason,
    ).toBe('requires screening.decide');

    const noted = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/notes`)
      .set('Authorization', `Bearer ${screenerToken}`)
      .send({ note: 'follow-up call done', version: screening.version });
    expect(noted.status).toBe(200);
    const notedBody = envelope<ScreeningDto>(noted);

    const deniedDecide = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${screenerToken}`)
      .send({ outcome: 'accepted', version: notedBody.data.version });
    expect(deniedDecide.status).toBe(403);

    const adminDecide = await request(app)
      .post(`/api/v1/hr/screenings/${screening.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: notedBody.data.version });
    expect(adminDecide.status).toBe(200);
    // The same list, built for a caller who DOES hold the permission, no longer refuses it.
    const adminBody = envelope<ScreeningDto>(adminDecide);
    expect(adminBody.workflow.availableActions.every((a) => a.permission !== '')).toBe(true);
    expect(adminBody.timeline.produced.map((e) => e.type)).toContain('screeningDecided');
  });
});

describe('screening — bulk approve/reject (RW17/I4)', () => {
  const bulk = (body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post('/api/v1/hr/screenings/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('approves a selection and reports one result per id', async () => {
    const a = mutated<ScreeningDto>(await openScreening((await registerApplicant()).id));
    const b = mutated<ScreeningDto>(await openScreening((await registerApplicant()).id));

    const res = await bulk({ action: 'approve', ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());

    // I6/RW17 — a bulk act spans many candidates, so there is no single `workflow`; what it CAN
    // answer is everything it wrote and the refreshed counters, which is what the queue redraws.
    expect(result.timeline.produced.map((e) => e.type)).toContain('screeningDecided');
    expect(result.timeline.produced.length).toBeGreaterThanOrEqual(2);
    expect(counter(result.counters, 'screening')).toBeDefined();

    for (const id of [a.id, b.id]) {
      const after = await request(app)
        .get(`/api/v1/hr/screenings/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect((after.body.data as ScreeningDto).status).toBe('accepted');
    }
  });

  it('applies the successful items and reports the failing one (partial success)', async () => {
    const good = mutated<ScreeningDto>(await openScreening((await registerApplicant()).id));
    const decided = mutated<ScreeningDto>(await openScreening((await registerApplicant()).id));
    // Already accepted → `accepted → accepted` is not a legal move, so this id fails.
    await request(app)
      .post(`/api/v1/hr/screenings/${decided.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: decided.version });

    const res = await bulk({ action: 'approve', ids: [good.id, decided.id] });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.id === decided.id)?.ok).toBe(false);
    expect(result.results.find((r) => r.id === good.id)?.ok).toBe(true);
    // Only the item that actually moved wrote history — the refused one produced nothing.
    expect(result.timeline.produced.filter((e) => e.type === 'screeningDecided')).toHaveLength(1);
  });

  it('requires a reason to reject and rejects the applicants when given one', async () => {
    const applicant = await registerApplicant();
    const screening = mutated<ScreeningDto>(await openScreening(applicant.id));

    expect((await bulk({ action: 'reject', ids: [screening.id] })).status).toBe(400);

    const res = await bulk({ action: 'reject', ids: [screening.id], reason: 'no relevant experience' });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(1);
    expect(result.timeline.produced.map((e) => e.type)).toEqual(
      expect.arrayContaining(['screeningDecided', 'rejected']),
    );
    expect(counter(result.counters, 'applicants')).toBeDefined();

    const after = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as ApplicantDto).status).toBe('rejected');
  });

  it('needs the decide permission', async () => {
    const screening = mutated<ScreeningDto>(await openScreening((await registerApplicant()).id));
    expect((await bulk({ action: 'approve', ids: [screening.id] }, screenerToken)).status).toBe(403);
  });
});

/**
 * Candidate-attribute filters (age range, education level). These are the first screening filters
 * whose predicate lives on the APPLICANT rather than on the screening — the record denormalizes
 * only what it displays (I1) — so the interesting thing to prove is not "a filter works" but that
 * the cross-collection narrowing is correct at its edges and composes with everything else.
 *
 * Birth dates are seeded through the national ID, because that is the only way an applicant gets
 * one: it is derived at registration, never client-set.
 */
describe('screening — candidate-attribute filters (age, education)', () => {
  /** `2`/`3` = 1900s/2000s, then YYMMDD, governorate, serial. No checksum is enforced. */
  const nid = (century: '2' | '3', yy: string, mm: string, dd: string, serial: string): string =>
    `${century}${yy}${mm}${dd}01${serial}`;

  interface Seeded {
    thirtyExactly: string;
    twentyFive: string;
    fortyOne: string;
    noBirthDate: string;
  }
  let seeded: Seeded;

  const list = (query: Record<string, string | number>) =>
    request(app)
      .get('/api/v1/hr/screenings')
      .query({ pageSize: 100, ...query })
      .set('Authorization', `Bearer ${adminToken}`);

  const codesIn = (res: { body: unknown }): string[] =>
    ((res.body as { data: { applicantCode: string }[] }).data ?? []).map((s) => s.applicantCode);

  beforeAll(async () => {
    // Ages are relative to "today", so the seed is expressed as birth dates that are a fixed
    // distance from it rather than as fixed years.
    const today = new Date();
    const yy = (yearsAgo: number): { century: '2' | '3'; yy: string } => {
      const year = today.getUTCFullYear() - yearsAgo;
      return { century: year < 2000 ? '2' : '3', yy: String(year % 100).padStart(2, '0') };
    };
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');

    const a30 = yy(30);
    const a25 = yy(25);
    const a41 = yy(41);

    const mk = async (nationalId: string | undefined, level: string | undefined): Promise<string> => {
      const applicant = await registerApplicant({
        ...(nationalId === undefined
          ? {}
          : { identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian', nationalId } }),
        ...(level === undefined ? {} : { education: { level } }),
      });
      return applicant.code;
    };

    seeded = {
      // Birthday today → exactly 30 / 25 / 41.
      thirtyExactly: await mk(nid(a30.century, a30.yy, mm, dd, '11111'), 'bachelor'),
      twentyFive: await mk(nid(a25.century, a25.yy, mm, dd, '22222'), 'diploma'),
      fortyOne: await mk(nid(a41.century, a41.yy, mm, dd, '33333'), 'bachelor'),
      // No national ID → no birth date, and no education record either.
      noBirthDate: await mk(undefined, undefined),
    };
  }, 60_000);

  it('an age range selects its band and excludes everyone outside it', async () => {
    const res = await list({ ageFrom: 25, ageTo: 30 });
    expect(res.status).toBe(200);
    const codes = codesIn(res);
    expect(codes).toContain(seeded.thirtyExactly);
    expect(codes).toContain(seeded.twentyFive);
    expect(codes).not.toContain(seeded.fortyOne);
  });

  it('includes the candidate whose birthday is today at BOTH ends of the range', async () => {
    // The half-open conversion is the easy thing to get wrong: 30 must be in [25,30] and in [30,40].
    expect(codesIn(await list({ ageFrom: 30, ageTo: 30 }))).toContain(seeded.thirtyExactly);
    expect(codesIn(await list({ ageFrom: 25, ageTo: 30 }))).toContain(seeded.thirtyExactly);
    expect(codesIn(await list({ ageFrom: 30, ageTo: 40 }))).toContain(seeded.thirtyExactly);
    expect(codesIn(await list({ ageFrom: 31, ageTo: 40 }))).not.toContain(seeded.thirtyExactly);
  });

  it('excludes candidates with no birth date — unknown age cannot satisfy a range', async () => {
    const codes = codesIn(await list({ ageFrom: 0, ageTo: 120 }));
    expect(codes).not.toContain(seeded.noBirthDate);
    expect(codes).toContain(seeded.thirtyExactly);
  });

  it('filters by education level, excluding candidates with no education record', async () => {
    const codes = codesIn(await list({ educationLevel: 'bachelor' }));
    expect(codes).toContain(seeded.thirtyExactly);
    expect(codes).toContain(seeded.fortyOne);
    expect(codes).not.toContain(seeded.twentyFive); // diploma
    expect(codes).not.toContain(seeded.noBirthDate); // no education
  });

  it('combines age and education — both must hold, not either', async () => {
    const codes = codesIn(await list({ ageFrom: 25, ageTo: 35, educationLevel: 'bachelor' }));
    expect(codes).toContain(seeded.thirtyExactly);
    expect(codes).not.toContain(seeded.twentyFive); // in the age band, wrong level
    expect(codes).not.toContain(seeded.fortyOne); // right level, outside the band
  });

  it('composes with the ordinary filters, sorting and pagination', async () => {
    const res = await list({
      status: 'waiting',
      educationLevel: 'bachelor',
      sortBy: 'createdAt',
      sortDir: 'asc',
      page: 1,
      pageSize: 1,
    });
    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[]; meta: { pageSize: number; totalItems: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.pageSize).toBe(1);
    // The count is the FILTERED total, not the collection's — otherwise the pager lies.
    expect(body.meta.totalItems).toBeGreaterThanOrEqual(2);
    expect(body.meta.totalItems).toBeLessThan(100);
  });

  it('a filter that matches nobody returns an empty page, not everything', async () => {
    const res = await list({ ageFrom: 119, ageTo: 120 });
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it('rejects an inverted age range at the boundary rather than answering with nothing', async () => {
    const res = await list({ ageFrom: 40, ageTo: 20 });
    expect(res.status).toBe(400);
  });

  it('leaves results untouched when neither attribute filter is supplied', async () => {
    const all = codesIn(await list({}));
    expect(all).toContain(seeded.noBirthDate);
    expect(all).toContain(seeded.thirtyExactly);
  });
});

/**
 * Free-text search. The contract has declared `search` on this endpoint since Stage 2, but nothing
 * implemented it — a client could send it and get an unfiltered list back, which is worse than a
 * 400 because it looks like it worked.
 */
describe('screening — free-text search', () => {
  const list = (query: Record<string, string | number>) =>
    request(app)
      .get('/api/v1/hr/screenings')
      .query({ pageSize: 100, ...query })
      .set('Authorization', `Bearer ${adminToken}`);

  const codesIn = (res: { body: unknown }): string[] =>
    ((res.body as { data: { applicantCode: string }[] }).data ?? []).map((s) => s.applicantCode);

  it('narrows to the matching applicant code instead of ignoring the parameter', async () => {
    const all = codesIn(await list({}));
    expect(all.length).toBeGreaterThan(1);

    const target = all[0] as string;
    const found = codesIn(await list({ search: target }));
    expect(found).toContain(target);
    expect(found.length).toBeLessThan(all.length);
  });

  it('treats a regex metacharacter as a literal, not as a pattern', async () => {
    expect(codesIn(await list({ search: '.' }))).toHaveLength(0);
  });

  it('a search matching nobody returns an empty page, not everything', async () => {
    expect(codesIn(await list({ search: 'no-such-candidate-anywhere' }))).toHaveLength(0);
  });
});
