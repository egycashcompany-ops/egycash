// The company ID card (كارنيه الشركة) over HTTP, against a running server.
//
// Three claims here cannot be made by a unit test, because each is about several things agreeing at
// once — the permission registry, the route guard, the scoped employee lookup, and MongoDB itself:
//
//   1. WHO MAY DO WHAT. Printing a card, and reading what goes on it, cost `employee.editPersonal`;
//      seeing how often it was printed costs `employee.view`. A unit test can assert that a handler
//      was called with a key; only a server can prove the key on the route is the key the registry
//      knows and the one a real token carries.
//   2. THE NATIONAL ID LEAVES THROUGH EXACTLY ONE DOOR. `personal.nationalId` is masked in every
//      DTO (Security Architecture §3). `GET /hr/employees/:id/id-card` returns it whole because it
//      is printed on the card. Both halves are asserted against the same employee in the same run,
//      so the day somebody unmasks it elsewhere, this fails.
//   3. PRINTING IS NOT RECEIVING, EVEN TWICE AT ONCE. The count moves on the handover alone, and
//      the handover is one conditional `findOneAndUpdate` — so two HR users confirming the same
//      card at the same moment must count one card between them. That is a claim about an atomic
//      update against a real database; an in-process double is not evidence of it.
//
// Every person here is invented, and lives only in this run's in-memory database: the national IDs
// are the generator below (a fixed 1990-03-07 birth date and a serial), not anybody's number.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type EmployeeDto,
  type EmployeeIdCardDataDto,
  type EmployeeIdCardPrintDto,
  type EmployeeIdCardSummaryDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let ADMIN_ID = '';
let adminToken = '';
/** `employee.view` + `employee.editPersonal`: HR, who prints the card and hands it over. */
let hrToken = '';
/** `employee.view` only: may read the print history, may not print or read the card's data. */
let viewerToken = '';
/** HR's own two keys, but scoped to ANOTHER branch — the employee is out of reach. */
let farHrToken = '';
/** No employee key at all. */
let outsiderToken = '';

let BRANCH_ID = '';
let OTHER_BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorOf = (res: request.Response): { code: string; message: string } =>
  (res.body as { error: { code: string; message: string } }).error;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-id-card-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
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

/** A role holding exactly these keys, assigned at this scope to a fresh account. */
const accountWith = async (
  email: string,
  keys: string[],
  scope: 'organization' | 'branch' = 'organization',
  branchId: string | null = null,
): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    ADMIN_ID,
  );
  const userId = await mkUser(email, branchId);
  await rbacService.ensureAssignment(userId, String(role._id), scope);
  return login(email);
};

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

/** 2 YY MM DD GG SSS G C — an invented 1990-03-07 Cairo birth; the serial keeps each distinct. */
let serial = 400;
const nationalId = (): string => `2900307011${String(serial++).padStart(3, '0')}1`;

/** A fresh employee, so no test inherits another's counters — with the number as it was typed. */
const register = async (
  fullNameAr: string,
): Promise<{ employee: EmployeeDto; typedNationalId: string }> => {
  const id = nationalId();
  const res = await asAdmin('post', '/hr/employees/direct').send({
    personal: {
      identity: { fullNameAr, fullNameEn: 'Card Person', nationalId: id, nationality: 'Egyptian' },
      contact: { primaryPhone: `0102${String(serial).padStart(7, '0')}` },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId: JOB_TITLE_ID,
      branchId: BRANCH_ID,
      departmentId: DEPARTMENT_ID,
      employmentType: 'fullTime',
      salary: { amount: 12000, currency: 'EGP' },
      probationMonths: 0,
      startDate: '2026-01-01T00:00:00.000Z',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { employee: data<EmployeeDto>(res), typedNationalId: id };
};

const cardPath = (id: string): string => `/api/v1/hr/employees/${id}/id-card`;

const card = (token: string, id: string) =>
  request(app).get(cardPath(id)).set('Authorization', `Bearer ${token}`);
const printCard = (token: string, id: string) =>
  request(app).post(`${cardPath(id)}/prints`).set('Authorization', `Bearer ${token}`);
const printReceipt = (token: string, id: string) =>
  request(app).post(`${cardPath(id)}/receipts`).set('Authorization', `Bearer ${token}`);
const handOver = (token: string, id: string) =>
  request(app).post(`${cardPath(id)}/handovers`).set('Authorization', `Bearer ${token}`);
const history = (token: string, id: string) =>
  request(app).get(`${cardPath(id)}/prints`).set('Authorization', `Bearer ${token}`);

/** The counters as the list and the profile read them. */
const summaryOf = async (id: string): Promise<EmployeeIdCardSummaryDto> =>
  data<EmployeeIdCardDataDto>(await card(hrToken, id)).summary;

// ── Boot ──────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  ADMIN_ID = await mkUser('card-admin@ecms.local');
  await rbacService.ensureAssignment(ADMIN_ID, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: ADMIN_ID,
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
  adminToken = await login('card-admin@ecms.local');

  BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: '001',
      name: { ar: 'الرئيسي', en: 'HQ' },
    }),
  ).id;
  OTHER_BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: '002',
      name: { ar: 'الفرع الثاني', en: 'Second' },
    }),
  ).id;
  DEPARTMENT_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/departments').send({
      code: 'DEP-CARD',
      name: { ar: 'التشغيل', en: 'Operations' },
      branchId: BRANCH_ID,
    }),
  ).id;
  JOB_TITLE_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/job-titles').send({
      code: 'JT-CARD',
      name: { ar: 'محاسب', en: 'Accountant' },
      jobGrade: 'G5',
    }),
  ).id;

  hrToken = await accountWith('card-hr@ecms.local', ['employee.view', 'employee.editPersonal']);
  viewerToken = await accountWith('card-viewer@ecms.local', ['employee.view']);
  farHrToken = await accountWith(
    'card-far@ecms.local',
    ['employee.view', 'employee.editPersonal'],
    'branch',
    OTHER_BRANCH_ID,
  );
  outsiderToken = await accountWith('card-outsider@ecms.local', ['applicant.view']);
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── What is printed on the card ───────────────────────────────────────────────

