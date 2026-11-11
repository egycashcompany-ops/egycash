// Stage 6 — HR / Recruitment: Hiring Documents integration suite. Drives an applicant through
// the full pipeline to a hired employee, then exercises hiring documents: the admin document-
// type catalog, opening the set, PDF uploads (with non-PDF rejection), the required-completion
// gate, replacement with version history (original preserved), immutability after completion
// except through the versioning workflow, the completion notification, and audit.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  HrContractSettingKeys,
  SettingKeys,
  type ApplicantDto,
  type CandidateBulkPersonDto,
  type CandidateDraftDto,
  type ContractDto,
  type HireCandidateDto,
  type RenderCandidateBulkDto,
  type RenderCandidatePapersDto,
  type EmployeeDto,
  type HiringDocumentTypeDto,
  type HiringDocumentsDto,
  type InterviewDto,
  type JobOfferDto,
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
import { bulkEnvelope, counter, envelope, mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';
import { syncHiringTemplates } from '../../src/modules/hr/contracts/hiring-templates';
import { seedHrRecruitment } from '../../src/modules/hr/hr.seed';

const PASSWORD = 'Str0ng#Pass!';
const JOB_TITLE_ID = '64b1f0cccccccccccccccc01';
const DEPARTMENT_ID = '64b1f0cccccccccccccccc02';
let BRANCH_ID = ''; // real branch created in beforeAll (employee code is BranchCode-based)
const FUTURE = '2027-03-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
const REQUIRED_KEYS = [
  'employmentContract',
  'employmentAcceptance',
  'socialStatusForm',
  'relativesDeclaration',
  'jobDescription',
  'bankLetter',
  'companyIdCard',
];
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminUserId = '';
let aliceToken: string;
let interviewerId: string; // interview panel + hiring manager
let interviewerToken: string;
let phoneCounter = 50_000_000;

const pdf = (): Buffer => Buffer.from('%PDF-1.4 hiring document');

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-hiredocs-test-${Date.now()}`;
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

/**
 * Register → screen → both interviews → offer accepted → employee.
 *
 * Every recruitment step is a workflow mutation and answers with the envelope (I6); this helper
 * reads its `data` half. The employee endpoint is Stage 5's own aggregate and is unchanged.
 */
const hiredEmployee = async (): Promise<EmployeeDto> => {
  const offer = await acceptedOffer();
  const emp = await request(app)
    .post('/api/v1/hr/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ jobOfferId: offer.id });
  expect(emp.status).toBe(201);
  return emp.body.data as EmployeeDto;
};

/** Register → screen → both interviews → offer sent and ACCEPTED: a candidate ready to hire. */
const acceptedOffer = async (): Promise<JobOfferDto> => {
  const sourceId = await idByKey('applicant-sources', 'internalHr');
  const applicant = mutated<ApplicantDto>(
    await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sourceId,
        intakeChannel: 'internal',
        identity: { nationalId: nextNationalId(), fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
      }),
  );

  const screening = mutated<ScreeningDto>(
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId: applicant.id }),
  );
  await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });

  for (const key of ['firstInterview', 'secondInterview']) {
    const stageId = await idByKey('interview-stages', key);
    const interview = mutated<InterviewDto>(
      await request(app)
        .post('/api/v1/hr/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicantId: applicant.id, stageId, scheduledAt: FUTURE, interviewerIds: [interviewerId] }),
    );
    const submitted = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', version: interview.version });
    await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: mutated<InterviewDto>(submitted).version });
  }

  // Explicitly move the applicant to the Job Offer stage (offer eligibility is never automatic).
  {
    const current = await request(app)
      .get(`/api/v1/hr/applicants/${applicant.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const moved = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/move-to-offer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (current.body.data as ApplicantDto).version }); // a read
    expect(moved.status).toBe(200);
  }

  const draft = mutated<JobOfferDto>(
    await request(app)
      .post('/api/v1/hr/job-offers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        applicantId: applicant.id,
        terms: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          managerId: interviewerId,
          employmentType: 'fullTime',
          salary: { amount: 15000, currency: 'EGP' },
          allowances: [],
          benefits: [],
          probationMonths: 3,
          startDate: START_DATE,
          validUntil: FUTURE,
        },
      }),
  );
  const sent = await request(app).post(`/api/v1/hr/job-offers/${draft.id}/send`).set('Authorization', `Bearer ${adminToken}`).send({ version: draft.version });
  const accepted = await request(app)
    .post(`/api/v1/hr/job-offers/${draft.id}/accept`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: mutated<JobOfferDto>(sent).version });
  return mutated<JobOfferDto>(accepted);
};

