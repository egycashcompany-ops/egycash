// بوابة المتقدمين, end to end — the half only a running server can answer (P-HR-APP §4).
//
// `applicant-portal-seam.spec.ts` reads the source and pins the promises about SHAPE: the account
// opens on clearing screening and not on applying, the link goes to the number on file, the
// resolver answers null for every kind of no. None of that proves the thing works, and the way it
// most easily does not work is invisible to every test that never boots a server:
//
//   · `userService.create` leaves an account `invited`, and every authenticated request refuses a
//     non-active account — so a portal account that is not activated on creation would hand out an
//     access token that fails on the very next call, and each half would look correct alone;
//   · the account must be active AND passwordless at the same time, because active-with-a-password
//     is a second way in that no one-time code protects;
//   · confinement (ADR-027) is decided by middleware, not by the service under test.
//
// So this suite runs the whole thing: a candidate clears screening, signs in with two numbers and
// a code, reads their own file, and is refused everywhere else in ECMS.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDocumentSetDto,
  type ApplicantDocumentTypeDto,
  type ApplicantDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import {
  APPLICANT_PORTAL_SUBJECT,
  applicantPortalService,
} from '../../src/modules/hr/recruitment/applicant-portal';
import { applicantService } from '../../src/modules/hr/recruitment/applicants';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService, type UserDoc } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
/** The candidate's two numbers. Neither is a secret — that is the reason the code exists. */
const NATIONAL_ID = '29001011590077';
const PHONE = '01099880077';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let applicant: ApplicantDto;
let portalToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-applicant-portal-test-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const challenge = (body: Record<string, unknown>): request.Test =>
  request(app).post('/api/v1/auth/portal/challenge').send(body);
const verify = (body: Record<string, unknown>): request.Test =>
  request(app).post('/api/v1/auth/portal/verify').send(body);

/**
 * Capture the code the way `auth-lifecycle.spec.ts` captures an activation token: the generator is
 * a dedicated seam, so the test reads the delivered secret instead of the transport (which is
 * disabled in CI and would tell us nothing anyway).
 */
const startAndCaptureCode = async (
  identifier = NATIONAL_ID,
  phone = PHONE,
): Promise<{ status: number; code: string | null }> => {
  const spy = vi.spyOn(authService, 'generatePortalCode');
  const res = await challenge({ subjectType: APPLICANT_PORTAL_SUBJECT, identifier, phone });
  const issued = spy.mock.results.at(-1);
  spy.mockRestore();
  return {
    status: res.status,
    code: issued?.type === 'return' ? (issued.value as string) : null,
  };
};

/**
 * The account once the handler has FINISHED with it.
 *
 * Two reasons this waits rather than reads. The handler runs off the screening decision, not inside
 * it, so the account appears shortly after; and `openFor` creates the user and activates it in two
 * steps, so an observer that stops at the first non-null read catches a half-built account and
 * calls the feature broken. Waiting for `active` is not the weaker assertion — an account that
 * never activates times out here and the message says what it was stuck at.
 */
const portalAccount = async (applicantId: string): Promise<UserDoc> => {
  let found: UserDoc | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    found = await userService.findByExternalSubject('hr', APPLICANT_PORTAL_SUBJECT, applicantId);
    if (found !== null && found.status === 'active') return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    found === null
      ? `no portal account ever opened for applicant ${applicantId}`
      : `the portal account for ${applicantId} never became usable — status stayed ${found.status}`,
  );
};

/** Register a candidate. The two numbers are theirs; neither is a secret, which is the point. */
const registerApplicant = async (nationalId: string, phone: string): Promise<ApplicantDto> => {
  const sources = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const source = data<{ id: string; key: string }[]>(sources).find((s) => s.key === 'internalHr');
  if (source === undefined) throw new Error('source internalHr not seeded');
  const registered = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sourceId: source.id,
      intakeChannel: 'internal',
      identity: {
        fullNameAr: 'محمد أحمد عبد الله سالم',
        nationality: 'Egyptian',
        nationalId,
      },
      contact: { primaryPhone: phone },
    });
  expect(registered.status, 'register applicant').toBe(201);
  return mutated<ApplicantDto>(registered);
};

