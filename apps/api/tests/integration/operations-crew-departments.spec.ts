// Who is Operations crew when a department is chosen ONCE — over real HTTP, real HR and a real org
// chart of several branches.
//
// The owner, of the «إدارات العمليات» card that listed «نقل الاموال» once per branch: «القائمة دي
// كانت معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع. فإحنا عايزين
// نعدل الموضوع ده». The card now offers one choice per COMPANY department, and the setting it
// saves (`operations.crewDepartmentIds`, still department ids — nothing was migrated) is read by the
// server as those departments in every branch. Pinned here, on the roster every crew screen draws
// from (`GET /operations/crew-board/directory`):
//
//   · one branch copy saved → the same department's people in the other branches are crew, a copy
//     linked to the catalog and a never-linked copy of the same name alike;
//   · a department no branch linked to the catalog is one department by its name, in every branch;
//   · a branch that adds the department AFTER the save is crew without anybody saving again;
//   · a department that was not chosen stays out;
//   · a saved id nothing answers to any more is harmless, and one of a deactivated copy still
//     says which department was meant;
//   · nothing saved is still the old fallback, and says so.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  OperationsSettingKeys,
  SettingKeys,
  platformPermissions,
  type OperationsCrewDirectoryDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { DepartmentModel } from '../../src/platform/organization';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let jobTitleId: string;

let nidCounter = 0;
let phoneCounter = 0;
const nextNid = (): string => `290010101${String(60_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `015${String(phoneCounter++).padStart(8, '0')}`;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-crew-departments-test-${Date.now()}`;
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

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const call = (
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: Record<string, unknown>,
): request.Test => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
  return body === undefined ? req : req.send(body);
};

