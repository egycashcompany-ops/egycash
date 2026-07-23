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

const PASSWORD = 'Str0ng#Pass!';
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
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
      jobRequisitionId: REQUISITION_ID,
      sourceId,
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  return res.body.data as ApplicantDto;
};

const acceptScreening = async (applicantId: string): Promise<void> => {
  const screening = (
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId })
  ).body.data as ScreeningDto;
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status).toBe(200);
};

const passStage = async (applicantId: string, stageKey: string): Promise<void> => {
  const stageId = await idByKey('interview-stages', stageKey);
  const interview = (
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId, scheduledAt: FUTURE_VALID, interviewerIds: [interviewerId] })
  ).body.data as InterviewDto;
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: interview.version });
  expect(submitted.status).toBe(200);
  const decided = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'passed', version: (submitted.body.data as InterviewDto).version });
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
    .send({ version: (current.body.data as ApplicantDto).version });
  expect(moved.status).toBe(200);
  expect((moved.body.data as ApplicantDto).movedToOfferAt).not.toBeNull();
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
  return res.body.data as JobOfferDto;
};

const sentFor = async (applicant: ApplicantDto, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  const draft = await draftFor(applicant, termsOver);
  const sent = await request(app)
    .post(`/api/v1/hr/job-offers/${draft.id}/send`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: draft.version });
  expect(sent.status).toBe(200);
  return sent.body.data as JobOfferDto;
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
});

describe('job offers — draft, revise, one-active invariant', () => {
  it('drafts an offer for an offer-eligible applicant with an immutable offer number', async () => {
    const applicant = await offerReadyApplicant();
    const dto = await draftFor(applicant);
    expect(dto.status).toBe('draft');
    expect(dto.active).toBe(true);
    expect(dto.revisionNumber).toBe(1);
    expect(dto.code).toMatch(/^JO-\d{4}-\d{6}$/);
    expect(dto.acceptedSnapshot).toBeNull();
    expect(dto.terms.salary).toEqual({ amount: 15000, currency: 'EGP' });
    expect(dto.terms.benefits).toEqual(['medical insurance']);
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
    const dto = revised.body.data as JobOfferDto;
    expect(dto.revisionNumber).toBe(2);
    expect(dto.terms.salary?.amount).toBe(18000);
    expect(dto.revisions).toHaveLength(1);
    expect(dto.revisions[0]?.terms.salary?.amount).toBe(15000);
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
    expect((accepted.body.data as JobOfferDto).status).toBe('accepted');
    expect((accepted.body.data as JobOfferDto).active).toBe(false);

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
    expect((rejected.body.data as JobOfferDto).status).toBe('rejected');
    expect((rejected.body.data as JobOfferDto).rejectionReason).toBe('accepted another role');
  });

  it('withdraws an offer and frees the applicant for a fresh offer', async () => {
    const applicant = await offerReadyApplicant();
    const sent = await sentFor(applicant);
    const withdrawn = await request(app)
      .post(`/api/v1/hr/job-offers/${sent.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'budget frozen', version: sent.version });
    expect(withdrawn.status).toBe(200);
    expect((withdrawn.body.data as JobOfferDto).status).toBe('withdrawn');
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
    const rev2 = revised.body.data as JobOfferDto;
    expect(rev2.revisionNumber).toBe(2);

    const sent = await request(app)
      .post(`/api/v1/hr/job-offers/${rev2.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: rev2.version });
    expect(sent.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/v1/hr/job-offers/${rev2.id}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (sent.body.data as JobOfferDto).version });
    expect(accepted.status).toBe(200);

    // The snapshot captures exactly the accepted revision (2) and its terms.
    const dto = accepted.body.data as JobOfferDto;
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
    expect((after.body.data as JobOfferDto).active).toBe(false);
  });
});
