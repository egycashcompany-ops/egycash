// Stage 4 — HR / Recruitment: Job Offer integration suite. Boots the HR manifest and drives
// an applicant through the full pipeline (register → screening accepted → both interview
// rounds passed) to become offer-eligible, then exercises the offer lifecycle: draft →
// revise (version history) → send (+ manager notification) → accept / reject / withdraw, the
// automatic-expiration sweep, the "one active offer per applicant" invariant, the interview-
// completion gate, and the accepted-offer gate that Employee Creation (Stage 5) will consult.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type AwaitingOfferCandidateDto,
  type EvaluationDto,
  type InterviewDto,
  type JobOfferDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { jobOfferService } from '../../src/modules/hr/recruitment/job-offers';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { actionEnabled, bulkEnvelope, counter, envelope, mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
const JOB_TITLE_ID = '64b1f0cccccccccccccccc01';
const DEPARTMENT_ID = '64b1f0cccccccccccccccc02';
const BRANCH_ID = '64b1f0cccccccccccccccc03';
const FUTURE_VALID = '2027-03-01T00:00:00.000Z';
const PAST_VALID = '2020-01-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let aliceToken: string;
let interviewerId: string; // sits on interview panels AND is the offers' hiring manager
let interviewerToken: string;
let phoneCounter = 30_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-offer-test-${Date.now()}`;
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

const idByKey = async (path: string, key: string): Promise<string> => {
  const res = await request(app).get(`/api/v1/hr/${path}`).query({ pageSize: 50 }).set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`${path}/${key} not seeded`);
  return found.id;
};

const registerApplicant = async (): Promise<ApplicantDto> => {
  const sourceId = await idByKey('applicant-sources', 'internalHr');
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sourceId,
      intakeChannel: 'internal',
      identity: { nationalId: nextNationalId(), fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  return mutated<ApplicantDto>(res);
};

const acceptScreening = async (applicantId: string): Promise<void> => {
  const screening = mutated<ScreeningDto>(
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId }),
  );
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status).toBe(200);
};

const passStage = async (applicantId: string, stageKey: string): Promise<void> => {
  const stageId = await idByKey('interview-stages', stageKey);
  const interview = mutated<InterviewDto>(
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId, scheduledAt: FUTURE_VALID, interviewerIds: [interviewerId] }),
  );
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: interview.version });
  expect(submitted.status).toBe(200);
  const decided = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'passed', version: mutated<InterviewDto>(submitted).version });
  expect(decided.status).toBe(200);
};

/** Explicitly move the applicant to the Job Offer stage (eligibility is never automatic). */
const moveToOffer = async (applicant: ApplicantDto): Promise<void> => {
  const current = await request(app)
    .get(`/api/v1/hr/applicants/${applicant.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  const moved = await request(app)
    .post(`/api/v1/hr/applicants/${applicant.id}/move-to-offer`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: (current.body.data as ApplicantDto).version }); // a read
  expect(moved.status).toBe(200);
  const body = envelope<ApplicantDto>(moved);
  expect(body.data.movedToOfferAt).not.toBeNull();
  // I6/I11 — the move materialized the waiting offer row, and the envelope already stands there.
  expect(body.workflow.stage?.kind).toBe('jobOffer');
  expect(body.workflow.status).toBe('waiting');
  expect(body.timeline.produced.map((e) => e.type)).toContain('offerDrafted');
  expect(counter(body.counters, 'jobOffers')).toBeDefined();
};

/** An applicant HR has explicitly moved to the Job Offer stage — offer-eligible. */
const offerReadyApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  await acceptScreening(applicant.id);
  await moveToOffer(applicant);
  return applicant;
};

const offerTerms = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobTitleId: JOB_TITLE_ID,
  departmentId: DEPARTMENT_ID,
  branchId: BRANCH_ID,
  managerId: interviewerId,
  employmentType: 'fullTime',
  salary: { amount: 15000, currency: 'EGP' },
  allowances: [{ name: 'transport', amount: 1000, currency: 'EGP' }],
  benefits: ['medical insurance'],
  probationMonths: 3,
  startDate: START_DATE,
  validUntil: FUTURE_VALID,
  ...over,
});