const mkBranch = async (code: string, ar: string): Promise<string> => {
  const res = await call('post', '/platform/branches', { code, name: { ar, en: ar } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

const mkCatalog = async (code: string, ar: string, en: string): Promise<string> => {
  const res = await call('post', '/platform/department-catalog', { code, name: { ar, en } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

interface Unit {
  id: string;
  branchId: string;
  version: number;
}

/** A branch copy: linked to a catalog entry (which names it), or with a name of its own. */
const mkDepartment = async (
  code: string,
  branchId: string,
  of: { catalogId: string } | { ar: string; en: string },
): Promise<Unit> => {
  const res = await call('post', '/platform/departments', {
    code,
    branchId,
    ...('catalogId' in of ? { catalogId: of.catalogId } : { name: { ar: of.ar, en: of.en } }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const dto = data<{ id: string; version: number }>(res);
  // A copy "with a name of its own" stands for one made before anyone linked it. Since P-ORG-3 the
  // service links a new row to the company list when it creates it (§5.6), so the link is undone
  // here — the cases below are about rows that never had one.
  if (!('catalogId' in of)) {
    await DepartmentModel.updateOne({ _id: new Types.ObjectId(dto.id) }, { $set: { catalogId: null } });
  }
  return { id: dto.id, branchId, version: dto.version };
};

const mkEmployee = async (
  fullNameAr: string,
  unit: Unit,
  seat = jobTitleId,
  phone = nextPhone(),
): Promise<string> => {
  const res = await call('post', '/hr/employees/direct', {
    personal: {
      identity: { fullNameAr, nationalId: nextNid(), nationality: 'Egyptian' },
      contact: { primaryPhone: phone },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId: seat,
      departmentId: unit.id,
      branchId: unit.branchId,
      employmentType: 'fullTime',
      probationMonths: 0,
      startDate: '2026-07-01T00:00:00.000Z',
    },
    entryStatus: 'active',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

/** Save the setting the way the card does — through the platform settings write. */
const saveCrewDepartments = async (ids: string[]): Promise<void> => {
  const res = await call('patch', '/platform/settings/values', {
    key: OperationsSettingKeys.CrewDepartmentIds,
    scope: 'organization',
    value: ids,
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
};

const roster = async (): Promise<{ ids: string[]; derived: boolean }> => {
  const res = await call('get', '/operations/crew-board/directory');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const dto = data<OperationsCrewDirectoryDto>(res);
  return { ids: dto.members.map((m) => m.employeeId), derived: dto.rosterIsDerived };
};

// The owner's own departments, across branches.
let mohandessin = '';
let tanta = '';
let alex = '';
let cashCatalog = '';
let cashMohandessin: Unit;
let cashTanta: Unit;
let cashAlexUnlinked: Unit;
let opsMohandessin: Unit;
let hrMohandessin: Unit;
const people = { cashMohandessin: '', cashTanta: '', cashAlex: '', ops: '', hr: '' };

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...operationsPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('ops-crew-departments-admin@ecms.local');
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
  adminToken = await login('ops-crew-departments-admin@ecms.local');

  const title = await call('post', '/platform/job-titles', {
    code: 'OPS-CD-CREW',
    name: { ar: 'أخصائي عمليات', en: 'Ops Specialist' },
    jobGrade: 'G1',
  });
  expect(title.status).toBe(201);
  jobTitleId = data<{ id: string }>(title).id;

  mohandessin = await mkBranch('71', 'المهندسين');
  tanta = await mkBranch('72', 'طنطا');
  alex = await mkBranch('73', 'الإسكندرية');

  cashCatalog = await mkCatalog('CAT-CASH', 'نقل الأموال', 'Cash Transfer');
  const hrCatalog = await mkCatalog('CAT-HR', 'الموارد البشرية', 'Human Resources');

  cashMohandessin = await mkDepartment('DEP-0004', mohandessin, { catalogId: cashCatalog });
  cashTanta = await mkDepartment('DEP-0005', tanta, { catalogId: cashCatalog });
  // A copy made before anyone linked it, spelled the way the importer found it.
  cashAlexUnlinked = await mkDepartment('DEP-0010', alex, { ar: 'نقل الاموال', en: 'Cash' });
  opsMohandessin = await mkDepartment('DEP-0001', mohandessin, { ar: 'العمليات', en: 'Ops' });
  hrMohandessin = await mkDepartment('DEP-0002', mohandessin, { catalogId: hrCatalog });

  people.cashMohandessin = await mkEmployee('أحمد فتحي السيد', cashMohandessin);
  people.cashTanta = await mkEmployee('شادي محمد أحمد', cashTanta);
  people.cashAlex = await mkEmployee('كريم سمير علي', cashAlexUnlinked);
  people.ops = await mkEmployee('محمود حسن عبد الله', opsMohandessin);
  people.hr = await mkEmployee('هاني عادل منصور', hrMohandessin);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a department chosen once is that department in every branch', () => {
  it('nothing saved is still the fallback, and says so', async () => {
    const { derived } = await roster();
    expect(derived).toBe(false);
  });

  it('one branch copy saved brings in the same department in the other branches', async () => {
    await saveCrewDepartments([cashMohandessin.id]);
    const { ids, derived } = await roster();
    expect(derived).toBe(true);
    // The saved copy, the other catalog-linked copy, and the never-linked copy of the same name.
    expect(ids).toContain(people.cashMohandessin);
    expect(ids).toContain(people.cashTanta);
    expect(ids).toContain(people.cashAlex);
  });

  it('leaves departments that were not chosen out', async () => {
    const { ids } = await roster();
    expect(ids).not.toContain(people.ops);
    expect(ids).not.toContain(people.hr);
  });

  it('saving the never-linked copy alone means the same department', async () => {
    await saveCrewDepartments([cashAlexUnlinked.id]);
    const { ids } = await roster();
    expect(ids).toEqual(
      expect.arrayContaining([people.cashMohandessin, people.cashTanta, people.cashAlex]),
    );
    expect(ids).not.toContain(people.ops);
  });

  // «العمليات» in the owner's screenshot (DEP-0001, DEP-0011, …) is one department no branch ever
  // linked to the catalog — so its copies are one department by NAME, and the roster must agree.
  it('a department never linked to the catalog is the same department in every branch', async () => {
    const opsTanta = await mkDepartment('DEP-0011', tanta, { ar: 'العمليات', en: 'Operations' });
    const opsTantaPerson = await mkEmployee('ياسر رضا عبد الحميد', opsTanta);
    await saveCrewDepartments([opsMohandessin.id]);
    const { ids } = await roster();
    expect(ids).toEqual(expect.arrayContaining([people.ops, opsTantaPerson]));
    expect(ids).not.toContain(people.cashMohandessin);
    expect(ids).not.toContain(people.hr);
  });

  it('a branch that adds the department after the save is crew without saving again', async () => {
    await saveCrewDepartments([cashMohandessin.id]);
    const giza = await mkBranch('74', 'الجيزة');
    const cashGiza = await mkDepartment('DEP-0026', giza, { catalogId: cashCatalog });
    const newcomer = await mkEmployee('مصطفى إبراهيم حسين', cashGiza);
    const { ids } = await roster();
    expect(ids).toContain(newcomer);
  });

  it('an id nothing answers to any more is harmless beside a real one', async () => {
    await saveCrewDepartments([cashTanta.id, '507f1f77bcf86cd7994390ff']);
    const { ids, derived } = await roster();
    expect(derived).toBe(true);
    expect(ids).toEqual(
      expect.arrayContaining([people.cashMohandessin, people.cashTanta, people.cashAlex]),
    );
    expect(ids).not.toContain(people.hr);
  });

  it('an id nothing answers to, alone, is a configured roster of nobody — not the fallback', async () => {
    await saveCrewDepartments(['507f1f77bcf86cd7994390ff']);
    const { ids, derived } = await roster();
    expect(derived).toBe(true);
    expect(ids).toEqual([]);
  });

  it('a deactivated copy still names its department, and its own people stay', async () => {
    // Deactivate the Tanta copy while its employee is still in it, then save only that copy.
    const deactivated = await call('patch', `/platform/departments/${cashTanta.id}`, {
      status: 'inactive',
      version: cashTanta.version,
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);
    await saveCrewDepartments([cashTanta.id]);
    const { ids } = await roster();
    // Its own people: the saved id is kept as it is, so the roster is never narrower than today's.
    expect(ids).toContain(people.cashTanta);
    // And the department it was a copy of, in the branches where it is still active.
    expect(ids).toContain(people.cashMohandessin);
    expect(ids).toContain(people.cashAlex);
    expect(ids).not.toContain(people.ops);
  });
});

// Round 19 — «الوظيفة» on «كشف طاقم العمليات». The legacy roster printed every member's job title
// beside the name and filtered by it («اختر الوظيفة»). It travels with the roster the way the name
// and the code do — through the directory seam, HR answering — named from the organization's
// job-title catalogue, under the roster's own grant.
describe('each member carries the seat HR placed them in', () => {
  const HEAD = { ar: 'رئيس قسم تشغيل نقل الأموال', en: 'Head of cash transfer operations' };
  let headTitleId = '';
  let head = '';

  const members = async (): Promise<OperationsCrewDirectoryDto['members']> => {
    const res = await call('get', '/operations/crew-board/directory');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return data<OperationsCrewDirectoryDto>(res).members;
  };

  beforeAll(async () => {
    const title = await call('post', '/platform/job-titles', {
      code: 'OPS-CD-HEAD',
      name: HEAD,
      jobGrade: 'G2',
    });
    expect(title.status, JSON.stringify(title.body)).toBe(201);
    headTitleId = data<{ id: string }>(title).id;
    head = await mkEmployee('أيمن إسماعيل عبد العظيم', cashMohandessin, headTitleId);
  });

  it('names each member’s own seat from the catalogue', async () => {
    await saveCrewDepartments([cashMohandessin.id]);
    const roster = await members();
    const of = (id: string) => roster.find((member) => member.employeeId === id);
    expect(of(head)?.jobTitle).toEqual({ id: headTitleId, name: HEAD });
    expect(of(people.cashMohandessin)?.jobTitle).toEqual({
      id: jobTitleId,
      name: { ar: 'أخصائي عمليات', en: 'Ops Specialist' },
    });
  });

  it('the unconfigured fallback list carries it too', async () => {
    // The fallback is whoever already holds a requirements row, read one by one through the seam:
    // the seat must not depend on which way the roster was found.
    const set = await request(app)
      .put(`/api/v1/operations/crew-board/requirements/${head}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isCaptain: true });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await saveCrewDepartments([]);
    const roster = await members();
    expect(roster.find((member) => member.employeeId === head)?.jobTitle).toEqual({
      id: headTitleId,
      name: HEAD,
    });
  });
});

// Round 19b — «ولما اقف على القائد يجيب بياناته زى السواق»: hovering a member's name on «كشف طاقم
// العمليات» opens the Fleet driver card's facts — so the mobile number and the branch travel with
// the roster, through the same seam and under the same grant as the name, the code and the seat.
describe('each member carries the phone and the branch HR has on file', () => {
  const PHONE = '01098765432';
  let captain = '';

  const memberOf = async (id: string): Promise<OperationsCrewDirectoryDto['members'][number]> => {
    const res = await call('get', '/operations/crew-board/directory');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const found = data<OperationsCrewDirectoryDto>(res).members.find((m) => m.employeeId === id);
    expect(found, `${id} is on the roster`).toBeDefined();
    return found as OperationsCrewDirectoryDto['members'][number];
  };

  beforeAll(async () => {
    // Alexandria's never-linked copy: Tanta's was deactivated above, and is crew only when saved.
    captain = await mkEmployee('وليد صبحي عبد السلام', cashAlexUnlinked, jobTitleId, PHONE);
  });

  it('on the org-chart roster: HR’s primary phone, and the branch of the seat', async () => {
    await saveCrewDepartments([cashMohandessin.id]);
    const member = await memberOf(captain);
    expect(member.phone).toBe(PHONE);
    // Alexandria's copy of «نقل الأموال» — the member's own branch, not the branch of the copy saved.
    expect(member.branchId).toBe(alex);
    expect((await memberOf(people.cashMohandessin)).branchId).toBe(mohandessin);
  });

  it('on the unconfigured fallback list too — however the roster was found', async () => {
    const set = await request(app)
      .put(`/api/v1/operations/crew-board/requirements/${captain}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isCaptain: true });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await saveCrewDepartments([]);
    const member = await memberOf(captain);
    expect(member).toMatchObject({ phone: PHONE, branchId: alex });
  });
});