describe('GET /hr/employees/:id/id-card', () => {
  it('gives HR everything the card carries, and an untouched card reads as never received', async () => {
    const { employee } = await register('موظف الكارنيه الأول');

    const res = await card(hrToken, employee.id);

    expect(res.status).toBe(200);
    const body = data<EmployeeIdCardDataDto>(res);
    expect(body).toMatchObject({
      employeeId: employee.id,
      code: employee.code,
      fullNameAr: 'موظف الكارنيه الأول',
      hasPhoto: false,
    });
    // The title travels as localized text; the card itself draws the Arabic.
    expect(body.jobTitle).toEqual({ ar: 'محاسب', en: 'Accountant' });
    expect(body.summary).toMatchObject({
      receivedCount: 0,
      printCount: 0,
      awaitingHandover: false,
      firstReceivedAt: null,
      lastReceivedAt: null,
      receiptPrintedAt: null,
    });
  });

  /**
   * THE ONE DOOR. The card needs the whole number because it is printed on it; every other read of
   * the same person keeps it masked. Both are asserted here, against one employee, in one run.
   */
  it('returns the national ID whole — and the ordinary employee read still masks it', async () => {
    const { employee, typedNationalId: typed } = await register('موظف الرقم القومي');

    const onTheCard = data<EmployeeIdCardDataDto>(await card(hrToken, employee.id)).nationalId;
    const onTheProfile = data<EmployeeDto>(
      await request(app)
        .get(`/api/v1/hr/employees/${employee.id}`)
        .set('Authorization', `Bearer ${hrToken}`),
    ).personal.nationalIdMasked;

    expect(onTheCard).toBe(typed);
    expect(onTheProfile).not.toBe(typed);
    expect(onTheProfile).toMatch(/\*/);
  });

  it('refuses a reader who may see employees but not edit their personal data', async () => {
    const { employee } = await register('موظف للقارئ');
    expect((await card(viewerToken, employee.id)).status).toBe(403);
  });

  it('refuses a caller with no employee key, and an unauthenticated one', async () => {
    const { employee } = await register('موظف للغريب');
    expect((await card(outsiderToken, employee.id)).status).toBe(403);
    expect((await request(app).get(cardPath(employee.id))).status).toBe(401);
  });

  /** Out of scope is 404, not 403: the same answer every other employee route gives. */
  it("hides an employee outside the caller's branch, though they hold both keys", async () => {
    const { employee } = await register('موظف فرع آخر');
    expect((await card(farHrToken, employee.id)).status).toBe(404);
  });
});

// ── Printing is not receiving ─────────────────────────────────────────────────

describe('POST /hr/employees/:id/id-card/prints', () => {
  it('counts a print, marks the card waiting, and moves no card received', async () => {
    const { employee } = await register('موظف الطباعة');

    const res = await printCard(hrToken, employee.id);

    expect(res.status).toBe(201);
    expect(data<EmployeeIdCardSummaryDto>(res)).toMatchObject({
      printCount: 1,
      receivedCount: 0,
      awaitingHandover: true,
    });
  });

  it('counts three reprints as three prints and still no card', async () => {
    const { employee } = await register('موظف إعادة الطباعة');

    for (const expected of [1, 2, 3]) {
      const res = await printCard(hrToken, employee.id);
      expect(data<EmployeeIdCardSummaryDto>(res).printCount).toBe(expected);
    }

    expect(await summaryOf(employee.id)).toMatchObject({ printCount: 3, receivedCount: 0 });
  });

  it('refuses a reader, and an unauthenticated caller', async () => {
    const { employee } = await register('موظف منع الطباعة');
    expect((await printCard(viewerToken, employee.id)).status).toBe(403);
    expect((await request(app).post(`${cardPath(employee.id)}/prints`)).status).toBe(401);
  });
});

// ── The receipt ───────────────────────────────────────────────────────────────