const createOffer = (applicantId: string, termsOver: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/v1/hr/job-offers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ applicantId, terms: offerTerms(termsOver) });

const draftFor = async (applicant: ApplicantDto, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  const res = await createOffer(applicant.id, termsOver);
  expect(res.status).toBe(201);
  return mutated<JobOfferDto>(res);
};

const sentFor = async (applicant: ApplicantDto, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  const draft = await draftFor(applicant, termsOver);
  const sent = await request(app)
    .post(`/api/v1/hr/job-offers/${draft.id}/send`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: draft.version });
  expect(sent.status).toBe(200);
  return mutated<JobOfferDto>(sent);
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

describe('job offers — permissions & eligibility gate', () => {
  it('denies a user without offer permissions', async () => {
    const denied = await request(app).get('/api/v1/hr/job-offers').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });

  it('refuses an offer for an applicant NOT explicitly moved to the Job Offer stage', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');
    await passStage(applicant.id, 'secondInterview'); // completing stages does NOT auto-qualify
    const res = await createOffer(applicant.id);
    expect(res.status).toBe(422);
  });

  it('HR moves an applicant to the offer stage from mid-pipeline and drafts an offer', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview'); // round 2 NOT passed — moved anyway
    await moveToOffer(applicant);
    const res = await createOffer(applicant.id);
    expect(res.status).toBe(201);

    // Only moved applicants surface in the New Offer pool.
    const pool = await request(app)
      .get('/api/v1/hr/applicants')
      .query({ movedToOffer: true, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = (pool.body.data as ApplicantDto[]).map((a) => a.id);
    expect(ids).toContain(applicant.id);
  });

  // I11 — the offer queue is REAL rows whose status is `waiting`, materialized when HR moves the
  // candidate to this stage. Nothing is derived from a missing row.
  it('materializes a waiting offer on move-to-offer, which drafting then consumes', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');

    const waitingOf = async (): Promise<JobOfferDto[]> => {
      const res = await request(app)
        .get('/api/v1/hr/job-offers?status=waiting&pageSize=100')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      return res.body.data as JobOfferDto[];
    };

    // Not moved yet → no row at all (eligibility is never automatic).
    expect((await waitingOf()).map((o) => o.applicantId)).not.toContain(applicant.id);

    await moveToOffer(applicant);
    const mine = (await waitingOf()).find((row) => row.applicantId === applicant.id);
    expect(mine).toBeDefined();
    expect(mine?.applicantCode).toBe(applicant.code);
    expect(mine?.applicantName).not.toBe('');

    // Drafting moves that same row on; it is not a second record.
    expect((await createOffer(applicant.id)).status).toBe(201);
    expect((await waitingOf()).map((o) => o.applicantId)).not.toContain(applicant.id);
  });
});