/** Open a screening and accept it — the act that opens the portal (D-APP-2). */
const acceptScreening = async (applicantId: string): Promise<void> => {
  const screening = mutated<ScreeningDto>(
    await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId }),
  );
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status, 'accept screening').toBe(200);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'portal-admin@ecms.local',
      firstName: { ar: 'م', en: 'A' },
      lastName: { ar: 'م', en: 'A' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

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

  const loggedIn = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'portal-admin@ecms.local', password: PASSWORD });
  expect(loggedIn.status).toBe(200);
  adminToken = data<{ accessToken: string }>(loggedIn).accessToken;

  applicant = await registerApplicant(NATIONAL_ID, PHONE);
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('before screening is cleared there is no portal at all (D-APP-2)', () => {
  it('has opened no account for a candidate who has only applied', async () => {
    expect(
      await userService.findByExternalSubject('hr', APPLICANT_PORTAL_SUBJECT, applicant.id),
    ).toBeNull();
  });

  it('answers a sign-in attempt exactly as it answers a stranger', async () => {
    const early = await challenge({
      subjectType: APPLICANT_PORTAL_SUBJECT,
      identifier: NATIONAL_ID,
      phone: PHONE,
    });
    expect(early.status).toBe(200);
    expect(data<{ accepted: boolean }>(early).accepted).toBe(true);
  });
});

describe('clearing screening opens the portal', () => {
  it('creates an ACTIVE, PASSWORDLESS account — both halves, or the portal does not work', async () => {
    await acceptScreening(applicant.id);

    const account = await portalAccount(applicant.id);
    // ACTIVE: `invited` would issue a token that fails on the next request (auth §15.3).
    expect(account.status).toBe('active');
    // PASSWORDLESS: the ordinary login path refuses a null credential outright, so the code is the
    // only door — and `forceActivate` cleared the activation token, so no password can be set.
    expect(account.passwordHash).toBeNull();
    expect(account.activation.tokenHash).toBeNull();
    expect(account.externalSubject?.subjectType).toBe(APPLICANT_PORTAL_SUBJECT);
  }, 30_000);

  it('is idempotent — a redelivered decision does not make a second login for one person', async () => {
    // Straight at the handler's own call, because that is what a redelivered event replays. Going
    // through the HTTP decision again would only prove that a decided screening cannot be decided
    // twice, which is a different guarantee owned by a different suite.
    const first = await portalAccount(applicant.id);
    const doc = await applicantService.findByIdSystem(applicant.id);
    if (doc === null) throw new Error('the applicant vanished');
    const again = await applicantPortalService.openFor(doc);
    expect(String(again._id)).toBe(String(first._id));
    expect(await userService.findByUsernameOrEmail(`applicant-${applicant.code}`)).not.toBeNull();
  });
});