const createSet = async (employeeId: string): Promise<HiringDocumentsDto> => {
  const res = await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId });
  expect(res.status).toBe(201);
  // I6 — the candidate is hired, so the workflow half reports a lifecycle with no open stage; the
  // set is still their pipeline, which is why this act carries the envelope at all.
  const body = envelope<HiringDocumentsDto>(res);
  expect(body.workflow.applicantStatus).toBe('hired');
  expect(body.workflow.stage).toBeNull();
  expect(counter(body.counters, 'jobOffers')).toBeDefined();
  return body.data;
};

const uploadDoc = (hdId: string, typeId: string, version: number, filename = 'doc.pdf', contentType = 'application/pdf') =>
  request(app)
    .post(`/api/v1/hr/hiring-documents/${hdId}/documents`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('typeId', typeId)
    .field('version', String(version))
    .attach('file', pdf(), { filename, contentType });

/** Upload all three required documents; returns the resulting aggregate version. */
const uploadAllRequired = async (hd: HiringDocumentsDto): Promise<number> => {
  let version = hd.version;
  for (const key of REQUIRED_KEYS) {
    const typeId = await idByKey('hiring-document-types', key);
    const res = await uploadDoc(hd.id, typeId, version);
    expect(res.status).toBe(200);
    version = mutated<HiringDocumentsDto>(res).version;
  }
  return version;
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
  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'الرئيسي', en: 'HQ' } });
  BRANCH_ID = (branchRes.body as { data: { id: string } }).data.id;
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

describe('hiring documents — types catalog & permissions', () => {
  it('seeds all seven document types as REQUIRED and denies alice', async () => {
    const res = await request(app).get('/api/v1/hr/hiring-document-types').query({ pageSize: 50 }).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const types = (res.body as { data: HiringDocumentTypeDto[] }).data;
    const required = types.filter((t) => t.required).map((t) => t.key);
    expect(required).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    expect(required).toHaveLength(7);
    // The crew leader's weapon declaration waits for a crew leader's job; this database has none yet.
    expect(types.map((t) => t.key)).not.toContain('weaponDeclaration');

    const denied = await request(app).get('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);

    const adminCreate = await request(app)
      .post('/api/v1/hr/hiring-document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'medicalCheck', name: { ar: 'الكشف الطبي', en: 'Medical check' }, required: false });
    expect(adminCreate.status).toBe(201);
    const aliceCreate = await request(app)
      .post('/api/v1/hr/hiring-document-types')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ key: 'x', name: { ar: 'x', en: 'x' }, required: false });
    expect(aliceCreate.status).toBe(403);
  });
});