describe('job offers — draft, revise, one-active invariant', () => {
  it('drafts an offer for an offer-eligible applicant with an immutable offer number', async () => {
    const applicant = await offerReadyApplicant();
    const dto = await draftFor(applicant);
    expect(dto.status).toBe('draft');
    expect(dto.revisionNumber).toBe(1);
    expect(dto.code).toMatch(/^JO-\d{4}-\d{6}$/);
    expect(dto.acceptedSnapshot).toBeNull();
    expect(dto.terms?.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.terms?.benefits).toEqual(['medical insurance']);
  });

  it('prevents a second active offer for the same applicant', async () => {
    const applicant = await offerReadyApplicant();
    await draftFor(applicant);
    const second = await createOffer(applicant.id);
    expect(second.status).toBe(409);
  });

  it('revises a draft, keeping the prior version in history', async () => {
    const applicant = await offerReadyApplicant();
    const draft = await draftFor(applicant);
    const revised = await request(app)
      .patch(`/api/v1/hr/job-offers/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ terms: offerTerms({ salary: { amount: 18000, currency: 'EGP' } }), version: draft.version });
    expect(revised.status).toBe(200);
    const body = envelope<JobOfferDto>(revised);
    const dto = body.data;
    expect(dto.revisionNumber).toBe(2);
    expect(dto.terms?.salary?.amount).toBe(18000);
    expect(dto.revisions).toHaveLength(1);
    expect(dto.revisions[0]?.terms.salary?.amount).toBe(15000);

    // I6 — a revision edits the offer without moving it, so the state is unchanged, nothing was
    // written to history, and `send` is still what comes next.
    expect(body.workflow.stage?.kind).toBe('jobOffer');
    expect(body.workflow.status).toBe('draft');
    expect(actionEnabled(body.workflow, 'send')).toBe(true);
    expect(body.timeline.produced).toEqual([]);
  });
});

describe('job offers — send & notify', () => {
  it('sends a draft offer and notifies the hiring manager', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).not.toBeNull();

    const inbox = await request(app).get('/api/v1/platform/notifications').set('Authorization', `Bearer ${interviewerToken}`);
    expect(inbox.status).toBe(200);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to send when the validity is already in the past', async () => {
    const applicant = await offerReadyApplicant();
    const draft = await draftFor(applicant, { validUntil: PAST_VALID });
    const sent = await request(app)
      .post(`/api/v1/hr/job-offers/${draft.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(sent.status).toBe(422);
  });
});

describe('job offers — accept / reject / withdraw', () => {
  it('accepts a sent offer and exposes the accepted-offer gate for Employee Creation', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);
    const accepted = await request(app)
      .post(`/api/v1/hr/job-offers/${sent.id}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'delighted to join', version: sent.version });
    expect(accepted.status).toBe(200);
    const body = envelope<JobOfferDto>(accepted);
    expect(body.data.status).toBe('accepted');

    // I6/I14 — acceptance is terminal for the OFFER and moves the lifecycle not at all: the hire is
    // a separate act. The offer therefore stops being where the candidate stands, and the envelope
    // reports that from the live rows rather than from anything mirrored onto the applicant.
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.stage?.kind).not.toBe('jobOffer');
    expect(body.timeline.produced.map((e) => e.type)).toContain('offerAccepted');
    expect(counter(body.counters, 'jobOffers')).toBeDefined();

    // The gate Stage 5 will consult: the applicant now has an accepted offer.
    const gate = await jobOfferService.acceptedOfferFor(applicant.id);
    expect(gate).not.toBeNull();
  });

  it('has no accepted offer for an applicant who only reached draft', async () => {
    const applicant = await offerReadyApplicant();
    await draftFor(applicant);
    expect(await jobOfferService.acceptedOfferFor(applicant.id)).toBeNull();
  });

  it('rejects a sent offer with a stored reason', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);
    const rejected = await request(app)
      .post(`/api/v1/hr/job-offers/${sent.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'accepted another role', version: sent.version });
    expect(rejected.status).toBe(200);
    const body = envelope<JobOfferDto>(rejected);
    expect(body.data.status).toBe('rejected');
    expect(body.data.rejectionReason).toBe('accepted another role');
    // I14 — declining a PACKAGE says nothing about the person, so the lifecycle does not move:
    // HR may revise and re-offer. The envelope reports the offer's own status and nothing more.
    expect(body.workflow.applicantStatus).toBe('new');
    expect(body.workflow.stage?.kind).not.toBe('jobOffer');
    expect(body.timeline.produced.map((e) => e.type)).toEqual(['offerRejected']);
  });

  it('withdraws an offer and frees the applicant for a fresh offer', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);
    const withdrawn = await request(app)
      .post(`/api/v1/hr/job-offers/${sent.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'budget frozen', version: sent.version });
    expect(withdrawn.status).toBe(200);
    const body = envelope<JobOfferDto>(withdrawn);
    expect(body.data.status).toBe('withdrawn');
    expect(body.timeline.produced.map((e) => e.type)).toEqual(['offerWithdrawn']);
    expect(counter(body.counters, 'jobOffers')).toBeDefined();
    // No active offer remains, so a new one may be drafted.
    const again = await createOffer(applicant.id);
    expect(again.status).toBe(201);
  });
});

describe('job offers — offer number & accepted snapshot', () => {
  it('assigns sequential, searchable offer numbers', async () => {
    const a1 = await offerReadyApplicant();
    const a2 = await offerReadyApplicant();
    const o1 = await draftFor(a1);
    const o2 = await draftFor(a2);
    expect(o1.code).toMatch(/^JO-\d{4}-\d{6}$/);
    expect(o2.code).not.toBe(o1.code);

    // The offer number is searchable (HR looks offers up by JO-number, not ObjectId).
    const found = await request(app)
      .get('/api/v1/hr/job-offers')
      .query({ search: o1.code, pageSize: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    const codes = (found.body as { data: JobOfferDto[] }).data.map((o) => o.code);
    expect(codes).toContain(o1.code);
    expect(codes).not.toContain(o2.code);
  });

  it('freezes the accepted revision as an immutable snapshot and blocks further offers', async () => {
    const applicant = await offerReadyApplicant();
    const draft = await draftFor(applicant);
    // Revise to a second version (higher salary), then send and accept.
    const revised = await request(app)
      .patch(`/api/v1/hr/job-offers/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ terms: offerTerms({ salary: { amount: 20000, currency: 'EGP' } }), version: draft.version });
    expect(revised.status).toBe(200);
    const rev2 = mutated<JobOfferDto>(revised);
    expect(rev2.revisionNumber).toBe(2);

    const sent = await request(app)
      .post(`/api/v1/hr/job-offers/${rev2.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: rev2.version });
    expect(sent.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/v1/hr/job-offers/${rev2.id}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: mutated<JobOfferDto>(sent).version });
    expect(accepted.status).toBe(200);

    // The snapshot captures exactly the accepted revision (2) and its terms.
    const dto = mutated<JobOfferDto>(accepted);
    expect(dto.acceptedSnapshot?.revisionNumber).toBe(2);
    expect(dto.acceptedSnapshot?.terms.salary?.amount).toBe(20000);

    // Post-acceptance the offer is terminal: no revision can change the accepted terms.
    const reviseAfter = await request(app)
      .patch(`/api/v1/hr/job-offers/${rev2.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ terms: offerTerms({ salary: { amount: 99000, currency: 'EGP' } }), version: dto.version });
    expect(reviseAfter.status).toBe(422);

    // And an applicant who already accepted cannot be issued another offer.
    const another = await createOffer(applicant.id);
    expect(another.status).toBe(409);
  });
});