describe('signing in with two numbers and a code', () => {
  it('refuses a wrong code, and says nothing else', async () => {
    const { status, code } = await startAndCaptureCode();
    expect(status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await verify({
      subjectType: APPLICANT_PORTAL_SUBJECT,
      identifier: NATIONAL_ID,
      phone: PHONE,
      code: code === '000000' ? '111111' : '000000',
    });
    expect(wrong.status).toBe(401);
  });

  it('trades the right code for a session that actually works', async () => {
    // A fresh code: the cooldown is per-account, so this test owns the one issue it needs.
    const account = await portalAccount(applicant.id);
    await userService.setPortalChallenge(String(account._id), {
      codeHash: null,
      expiresAt: null,
      sentAt: null,
      attempts: 0,
    });
    const { code } = await startAndCaptureCode();
    expect(code).not.toBeNull();

    const signedIn = await verify({
      subjectType: APPLICANT_PORTAL_SUBJECT,
      identifier: NATIONAL_ID,
      phone: PHONE,
      code: code ?? '',
    });
    expect(signedIn.status).toBe(200);
    const body = data<{ totpRequired: boolean; accessToken: string; mustChangePassword: boolean }>(signedIn);
    expect(body.totpRequired).toBe(false);
    // No password exists, so there is nothing the candidate could be made to change.
    expect(body.mustChangePassword).toBe(false);
    portalToken = body.accessToken;

    // THE ASSERTION THIS SUITE EXISTS FOR: the token survives one more request.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(me.status).toBe(200);
  });

  it('burns the code — the same one cannot be spent twice', async () => {
    const account = await portalAccount(applicant.id);
    await userService.setPortalChallenge(String(account._id), {
      codeHash: null,
      expiresAt: null,
      sentAt: null,
      attempts: 0,
    });
    const { code } = await startAndCaptureCode();
    const body = {
      subjectType: APPLICANT_PORTAL_SUBJECT,
      identifier: NATIONAL_ID,
      phone: PHONE,
      code: code ?? '',
    };
    expect((await verify(body)).status).toBe(200);
    expect((await verify(body)).status).toBe(401);
  });

  it('refuses a phone the company does not hold, without saying so', async () => {
    const res = await challenge({
      subjectType: APPLICANT_PORTAL_SUBJECT,
      identifier: NATIONAL_ID,
      phone: '01000000000',
    });
    // The SAME answer as a real start — an attacker learns nothing about whose number is on file.
    expect(res.status).toBe(200);
    expect(data<{ accepted: boolean }>(res).accepted).toBe(true);
  });
});

/** A one-pixel PNG. Small, real, and the right MIME for a category that takes photographs. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const typeIdByKey = async (key: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-documents/types')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status, 'list document types').toBe(200);
  const found = data<ApplicantDocumentTypeDto[]>(res).find((t) => t.key === key);
  if (found === undefined) throw new Error(`document type ${key} was not seeded`);
  return found.id;
};

/** The candidate's own upload — no applicant id anywhere in it, because there is nowhere to put one. */
const submit = (token: string, typeId: string, extra: Record<string, string> = {}): request.Test => {
  const req = request(app)
    .post('/api/v1/hr/applicant-portal/documents')
    .set('Authorization', `Bearer ${token}`)
    .field('typeId', typeId);
  for (const [key, value] of Object.entries(extra)) req.field(key, value);
  return req.attach('file', PNG, 'certificate.png');
};

describe('the catalogue is data, and it is seeded (D-APP-4)', () => {
  it('asks for the four documents everyone owes and the fifth only drivers do', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicant-documents/types')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const types = data<ApplicantDocumentTypeDto[]>(res);
    expect(types.map((t) => t.key)).toEqual([
      'qualification',
      'birthCertificate',
      'militaryService',
      'nationalIdCard',
      'professionalDrivingLicense',
    ]);
    const licence = types.find((t) => t.key === 'professionalDrivingLicense');
    expect(licence?.applicability).toBe('driversOnly');
    expect(licence?.licenseClassRequired).toBe(true);
  });
});

describe('handing documents in', () => {
  it('asks this candidate for four — the licence belongs to a seat they are not in (D-APP-5)', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicant-portal/documents')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    const set = data<ApplicantDocumentSetDto>(res);
    expect(set.documents).toEqual([]);
    expect(set.missing.map((m) => m.typeKey)).toEqual([
      'qualification',
      'birthCertificate',
      'militaryService',
      'nationalIdCard',
    ]);
    expect(set.complete).toBe(false);
  });

  it('refuses a document this candidate is not asked for', async () => {
    const licence = await typeIdByKey('professionalDrivingLicense');
    const res = await submit(portalToken, licence, { licenseClass: 'first' });
    // 400, not 422: this is a refusal ABOUT A FIELD, and it comes back naming `typeId` so the
    // screen can point at the control that is wrong. `BusinessRuleError` (422) is what this
    // feature answers when the request is well-formed and the STATE forbids it — see the accepted
    // document below, which cannot be replaced.
    expect(res.status).toBe(400);
  });

  it('takes an upload, and the slot stops being missing', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await submit(portalToken, typeId);
    expect(res.status).toBe(201);
    const set = data<ApplicantDocumentSetDto>(res);
    const doc = set.documents.find((d) => d.typeKey === 'qualification');
    expect(doc?.status).toBe('pending');
    expect(doc?.mayReplace).toBe(true);
    expect(doc?.fileVersion).toBe(1);
    expect(set.missing.map((m) => m.typeKey)).not.toContain('qualification');
    expect(set.pendingReview).toBe(1);
  });

  it('replaces it in place — a new VERSION, not a second row (D-APP-7)', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await submit(portalToken, typeId);
    expect(res.status).toBe(201);
    const set = data<ApplicantDocumentSetDto>(res);
    expect(set.documents.filter((d) => d.typeKey === 'qualification')).toHaveLength(1);
    expect(set.documents.find((d) => d.typeKey === 'qualification')?.fileVersion).toBe(2);
  });

  it('refuses a licence class on a document that has no such thing (D-APP-6)', async () => {
    const typeId = await typeIdByKey('birthCertificate');
    const res = await submit(portalToken, typeId, { licenseClass: 'second' });
    expect(res.status).toBe(400);
  });
});