describe('hiring documents — create, upload, completion gate', () => {
  it('opens a set (one per employee) listing the missing required documents', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    expect(hd.status).toBe('inProgress');
    expect(hd.employeeCode).toBe(emp.code);
    expect(hd.missingRequired).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    expect((await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId: emp.id })).status).toBe(409);
  });

  it('uploads a PDF (metadata + version tracked) and rejects a non-PDF', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');

    const ok = await uploadDoc(hd.id, typeId, hd.version, 'id.pdf');
    expect(ok.status).toBe(200);
    const uploaded = envelope<HiringDocumentsDto>(ok);
    const dto = uploaded.data;
    expect(dto.documents).toHaveLength(1);
    expect(dto.documents[0]).toMatchObject({ typeKey: 'employmentContract', fileVersion: 1, fileName: 'id.pdf' });
    expect(dto.missingRequired).not.toContain('employmentContract');
    // I6 — a multipart action answers with the same envelope as a JSON one. Filing a document is
    // not a status move, so it produced no history, and the envelope says so.
    expect(uploaded.workflow.applicantStatus).toBe('hired');
    expect(uploaded.timeline.produced).toEqual([]);
    expect(uploaded.timeline.total).toBeGreaterThan(0);
    expect(Array.isArray(uploaded.counters)).toBe(true);

    // A duplicate upload for the same type must go through replace.
    expect((await uploadDoc(hd.id, typeId, dto.version)).status).toBe(409);

    // Non-PDF is rejected by the file category.
    const bad = await uploadDoc(hd.id, await idByKey('hiring-document-types', 'employmentAcceptance'), dto.version, 'x.txt', 'text/plain');
    expect(bad.status).toBe(422);
  });

  it('rejects an upload carrying a stale version (optimistic concurrency)', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');
    const stale = await uploadDoc(hd.id, typeId, hd.version + 5);
    expect(stale.status).toBe(409);
  });

  it('blocks completion while a required document is missing, then completes', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const blocked = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: hd.version });
    expect(blocked.status).toBe(422);

    const version = await uploadAllRequired(hd);
    const completed = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(completed.status).toBe(200);
    const done = envelope<HiringDocumentsDto>(completed);
    expect(done.data.status).toBe('completed');
    expect(done.data.missingRequired).toEqual([]);
    expect(done.workflow.applicantStatus).toBe('hired');
    expect(done.workflow.availableActions).toEqual([]);

    // Completion notifies the hiring manager and is audited.
    const inbox = await request(app).get('/api/v1/platform/notifications').set('Authorization', `Bearer ${interviewerToken}`);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'hiringDocuments', pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'statusChange')).toBe(true);
  });
});