describe('job offers — automatic expiration', () => {
  it('expires sent offers past their validity via the sweep', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);

    // Run the scheduled sweep as of a time after the validity window.
    const count = await jobOfferService.expireOverdue(new Date('2100-01-01T00:00:00.000Z'));
    expect(count).toBeGreaterThanOrEqual(1);

    const after = await request(app).get(`/api/v1/hr/job-offers/${sent.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as JobOfferDto).status).toBe('expired');
    expect((after.body.data as JobOfferDto).status).not.toBe('draft');
  });
});

describe('job offers — bulk send/withdraw (RW17/I4)', () => {
  const bulk = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/hr/job-offers/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  it('sends a selection of drafts and reports one result per id', async () => {
    const a = await draftFor(await offerReadyApplicant());
    const b = await draftFor(await offerReadyApplicant());

    const res = await bulk({ action: 'send', ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    // I6/RW17 — one entry per offer that actually moved, plus the refreshed queue counters.
    expect(result.timeline.produced.map((e) => e.type)).toEqual(['offerSent', 'offerSent']);
    expect(counter(result.counters, 'jobOffers')).toBeDefined();

    const after = await request(app)
      .get(`/api/v1/hr/job-offers/${a.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as JobOfferDto).status).toBe('sent');
  });

  it('withdraws with a reason and leaves the applicants free for a fresh offer', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);

    expect((await bulk({ action: 'withdraw', ids: [sent.id] })).status).toBe(400);

    const res = await bulk({ action: 'withdraw', ids: [sent.id], reason: 'budget frozen' });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(1);
    expect(result.timeline.produced.map((e) => e.type)).toEqual(['offerWithdrawn']);
    expect((await createOffer(applicant.id)).status).toBe(201);
  });

  it('applies the sendable item and reports the one that cannot be sent', async () => {
    const good = await draftFor(await offerReadyApplicant());
    const alreadySent = await sentFor(await offerReadyApplicant());

    const res = await bulk({ action: 'send', ids: [good.id, alreadySent.id] });
    expect(res.status).toBe(200);
    const result = bulkEnvelope(res);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.id === alreadySent.id)?.ok).toBe(false);
    // Only the item that moved wrote history — the refused one produced nothing.
    expect(result.timeline.produced.map((e) => e.type)).toEqual(['offerSent']);
  });
});