describe('HR rules on what was handed in', () => {
  it('is not something the candidate can do to their own file', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await request(app)
      .post(`/api/v1/hr/applicant-documents/${applicant.id}/documents/${typeId}/review`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ outcome: 'accepted' });
    expect(res.status).toBe(403);
  });

  it('refuses a rejection with no reason — the candidate is being asked to fix something', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await request(app)
      .post(`/api/v1/hr/applicant-documents/${applicant.id}/documents/${typeId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected' });
    // Refused by the schema itself, before the handler runs — the note is part of what a
    // rejection IS, not a rule the service applies afterwards.
    expect(res.status).toBe(400);
  });

  it('REJECTS with a reason, and the slot reopens for the candidate (D-APP-7ج)', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await request(app)
      .post(`/api/v1/hr/applicant-documents/${applicant.id}/documents/${typeId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', note: 'الصورة غير واضحة' });
    expect(res.status).toBe(200);
    const doc = data<ApplicantDocumentSetDto>(res).documents.find((d) => d.typeKey === 'qualification');
    expect(doc?.status).toBe('rejected');
    expect(doc?.reviewNote).toBe('الصورة غير واضحة');
    // The whole point of the refusal: they can act on it.
    expect(doc?.mayReplace).toBe(true);
  });

  it('lets the candidate hand in a better one, which lands back as pending', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await submit(portalToken, typeId);
    expect(res.status).toBe(201);
    const doc = data<ApplicantDocumentSetDto>(res).documents.find((d) => d.typeKey === 'qualification');
    expect(doc?.status).toBe('pending');
    // The old verdict does not survive the new file.
    expect(doc?.reviewNote).toBeNull();
  });

  it('ACCEPTS, and the slot locks', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await request(app)
      .post(`/api/v1/hr/applicant-documents/${applicant.id}/documents/${typeId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted' });
    expect(res.status).toBe(200);
    const doc = data<ApplicantDocumentSetDto>(res).documents.find((d) => d.typeKey === 'qualification');
    expect(doc?.status).toBe('accepted');
    expect(doc?.mayReplace).toBe(false);
  });

  it('will not let the candidate swap an accepted document underneath the reviewer', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await submit(portalToken, typeId);
    expect(res.status).toBe(422);
  });

  it('will not re-decide a settled slot', async () => {
    const typeId = await typeIdByKey('qualification');
    const res = await request(app)
      .post(`/api/v1/hr/applicant-documents/${applicant.id}/documents/${typeId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'rejected', note: 'مرة أخرى' });
    expect(res.status).toBe(409);
  });
});

describe('D-APP-9 — one candidate never reaches another', () => {
  it('reads only their OWN set, whoever else exists', async () => {
    const other = await registerApplicant('29001011590088', '01099880088');
    await acceptScreening(other.id);
    await portalAccount(other.id);

    const mine = await request(app)
      .get('/api/v1/hr/applicant-portal/documents')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(mine.status).toBe(200);
    // The set that comes back is decided by the session, and there is no parameter that could
    // have pointed it anywhere else.
    expect(data<ApplicantDocumentSetDto>(mine).applicantId).toBe(applicant.id);
  });

  it('cannot reach the staff review surface at all', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicant-documents')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(403);
  });
});

describe('confinement — the candidate reaches their own file and nothing else (ADR-027)', () => {
  it('is refused the staff directory, which every EMPLOYEE may reach', async () => {
    expect(portalToken).toBeDefined();
    const res = await request(app)
      .post('/api/v1/platform/directory/resolve')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ userIds: [adminId] });
    expect(res.status).toBe(403);
  });

  it('is refused recruitment itself — the applicant list is not the applicant portal', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(403);
  });

  it('cannot write outside its declared prefix either', async () => {
    const res = await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ applicantId: applicant.id });
    expect(res.status).toBe(403);
  });
});