describe('hiring documents — versioning & post-completion immutability', () => {
  it('replaces a document, preserving previous versions', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');
    const up = await uploadDoc(hd.id, typeId, hd.version, 'id-v1.pdf');
    const v1 = mutated<HiringDocumentsDto>(up);

    const replaced = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/documents/${typeId}/replace`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(v1.version))
      .attach('file', pdf(), { filename: 'id-v2.pdf', contentType: 'application/pdf' });
    expect(replaced.status).toBe(200);
    const doc = mutated<HiringDocumentsDto>(replaced).documents.find((d) => d.typeKey === 'employmentContract');
    expect(doc?.fileVersion).toBe(2);

    // Both versions are retained (original preserved).
    const versions = await request(app)
      .get(`/api/v1/hr/hiring-documents/${hd.id}/documents/${typeId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(versions.status).toBe(200);
    expect((versions.body as { data: unknown[] }).data.length).toBe(2);
  });

  it('is immutable after completion except through the versioning workflow', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const version = await uploadAllRequired(hd);
    const completed = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(completed.status).toBe(200);
    const done = mutated<HiringDocumentsDto>(completed);

    // Adding a NEW document type after completion is blocked (medicalCheck was admin-created
    // earlier in this suite and never uploaded to this set).
    const extraType = await idByKey('hiring-document-types', 'medicalCheck');
    const blockedUpload = await uploadDoc(hd.id, extraType, done.version);
    expect(blockedUpload.status).toBe(422);

    // Replacing (versioning) an existing document is still allowed.
    const contractType = await idByKey('hiring-document-types', 'employmentAcceptance');
    const replaced = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/documents/${contractType}/replace`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(done.version))
      .attach('file', pdf(), { filename: 'contract-v2.pdf', contentType: 'application/pdf' });
    expect(replaced.status).toBe(200);
    expect(
      mutated<HiringDocumentsDto>(replaced).documents.find((d) => d.typeKey === 'employmentAcceptance')?.fileVersion,
    ).toBe(2);
  });
});

// RW17/I4 — completing is the one group act on this stage. Each set runs its own `complete`, so a
// set that still misses a mandatory document fails as THAT item while the rest go through.
describe('hiring documents — bulk complete reports partial success honestly', () => {
  it('completes the ready sets and names the one that is not ready', async () => {
    const readyEmployee = await hiredEmployee();
    const ready = await createSet(readyEmployee.id);
    await uploadAllRequired(ready);

    const blockedEmployee = await hiredEmployee();
    const blocked = await createSet(blockedEmployee.id); // no documents uploaded at all

    const res = await request(app)
      .post('/api/v1/hr/hiring-documents/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'complete', ids: [ready.id, blocked.id] });
    expect(res.status).toBe(200);

    const result = bulkEnvelope(res);
    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.id === ready.id)?.ok).toBe(true);
    const failure = result.results.find((r) => r.id === blocked.id);
    expect(failure?.ok).toBe(false);
    expect(failure?.error).toContain('missing required documents');
    // I6 — the bulk act reports the refreshed counters so the queue redraws from this one response.
    expect(Array.isArray(result.counters)).toBe(true);
    expect(result.timeline.total).toBe(result.timeline.produced.length);

    // The successful item really did complete; the failed one is untouched.
    const after = await request(app)
      .get(`/api/v1/hr/hiring-documents/${ready.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as HiringDocumentsDto).status).toBe('completed');
    const untouched = await request(app)
      .get(`/api/v1/hr/hiring-documents/${blocked.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((untouched.body.data as HiringDocumentsDto).status).toBe('inProgress');
  });
});

// A27 — «تعيين» lands on the employee's set: opened when missing, the same one every time after.
describe('hiring documents — opened for an employee, once', () => {
  it('opens the set when there is none, and returns that same set when asked again', async () => {
    const emp = await hiredEmployee();
    const open = () =>
      request(app)
        .post('/api/v1/hr/hiring-documents/open')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: emp.id });
    const first = await open();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const id = mutated<HiringDocumentsDto>(first).id;
    expect(id).toEqual(expect.any(String));
    const second = await open();
    expect(second.status).toBe(200);
    expect(mutated<HiringDocumentsDto>(second).id).toBe(id);
    // …and an explicit create still refuses a second set.
    const dup = await request(app)
      .post('/api/v1/hr/hiring-documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(dup.status).toBe(409);
  });
});

/**
 * A28 — «عقد جديد» for a candidate: the papers print from the accepted offer before the hire, every
 * change is saved on the server, the first print keeps the employee code, and the hire — refused
 * until something was printed — gives that code and records the contract with the printed terms.
 */
describe('«عقد جديد» for a candidate — print, then hire (A28)', () => {
  const PAPER = (name: string): string => `egycash.hiring.${name}`;
  const base = (offerId: string): string => `/api/v1/hr/contracts/candidates/${offerId}`;
  const call = (method: 'post' | 'patch', path: string, body: object) =>
    request(app)[method](path).set('Authorization', `Bearer ${adminToken}`).send(body);

  beforeAll(async () => {
    // The owner's papers, as the API's boot writes them; the contract generates without approval.
    await syncHiringTemplates();
    await settingsService.set(
      {
        userId: adminUserId,
        sessionId: 'seed',
        branchId: null,
        departmentId: null,
        sectionId: null,
        locale: 'en',
        permissions: { 'setting.edit': 'organization' },
        permissionVersion: 1,
        isPrivileged: true,
      },
      { key: HrContractSettingKeys.RequireApproval, scope: 'organization', value: false },
    );
  });

  it('opens the candidate\'s papers, saves what changes, prints, and only then hires', async () => {
    const offer = await acceptedOffer();
    const opened = await call('post', `${base(offer.id)}/open`, {});
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    let draft = opened.body.data as CandidateDraftDto;
    expect(draft.papers[0]).toMatchObject({ key: PAPER('contract'), group: 'contract', selected: true });
    expect(draft.papers.filter((p) => p.group === 'everyJob').map((p) => p.key)).toEqual([
      PAPER('data-sheet'),
      PAPER('work-receipt'),
      PAPER('relatives'),
      PAPER('bank-letter'),
    ]);
    expect(draft).toMatchObject({ startDate: '2027-04-01', endDate: '2028-03-31', employeeCode: null, printedAt: null });
    expect(draft.values.find((v) => v.key === 'employee.fullName')?.value).toBe('أحمد محمد');
    // Opened again: the same record, not a second one.
    expect(((await call('post', `${base(offer.id)}/open`, {})).body.data as CandidateDraftDto).id).toBe(draft.id);

    // Not hired before anything was printed.
    expect((await call('post', `${base(offer.id)}/hire`, { version: draft.version })).status).toBe(422);

    // The choice and the typed-in values are kept; a stale page is refused. (This suite's offers
    // name a job title that is only an id, so the job is typed in — as «تعديل» would.)
    draft = (
      await call('patch', base(offer.id), {
        selected: [PAPER('contract'), PAPER('bank-letter')],
        overrides: [
          { key: 'employee.address', value: 'العجوزة' },
          { key: 'job.title', value: 'أخصائى صراف آلى' },
          // Never typed: the code is the one the first print keeps.
          { key: 'employee.employeeCode', value: '9999999' },
        ],
        version: draft.version,
      })
    ).body.data as CandidateDraftDto;
    expect(draft.papers.filter((p) => p.selected).map((p) => p.key)).toEqual([PAPER('contract'), PAPER('bank-letter')]);
    expect(draft.values.find((v) => v.key === 'employee.address')).toMatchObject({ value: 'العجوزة', overridden: true });
    expect(draft.values.find((v) => v.key === 'employee.employeeCode')).toMatchObject({ value: '', overridden: false });
    expect((await call('patch', base(offer.id), { selected: [], version: draft.version - 1 })).status).toBe(409);

    // A preview changes nothing.
    const preview = await call('post', `${base(offer.id)}/render`, { keys: [PAPER('contract')] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const previewed = preview.body.data as RenderCandidatePapersDto;
    expect(previewed.html).toContain('السيد/ أحمد محمد المقيم في العجوزة');
    expect(previewed.html).toContain('بوظيفة ( أخصائى صراف آلى )');
    expect(previewed.html).toContain('تبدأ من 1/4/2027 وتنتهي في 31/3/2028');
    expect(previewed.draft).toMatchObject({ printedAt: null, employeeCode: null });
    expect((await call('post', `${base(offer.id)}/render`, { keys: ['not.a.paper'] })).status).toBe(400);

    // The first print keeps the employee code, and the bank letter carries it; a second print keeps it.
    const first = (await call('post', `${base(offer.id)}/render`, { keys: [PAPER('bank-letter')], print: true }))
      .body.data as RenderCandidatePapersDto;
    const code = first.draft.employeeCode ?? '';
    expect(code).not.toBe('');
    expect(first.draft.printCount).toBe(1);
    expect(first.html).toContain(`ربط الحساب بكود الموظف ${code}`);
    const second = (await call('post', `${base(offer.id)}/render`, { keys: [PAPER('contract')], print: true }))
      .body.data as RenderCandidatePapersDto;
    expect(second.draft).toMatchObject({ employeeCode: code, printCount: 2 });

    // The hire: the kept code, and the contract with the printed term and address.
    const hired = await call('post', `${base(offer.id)}/hire`, { version: second.draft.version });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);
    const done = hired.body.data as HireCandidateDto;
    expect(done.employeeCode).toBe(code);
    expect(done.contractNote).toBeNull();
    const contract = (
      await request(app).get(`/api/v1/hr/contracts/${done.contract?.id ?? ''}`).set('Authorization', `Bearer ${adminToken}`)
    ).body.data as ContractDto;
    expect(contract).toMatchObject({ status: 'active', startDate: '2027-04-01', endDate: '2028-03-31' });
    expect(contract.variables.find((v) => v.key === 'employee.address')?.value).toBe('العجوزة');
    expect(contract.variables.find((v) => v.key === 'job.title')?.value).toBe('أخصائى صراف آلى');

    // Hired once: the page says so, and a second hire is refused.
    const after = (await call('post', `${base(offer.id)}/open`, {})).body.data as CandidateDraftDto;
    expect(after.employeeId).toBe(done.employeeId);
    expect((await call('post', `${base(offer.id)}/hire`, { version: after.version })).status).toBe(409);
  });
});

/**
 * A28 — «طباعة لكل المحدد»: the ticked people, each with the papers of their own job, printed as
 * one document; each print recorded as on the person's own page; a person who cannot be printed
 * for is reported, not dropped, and the others still print.
 */
describe('«طباعة لكل المحدد» on «جاهزون للتعيين» (A28)', () => {
  const PAPER = (name: string): string => `egycash.hiring.${name}`;
  const call = (path: string, body: object) =>
    request(app).post(`/api/v1/hr/contracts/candidates/${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);

  it('prints for every ticked person the papers chosen for them, in one document', async () => {
    await syncHiringTemplates();
    const first = await acceptedOffer();
    const second = await acceptedOffer();
    const nobody = '64b1f0cccccccccccccccc0e';

    const opened = await call('bulk/open', { offerIds: [first.id, second.id, nobody] });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const people = opened.body.data as CandidateBulkPersonDto[];
    expect(people.map((p) => p.offerId)).toEqual([first.id, second.id, nobody]);
    expect(people[0]?.papers.map((p) => p.key)).toContain(PAPER('bank-letter'));
    expect(people[0]?.error).toBeNull();
    expect(people[2]?.error).not.toBeNull();

    // Each person's own line: two papers for the first, one for the second.
    const printed = await call('bulk/render', {
      people: [
        { offerId: first.id, keys: [PAPER('bank-letter'), PAPER('relatives')] },
        { offerId: second.id, keys: [PAPER('relatives'), 'egycash.hiring.card.not-this-job'] },
        { offerId: nobody, keys: [PAPER('relatives')] },
      ],
    });
    expect(printed.status, JSON.stringify(printed.body)).toBe(200);
    const out = printed.body.data as RenderCandidateBulkDto;
    expect(out.results).toEqual([
      { offerId: first.id, printed: 2, error: null },
      // A paper that is not of the person's job is never printed for them.
      { offerId: second.id, printed: 1, error: null },
      expect.objectContaining({ offerId: nobody, printed: 0 }),
    ]);
    // Three documents in all, each on its own page after the first.
    expect(out.html.match(/class="doc doc-form"/g)).toHaveLength(3);

    // Each person's page shows the print, with the code kept — the hire is open there now.
    const codes: string[] = [];
    for (const offer of [first, second]) {
      const draft = (await call(`${offer.id}/open`, {})).body.data as CandidateDraftDto;
      expect(draft.printCount).toBe(1);
      expect(draft.employeeCode).not.toBeNull();
      codes.push(draft.employeeCode ?? '');
    }
    // Only the first was printed the bank letter, which carries the code.
    expect(out.html).toContain(`ربط الحساب بكود الموظف ${codes[0] ?? ''}`);
    expect(out.html).not.toContain(`ربط الحساب بكود الموظف ${codes[1] ?? ''}`);
    // More than the cap is refused at the door; so is the old one-choice-for-all shape.
    const many = Array.from({ length: 51 }, () => first.id);
    expect((await call('bulk/open', { offerIds: many })).status).toBe(400);
    expect((await call('bulk/render', { offerIds: [first.id], keys: [PAPER('relatives')] })).status).toBe(400);
    expect((await call('bulk/render', { people: [{ offerId: first.id, keys: [] }] })).status).toBe(400);
  });
});

/**
 * A27, stage 3 — the checklist is the employee's JOB's: «إقرار حيازة سلاح» is collected from crew
 * leaders only. A type for chosen jobs is asked of those jobs alone, and a type for no job at all is
 * refused rather than read as every job.
 */
describe('hiring documents — collected by the employee\'s job (A27)', () => {
  const OTHER_JOB = '64b1f0cccccccccccccccc0f';
  const mkType = (key: string, jobTitleIds: string[]) =>
    request(app)
      .post('/api/v1/hr/hiring-document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key, name: { ar: key, en: key }, required: true, allJobs: false, jobTitleIds });

  it('asks a job\'s own document of that job only', async () => {
    expect((await mkType('forNoJob', [])).status).toBe(400);
    expect((await mkType('otherJobPaper', [OTHER_JOB])).status).toBe(201);

    const emp = await hiredEmployee();
    const opened = await request(app)
      .post('/api/v1/hr/hiring-documents/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const set = mutated<HiringDocumentsDto>(opened);
    expect(set.typeKeys).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    expect(set.typeKeys).not.toContain('otherJobPaper');
    expect(set.missingRequired).not.toContain('otherJobPaper');

    // A required paper for the employee's own job is asked of it, and holds the completion back.
    const own = await mkType('ownJobPaper', [emp.employment.jobTitleId]);
    expect(own.status).toBe(201);
    const read = async (): Promise<HiringDocumentsDto> =>
      (
        await request(app)
          .get(`/api/v1/hr/hiring-documents/${set.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).body.data as HiringDocumentsDto;
    const withOwn = await read();
    expect(withOwn.typeKeys).toContain('ownJobPaper');
    expect(withOwn.missingRequired).toContain('ownJobPaper');
    const version = await uploadAllRequired(withOwn);
    const blocked = await request(app)
      .post(`/api/v1/hr/hiring-documents/${set.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('ownJobPaper');

    // Narrowing it to chosen jobs with none chosen is refused; moved to another job, it is not asked.
    const ownDto = own.body.data as HiringDocumentTypeDto;
    const emptied = await request(app)
      .patch(`/api/v1/hr/hiring-document-types/${ownDto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitleIds: [], version: ownDto.version });
    expect(emptied.status).toBe(400);
    const moved = await request(app)
      .patch(`/api/v1/hr/hiring-document-types/${ownDto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitleIds: [OTHER_JOB], version: ownDto.version });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((moved.body.data as HiringDocumentTypeDto).jobTitleIds).toEqual([OTHER_JOB]);
    const done = await request(app)
      .post(`/api/v1/hr/hiring-documents/${set.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });
});

/**
 * A27, stage 3 — the signed weapon declaration: REQUIRED of crew leaders, OPTIONAL for cash-in-transit
 * specialists, asked of no other job. The boot writes each once a job carrying its name exists, adds
 * a job of that name made since, and leaves it alone once a person has set its jobs.
 */
describe('hiring documents — the weapon declaration, by job (A27)', () => {
  const jobNamed = async (code: string, ar: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en: code }, jobGrade: 'G5' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  const typeOf = async (key: string): Promise<HiringDocumentTypeDto | undefined> => {
    const res = await request(app)
      .get('/api/v1/hr/hiring-document-types')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return (res.body as { data: HiringDocumentTypeDto[] }).data.find((t) => t.key === key);
  };

  it('is required of crew leaders, optional for cash-in-transit specialists, and follows new jobs', async () => {
    await jobNamed('JT-WPN-0', 'سائق');
    await seedHrRecruitment();
    expect(await typeOf('weaponDeclaration')).toBeUndefined(); // no crew leader yet
    expect(await typeOf('citWeaponDeclaration')).toBeUndefined();

    const cashLeader = await jobNamed('JT-WPN-1', 'قائد طاقم نقل أموال');
    const citSpecialist = await jobNamed('JT-WPN-5', 'أخصائي نقل أموال');
    await seedHrRecruitment();
    const leaders = await typeOf('weaponDeclaration');
    expect(leaders).toMatchObject({ required: true, active: true, allJobs: false, jobTitleIds: [cashLeader] });
    expect(leaders?.name.ar).toBe('إقرار حيازة سلاح');
    const specialists = await typeOf('citWeaponDeclaration');
    expect(specialists).toMatchObject({ required: false, active: true, allJobs: false, jobTitleIds: [citSpecialist] });
    expect(specialists?.name.ar).toBe('إقرار حيازة سلاح');

    // A crew leader's job made since is added on the next boot; any other job is not.
    const atm = await jobNamed('JT-WPN-2', 'قائد طاقم صراف آلى');
    await jobNamed('JT-WPN-3', 'أمين خزينة');
    await seedHrRecruitment();
    const widened = await typeOf('weaponDeclaration');
    expect([...(widened?.jobTitleIds ?? [])].sort()).toEqual([cashLeader, atm].sort());
    expect((await typeOf('citWeaponDeclaration'))?.jobTitleIds).toEqual([citSpecialist]);

    // Once HR sets its jobs, the boot leaves them as HR set them.
    const set = await request(app)
      .patch(`/api/v1/hr/hiring-document-types/${widened?.id ?? ''}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitleIds: [atm], version: widened?.version });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await jobNamed('JT-WPN-4', 'قائد طاقم');
    await seedHrRecruitment();
    expect((await typeOf('weaponDeclaration'))?.jobTitleIds).toEqual([atm]);
  });
});