// ── The awaiting-offer queue (`/job-offers`, the "Ready for an offer" list) ──────────────────
//
// The rule under test is one sentence: a candidate is in this queue because they have ARRIVED at
// the Job Offer stage and nobody has written their offer yet. Which stage they arrived FROM is not
// part of it, so each case below walks a different route in and expects the same answer.
//
// This queue used to be seeded from evaluation APPROVALS and to treat the stage's own `waiting`
// row as "an offer already exists". Between them, a candidate moved here from screening or an
// interview was invisible, and moving anybody here at all removed them. Every case below fails on
// that shape.
describe('awaiting-offer queue — who is in it, and never which stage they came from', () => {
  /** The queue as the screen asks for it, narrowed to one candidate by their own code. */
  const queueFor = async (applicant: ApplicantDto): Promise<AwaitingOfferCandidateDto[]> => {
    const res = await request(app)
      .get('/api/v1/hr/job-offers/awaiting')
      .query({ pageSize: 100, search: applicant.code })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return (res.body.data as AwaitingOfferCandidateDto[]).filter((r) => r.applicantId === applicant.id);
  };

  const evaluationsOf = async (applicantId: string): Promise<EvaluationDto[]> => {
    const res = await request(app)
      .get('/api/v1/hr/evaluations')
      .query({ applicantId, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as EvaluationDto[];
  };

  /** Approve every check that opened for this candidate — the "cleared the checks" route in. */
  const approveEveryCheck = async (applicantId: string): Promise<void> => {
    for (const evaluation of await evaluationsOf(applicantId)) {
      if (evaluation.status !== 'waiting') continue;
      const decided = await request(app)
        .patch(`/api/v1/hr/evaluations/${evaluation.id}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'approved', version: evaluation.version });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    }
  };

  it('shows a candidate moved straight from registration — no earlier stage decided at all', async () => {
    // The extreme case, and the cleanest statement of the rule: nothing happened before the move.
    // There is no source stage to key off, so anything that needs one cannot show this candidate.
    const applicant = await registerApplicant();
    await moveToOffer(applicant);
    expect((await queueFor(applicant)).map((r) => r.applicantId)).toEqual([applicant.id]);
  });

  it('shows a candidate moved from SCREENING', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await moveToOffer(applicant);
    const [row] = await queueFor(applicant);
    expect(row?.applicantId).toBe(applicant.id);
    expect(row?.movedToOffer).toBe(true);
  });

  it('shows a candidate moved from an INTERVIEW round', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');
    await moveToOffer(applicant);
    expect((await queueFor(applicant)).map((r) => r.applicantId)).toEqual([applicant.id]);
  });

  it('shows a candidate moved from the EVALUATION stage, with none of the checks decided', async () => {
    // Passing every interview round opens the evaluation phases (I11). Moving from there with the
    // checks still `waiting` is the case an approvals-seeded queue can never answer: this
    // candidate has no approved evaluation to be found by.
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');
    await passStage(applicant.id, 'secondInterview');
    expect((await evaluationsOf(applicant.id)).length).toBeGreaterThan(0); // the stage really opened
    await moveToOffer(applicant);
    expect((await queueFor(applicant)).map((r) => r.applicantId)).toEqual([applicant.id]);
  });

  it('shows a candidate moved after a PLACEMENT change, and carries the position onto the row', async () => {
    // Placement is an attribute a candidate carries through the pipeline rather than a stage of its
    // own, so "moved after placement" is the honest form of that route — and the row shows where
    // they are being placed, which is what the person writing the offer needs.
    //
    // The title is CREATED here rather than reused from `JOB_TITLE_ID`: that constant only ever
    // appears inside offer terms, and `reassign` resolves the placement against the real job-title
    // catalogue, where it does not exist. This is the same seeding `hr-placement.spec.ts` does.
    //
    // The placement carries the title ALONE, for the same reason: `DEPARTMENT_ID` is the same kind
    // of offer-terms constant and is no more real to the catalogue. `placement-resolver.ts`
    // validates each part only when it is supplied, and the position this test asserts comes from
    // the title — so naming a department here would add a second thing to seed and prove nothing
    // extra. `hr-placement.spec.ts` is where department and branch placement is covered.
    const titleRes = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-OFFER-QUEUE', name: { ar: 'صراف', en: 'Teller' }, jobGrade: 'G5' });
    expect(titleRes.status, JSON.stringify(titleRes.body)).toBe(201);
    const jobTitleId = (titleRes.body as { data: { id: string } }).data.id;

    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    const current = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const reassigned = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        placement: { jobTitleId },
        reason: 'a vacancy opened',
        version: (current.body.data as ApplicantDto).version,
      });
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(200);
    await moveToOffer(envelope<ApplicantDto>(reassigned).data);

    const [row] = await queueFor(applicant);
    expect(row?.applicantId).toBe(applicant.id);
    expect(row?.position).not.toBeNull();
  });

  it('does NOT show a candidate who has not reached the Job Offer stage', async () => {
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview'); // mid-pipeline, never moved
    expect(await queueFor(applicant)).toEqual([]);
  });

  it('drops them the moment somebody writes the offer', async () => {
    const applicant = await registerApplicant();
    await moveToOffer(applicant);
    expect((await queueFor(applicant)).length).toBe(1);

    // Drafting is what the queue is asking for. Once it exists, the row has been served.
    await draftFor(applicant);
    expect(await queueFor(applicant)).toEqual([]);
  });

  it('drops them when they leave the active pipeline — and letting them leave is the point', async () => {
    // This is two assertions in one, and the second is the larger. A candidate standing at the Job
    // Offer stage holds a `waiting` row, and when they depart the engine closes it to `withdrawn`
    // (`LIFECYCLE_CLOSE`). The offer rulebook did not permit `waiting → withdrawn`, so that close
    // was refused and the whole withdrawal failed with ILLEGAL_TRANSITION — meaning nobody who had
    // been moved to this stage could be withdrawn or rejected at all. Nothing exercised it: this is
    // the only place in the suite that withdraws a candidate standing here.
    const applicant = await registerApplicant();
    await moveToOffer(applicant);
    expect((await queueFor(applicant)).length).toBe(1);

    const current = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const withdrawn = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'took another offer', version: (current.body.data as ApplicantDto).version });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(envelope<ApplicantDto>(withdrawn).data.status).toBe('withdrawn');

    // The queue row really closed, rather than being left open behind a departed candidate.
    const offers = await request(app)
      .get('/api/v1/hr/job-offers')
      .query({ applicantId: applicant.id, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(offers.status).toBe(200);
    expect((offers.body.data as JobOfferDto[]).map((o) => o.status)).toEqual(['withdrawn']);

    expect(await queueFor(applicant)).toEqual([]);
  });

  it('lists a candidate ONCE even when they qualify every way at the same time', async () => {
    // Cleared every check AND standing at the stage: two routes in, one person. The queue merges
    // them by candidate, so the person working it sees one row to act on rather than two.
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');
    await passStage(applicant.id, 'secondInterview');
    await approveEveryCheck(applicant.id);
    await moveToOffer(applicant);

    const rows = await queueFor(applicant);
    expect(rows.length).toBe(1);
    expect(rows[0]?.movedToOffer).toBe(true);
  });

  it('still shows somebody who cleared every check and has NOT been moved yet', async () => {
    // The other route in, unchanged — this is the row whose button offers to move AND write.
    const applicant = await registerApplicant();
    await acceptScreening(applicant.id);
    await passStage(applicant.id, 'firstInterview');
    await passStage(applicant.id, 'secondInterview');
    await approveEveryCheck(applicant.id);

    const [row] = await queueFor(applicant);
    expect(row?.applicantId).toBe(applicant.id);
    expect(row?.movedToOffer).toBe(false);
  });
});