describe('POST /hr/employees/:id/id-card/receipts', () => {
  it('records the receipt for a waiting card, and keeps it across reads', async () => {
    const { employee } = await register('موظف الإقرار');
    await printCard(hrToken, employee.id);

    const res = await printReceipt(hrToken, employee.id);

    expect(res.status).toBe(200);
    expect(data<EmployeeIdCardSummaryDto>(res).receiptPrintedAt).not.toBeNull();
    expect((await summaryOf(employee.id)).receiptPrintedAt).not.toBeNull();
  });

  it('refuses a receipt when no card is waiting for one', async () => {
    const { employee } = await register('موظف بلا طباعة');

    const res = await printReceipt(hrToken, employee.id);

    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('DUPLICATE');
  });

  it('refuses a reader', async () => {
    const { employee } = await register('موظف منع الإقرار');
    await printCard(hrToken, employee.id);
    expect((await printReceipt(viewerToken, employee.id)).status).toBe(403);
  });
});

// ── The handover: the only thing that counts a card ───────────────────────────

describe('POST /hr/employees/:id/id-card/handovers', () => {
  it('counts the card, clears the receipt step, and stops waiting', async () => {
    const { employee } = await register('موظف الاستلام');
    await printCard(hrToken, employee.id);
    await printReceipt(hrToken, employee.id);

    const res = await handOver(hrToken, employee.id);

    expect(res.status).toBe(200);
    expect(data<EmployeeIdCardSummaryDto>(res)).toMatchObject({
      receivedCount: 1,
      printCount: 1,
      awaitingHandover: false,
      receiptPrintedAt: null,
    });
    const after = await summaryOf(employee.id);
    expect(after.firstReceivedAt).not.toBeNull();
    expect(after.lastReceivedAt).not.toBeNull();
  });

  /** The 409 the owner asked for by name: confirming a handover with nothing printed. */
  it('refuses a confirm when nothing has been printed', async () => {
    const { employee } = await register('موظف بلا كارنيه');

    const res = await handOver(hrToken, employee.id);

    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('DUPLICATE');
    expect(await summaryOf(employee.id)).toMatchObject({ receivedCount: 0, printCount: 0 });
  });

  it('refuses a second confirm for the same printed card', async () => {
    const { employee } = await register('موظف تأكيد مكرر');
    await printCard(hrToken, employee.id);
    expect((await handOver(hrToken, employee.id)).status).toBe(200);

    expect((await handOver(hrToken, employee.id)).status).toBe(409);
    expect((await summaryOf(employee.id)).receivedCount).toBe(1);
  });

  /**
   * TWO AT ONCE. Two HR users pressing «تأكيد الاستلام» on the same card in the same moment — or
   * one user double-clicking. The condition is inside the update, so the database decides: exactly
   * one of the two writes finds a card waiting, and the other finds none.
   */
  it('counts one card when two confirms land together', async () => {
    const { employee } = await register('موظف التأكيد المتزامن');
    await printCard(hrToken, employee.id);

    const [first, second] = await Promise.all([
      handOver(hrToken, employee.id),
      handOver(hrToken, employee.id),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect((await summaryOf(employee.id)).receivedCount).toBe(1);
  });

  /** The same card printed again is a new card to hand over — the counter may move a second time. */
  it('counts the next card once it has been printed again', async () => {
    const { employee } = await register('موظف الكارنيه الثاني');
    await printCard(hrToken, employee.id);
    await handOver(hrToken, employee.id);
    await printCard(hrToken, employee.id);

    expect(data<EmployeeIdCardSummaryDto>(await handOver(hrToken, employee.id))).toMatchObject({
      receivedCount: 2,
      printCount: 2,
    });
  });

  it('refuses a reader', async () => {
    const { employee } = await register('موظف منع التأكيد');
    await printCard(hrToken, employee.id);
    expect((await handOver(viewerToken, employee.id)).status).toBe(403);
  });
});

// ── The history ───────────────────────────────────────────────────────────────

describe('GET /hr/employees/:id/id-card/prints', () => {
  it('is open to anyone who may see the employee — seeing it is seeing them', async () => {
    const { employee } = await register('موظف السجل');
    await printCard(hrToken, employee.id);

    const res = await history(viewerToken, employee.id);

    expect(res.status).toBe(200);
    expect(data<EmployeeIdCardPrintDto[]>(res)).toHaveLength(1);
  });

  it('numbers every print, newest first, and marks the one handed over', async () => {
    const { employee } = await register('موظف سجل الاستلام');
    await printCard(hrToken, employee.id);
    await printCard(hrToken, employee.id);
    await handOver(hrToken, employee.id);

    const rows = data<EmployeeIdCardPrintDto[]>(await history(hrToken, employee.id));

    expect(rows.map((r) => r.printNumber)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ receivedNumber: 1, withPhoto: false });
    expect(rows[0]?.receivedAt).not.toBeNull();
    expect(rows[1]?.receivedAt).toBeNull();
  });

  it('refuses a caller with no employee key, and an unauthenticated one', async () => {
    const { employee } = await register('موظف منع السجل');
    expect((await history(outsiderToken, employee.id)).status).toBe(403);
    expect((await request(app).get(`${cardPath(employee.id)}/prints`)).status).toBe(401);
  });
});
