// Scope B1 — the payroll report builder, over real HTTP with real RBAC.
//
// The unit specs already settle the parts that are pure: which group key a set of dimensions
// composes, which filters are pre- or post-unwind, what a calculated column evaluates to. None of
// that can tell us whether the *endpoint* is safe, because the two properties that matter here are
// properties of the request path as a whole:
//
//   1. TWO KEYS ON EVERY EXECUTION. `payrollReport.view` says a person may use the builder;
//      `employee.viewCompensation` says whose pay they may see. Holding one without the other must
//      not run a report, or the new key becomes a way to read payroll without the payroll key.
//   2. THE CALLER'S SCOPE, AND NOTHING A DEFINITION CAN SAY ABOUT IT. A definition names no branch
//      and no employee; the scope arrives from the token. So the SAME saved report must answer two
//      readers differently, and a filter — which is the only thing a request controls — must never
//      widen what the scope allowed.
//
// Both are asserted against a real run with real payslips in two branches, because a scope test
// over an empty collection proves nothing: every scope returns no rows when there are no rows.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type GeneratePayslipsResultDto,
  type PayrollReportDefinitionDto,
  type PayrollReportResultDto,
  type PayrollRunDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const PERIOD = '2026-02'; // a month that has ended, in this file's own database

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = ''; // everything, organization scope — the seeder and the control reader
let builderToken = ''; // payrollReport.view + .manage + employee.viewCompensation @ organization
let branchToken = ''; // the same three keys, BRANCH scope, standing in branch A
let departmentToken = ''; // the same three keys, DEPARTMENT scope, standing in department A
let editorToken = ''; // the report keys WITHOUT employee.viewCompensation
let payrollOnlyToken = ''; // employee.viewCompensation WITHOUT any report key
let readerToken = ''; // payrollReport.view only — the negative control for every write
let outsiderToken = ''; // no keys at all

let BRANCH_A = '';
let BRANCH_B = '';
let DEPARTMENT_A = '';
let runId = '';

const BASE = '/api/v1/hr/payroll/reports';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-payroll-reports-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const rows = <T>(res: request.Response): T[] => (res.body as { data: T[] }).data;
const errorOf = (res: request.Response): { code: string; message: string } =>
  (res.body as { error: { code: string; message: string } }).error;

const mkUser = async (
  email: string,
  branchId: string | null,
  departmentId: string | null,
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (identifier: string): Promise<string> => {
  await getCache().delByPrefix('rl:');
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

/** A caller with exactly the listed keys, at the given scope, standing where it is placed. */
const mkCaller = async (
  email: string,
  roleKey: string,
  permissions: string[],
  scope: 'organization' | 'branch' | 'department',
  placement: { branchId: string | null; departmentId: string | null } = {
    branchId: null,
    departmentId: null,
  },
): Promise<string> => {
  const role = await rbacService.ensureManagedRole(
    roleKey,
    { en: roleKey, ar: roleKey },
    permissions,
  );
  const userId = await mkUser(email, placement.branchId, placement.departmentId);
  await rbacService.ensureAssignment(userId, String(role._id), scope);
  return login(email);
};

// ── Requests ────────────────────────────────────────────────────────────────

const list = (query = '', token = builderToken) =>
  request(app).get(`${BASE}${query}`).set('Authorization', `Bearer ${token}`);
const getOne = (id: string, token = builderToken) =>
  request(app).get(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`);
const create = (body: object, token = builderToken) =>
  request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(body);
const update = (id: string, body: object, token = builderToken) =>
  request(app).patch(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`).send(body);
const remove = (id: string, token = builderToken) =>
  request(app).delete(`${BASE}/${id}`).set('Authorization', `Bearer ${token}`);
const preview = (body: object, token = builderToken) =>
  request(app).post(`${BASE}/preview`).set('Authorization', `Bearer ${token}`).send(body);
const runStored = (id: string, body: object, token = builderToken) =>
  request(app).post(`${BASE}/${id}/run`).set('Authorization', `Bearer ${token}`).send(body);

/** The minimum a definition must say, with everything else defaulted by the contract. */
const definition = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: { ar: 'تقرير', en: 'Report' },
  sourceId: 'payrollRunLines',
  dimensions: ['branch'],
  measures: ['lineCount', 'amountMinor'],
  ...over,
});

const totalOf = (result: PayrollReportResultDto): number =>
  result.rows.reduce((sum, row) => sum + (row.measures['amountMinor'] ?? 0), 0);

const branchIdsIn = (result: PayrollReportResultDto): string[] =>
  result.rows.flatMap((row) =>
    row.cells.filter((cell) => cell.dimension === 'branch' && cell.id !== null).map((cell) => cell.id as string),
  );

// ── One run, two branches, real payslips ────────────────────────────────────

let nid = 0;
const mkEmployee = async (
  branchId: string,
  departmentId: string,
  jobTitleId: string,
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف التقارير',
          nationalId: `290010102${String(400 + nid++)}10`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `0117600000${String(nid)}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2024-01-01T00:00:00.000Z',
        salary: { amount: 10_000, currency: 'EGP' },
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local', null, null);
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
  adminToken = await login('admin@ecms.local');

  // Two branches so a scoped reader has something to be kept out of.
  const branchA = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'RPT-A', name: { ar: 'المركز', en: 'HQ' } });
  BRANCH_A = data<{ id: string }>(branchA).id;
  const branchB = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'RPT-B', name: { ar: 'فرع', en: 'Branch' } });
  BRANCH_B = data<{ id: string }>(branchB).id;

  const depA = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-RPT-A', name: { ar: 'إدارة أ', en: 'Ops A' }, branchId: BRANCH_A });
  DEPARTMENT_A = data<{ id: string }>(depA).id;
  const depB = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-RPT-B', name: { ar: 'إدارة ب', en: 'Ops B' }, branchId: BRANCH_B });
  const DEPARTMENT_B = data<{ id: string }>(depB).id;

  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-RPT', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  const JOB_TITLE = data<{ id: string }>(title).id;

  const employeeA = await mkEmployee(BRANCH_A, DEPARTMENT_A, JOB_TITLE);
  const employeeB = await mkEmployee(BRANCH_B, DEPARTMENT_B, JOB_TITLE);

  // A flat earning, so each payslip carries a line beyond the basic salary and the two branches
  // differ by an amount a scope test can actually see.
  const item = await request(app)
    .post('/api/v1/hr/payroll/pay-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: 'RPT_HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
  expect(item.status, JSON.stringify(item.body)).toBe(201);
  const payItemId = data<{ id: string }>(item).id;

  for (const [employeeId, amount] of [
    [employeeA, 1000],
    [employeeB, 2000],
  ] as const) {
    const assigned = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/pay-items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payItemId, amount, effectiveFrom: '2024-01-01' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  }

  const created = await request(app)
    .post('/api/v1/hr/payroll/runs')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ period: PERIOD });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const run = data<PayrollRunDto>(created);
  runId = run.id;

  const frozen = await request(app)
    .post(`/api/v1/hr/payroll/runs/${runId}/freeze`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: run.version });
  expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);

  const issued = await request(app)
    .post(`/api/v1/hr/payroll/runs/${runId}/payslips`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  expect(data<GeneratePayslipsResultDto>(issued).created).toBeGreaterThan(1);

  // The eight callers this suite reasons about.
  builderToken = await mkCaller('rpt-builder@ecms.local', 'rpt-builder', [
    'payrollReport.view',
    'payrollReport.manage',
    'employee.viewCompensation',
  ], 'organization');

  branchToken = await mkCaller(
    'rpt-branch@ecms.local',
    'rpt-scoped',
    ['payrollReport.view', 'payrollReport.manage', 'employee.viewCompensation'],
    'branch',
    { branchId: BRANCH_A, departmentId: DEPARTMENT_A },
  );

  departmentToken = await mkCaller(
    'rpt-department@ecms.local',
    'rpt-scoped-department',
    ['payrollReport.view', 'employee.viewCompensation'],
    'department',
    { branchId: BRANCH_A, departmentId: DEPARTMENT_A },
  );

  editorToken = await mkCaller('rpt-editor@ecms.local', 'rpt-editor', [
    'payrollReport.view',
    'payrollReport.manage',
  ], 'organization');

  payrollOnlyToken = await mkCaller('rpt-payroll-only@ecms.local', 'rpt-payroll-only', [
    'employee.view',
    'employee.viewCompensation',
  ], 'organization');

  readerToken = await mkCaller('rpt-reader@ecms.local', 'rpt-reader', ['payrollReport.view'], 'organization');

  await mkUser('rpt-outsider@ecms.local', null, null);
  outsiderToken = await login('rpt-outsider@ecms.local');
}, 600_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── CRUD ────────────────────────────────────────────────────────────────────

describe('report definitions: the CRUD half', () => {
  let id = '';
  let version = 0;

  it('creates a definition and answers with where it now lives', async () => {
    const res = await create(
      definition({
        name: { ar: 'تكلفة الفروع', en: 'Branch cost' },
        dimensions: ['branch', 'kind'],
        sort: { key: 'amountMinor', direction: 'desc' },
        columns: [
          {
            key: 'perLine',
            expression: {
              kind: 'binary',
              op: 'divide',
              left: { kind: 'field', path: 'amountMinor' },
              right: { kind: 'field', path: 'lineCount' },
            },
          },
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const dto = data<PayrollReportDefinitionDto>(res);
    id = dto.id;
    version = dto.version;
    expect(res.headers['location']).toBe(`/api/v1/hr/payroll/reports/${id}`);
    expect(dto.dimensions).toEqual(['branch', 'kind']);
    expect(dto.status).toBe('active');
    expect(dto.columns[0]?.key).toBe('perLine');
    // Defaults the contract fills in, so a minimal body is a complete definition.
    expect(dto.filters).toEqual([]);
    expect(dto.description).toBeNull();
  });

  it('lists it, and reads it back by id', async () => {
    const listed = await list('?page=1&pageSize=50');
    expect(listed.status).toBe(200);
    expect(rows<PayrollReportDefinitionDto>(listed).map((d) => d.id)).toContain(id);

    const one = await getOne(id);
    expect(one.status).toBe(200);
    expect(data<PayrollReportDefinitionDto>(one).name.en).toBe('Branch cost');
  });

  it('finds it by name, and does not find a name nobody used', async () => {
    const hit = await list('?page=1&pageSize=50&search=Branch');
    expect(rows<PayrollReportDefinitionDto>(hit).map((d) => d.id)).toContain(id);
    const miss = await list('?page=1&pageSize=50&search=nothingnamedthis');
    expect(rows<PayrollReportDefinitionDto>(miss)).toEqual([]);
  });

  it('replaces the whole definition at the version the editor read', async () => {
    const res = await update(
      id,
      definition({
        name: { ar: 'تكلفة الفروع', en: 'Branch cost (edited)' },
        dimensions: ['branch'],
        measures: ['amountMinor'],
        version,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<PayrollReportDefinitionDto>(res);
    expect(dto.name.en).toBe('Branch cost (edited)');
    expect(dto.dimensions).toEqual(['branch']);
    // The edit replaced the whole body, so the column the create carried is gone rather than merged.
    expect(dto.columns).toEqual([]);
    expect(dto.version).toBeGreaterThan(version);
    version = dto.version;
  });

  /**
   * D-B1-5, corrected — the property the whole decision turned on.
   *
   * `BaseRepository.updateById` matches `__v` INSIDE the update, so a second editor sending the
   * version they read before somebody else's edit is refused rather than silently overwriting it.
   */
  it('refuses an edit that names a version somebody has already replaced (409)', async () => {
    const stale = await update(id, definition({ name: { ar: 'قديم', en: 'Stale' }, version: version - 1 }));
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(errorOf(stale).code).toBe(ErrorCodes.STALE_DOCUMENT);

    // And it wrote NOTHING — the refusal is not a half-applied edit.
    const reread = await getOne(id);
    expect(data<PayrollReportDefinitionDto>(reread).name.en).toBe('Branch cost (edited)');
    expect(data<PayrollReportDefinitionDto>(reread).version).toBe(version);
  });

  it('retires it, after which it is neither readable nor listed', async () => {
    const deleted = await remove(id);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);

    expect((await getOne(id)).status).toBe(404);
    const listed = await list('?page=1&pageSize=50');
    expect(rows<PayrollReportDefinitionDto>(listed).map((d) => d.id)).not.toContain(id);
  });

  it('404s for a definition that never existed', async () => {
    expect((await getOne('000000000000000000000009')).status).toBe(404);
  });
});

// ── What the boundary refuses ───────────────────────────────────────────────

describe('report definitions: what never becomes a stored question', () => {
  const refused = async (over: Record<string, unknown>): Promise<number> =>
    (await create(definition(over))).status;

  it('refuses a dimension selected twice, and a sort key naming nothing selected', async () => {
    expect(await refused({ dimensions: ['branch', 'branch'] })).toBe(400);
    expect(await refused({ sort: { key: 'costCenter', direction: 'asc' } })).toBe(400);
  });

  it('refuses "equals" carrying more than one value', async () => {
    expect(await refused({ filters: [{ field: 'kind', op: 'eq', values: ['earning', 'deduction'] }] })).toBe(400);
  });

  it('refuses a value that does not fit the field it filters', async () => {
    // Schema-valid strings, meaningless for their field: a branch is an id, a kind is a vocabulary.
    expect(await refused({ filters: [{ field: 'branch', op: 'eq', values: ['earning'] }] })).toBe(400);
    expect(await refused({ filters: [{ field: 'kind', op: 'eq', values: [BRANCH_A] }] })).toBe(400);
    // …and `none` is a real group everywhere except on the currency every row carries.
    expect(await refused({ filters: [{ field: 'currency', op: 'eq', values: ['none'] }] })).toBe(400);
  });

  it('refuses a source that is not the one source, and an unknown dimension', async () => {
    expect(await refused({ sourceId: 'employees' })).toBe(400);
    expect(await refused({ dimensions: ['department'] })).toBe(400);
  });

  /** The catalog check the schema cannot make: a column may only name what a ROW has. */
  it('refuses a calculated column naming a field no row carries', async () => {
    const res = await create(
      definition({
        columns: [
          {
            key: 'bogus',
            expression: {
              kind: 'binary',
              op: 'divide',
              left: { kind: 'field', path: 'netPay' },
              right: { kind: 'literal', value: 2 },
            },
          },
        ],
      }),
    );
    // 400 like every other refused body — but the REASON is the catalog, which the message names,
    // so a schema rejection arriving instead would not pass this test.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(errorOf(res).message).toContain('cannot be computed');
  });

  it('refuses a filter list longer than the limit', async () => {
    const many = Array.from({ length: 11 }, () => ({ field: 'kind', op: 'eq', values: ['earning'] }));
    expect(await refused({ filters: many })).toBe(400);
  });
});

// ── Permissions ─────────────────────────────────────────────────────────────

describe('report definitions: who may do what', () => {
  let id = '';

  beforeAll(async () => {
    const res = await create(definition({ name: { ar: 'صلاحيات', en: 'Permissions fixture' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    id = data<PayrollReportDefinitionDto>(res).id;
  });

  it('refuses an unauthenticated caller everywhere', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).post(BASE).send(definition())).status).toBe(401);
    expect((await request(app).post(`${BASE}/preview`).send({ runId, definition: definition() })).status).toBe(401);
  });

  it('refuses a caller holding none of the keys', async () => {
    expect((await list('', outsiderToken)).status).toBe(403);
    expect((await create(definition(), outsiderToken)).status).toBe(403);
    expect((await preview({ runId, definition: definition() }, outsiderToken)).status).toBe(403);
  });

  it('separates seeing a definition from authoring one', async () => {
    // `payrollReport.view` alone reads the catalogue…
    expect((await list('?page=1&pageSize=10', readerToken)).status).toBe(200);
    expect((await getOne(id, readerToken)).status).toBe(200);
    // …and writes nothing.
    expect((await create(definition(), readerToken)).status).toBe(403);
    expect((await update(id, definition({ version: 0 }), readerToken)).status).toBe(403);
    expect((await remove(id, readerToken)).status).toBe(403);
  });

  /**
   * D-B1-1 — the AND, from both sides.
   *
   * Each caller below holds one half of what an execution needs and is refused, while the builder
   * holding both succeeds on the same request. Without the pair of negatives, a 403 could be
   * arriving from an unrelated guard; without the positive, the request itself might simply be bad.
   */
  it('refuses to RUN a report for a caller who cannot see compensation', async () => {
    expect((await list('?page=1&pageSize=10', editorToken)).status).toBe(200);
    expect((await create(definition(), editorToken)).status).toBe(201);

    expect((await preview({ runId, definition: definition() }, editorToken)).status).toBe(403);
    expect((await runStored(id, { runId }, editorToken)).status).toBe(403);
  });

  it('refuses to RUN a report for a caller who cannot use the builder', async () => {
    expect((await preview({ runId, definition: definition() }, payrollOnlyToken)).status).toBe(403);
    expect((await runStored(id, { runId }, payrollOnlyToken)).status).toBe(403);
  });

  it('and runs it for the caller holding both', async () => {
    expect((await preview({ runId, definition: definition() })).status).toBe(200);
    expect((await runStored(id, { runId })).status).toBe(200);
  });
});

// ── Execution ───────────────────────────────────────────────────────────────

describe('running a report', () => {
  it('previews an unsaved definition, and stores nothing while doing it', async () => {
    const before = rows<PayrollReportDefinitionDto>(await list('?page=1&pageSize=100')).length;

    const res = await preview({
      runId,
      definition: definition({
        dimensions: ['branch'],
        columns: [
          {
            key: 'perLine',
            expression: {
              kind: 'binary',
              op: 'divide',
              left: { kind: 'field', path: 'amountMinor' },
              right: { kind: 'field', path: 'lineCount' },
            },
          },
        ],
      }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = data<PayrollReportResultDto>(res);

    expect(result.runId).toBe(runId);
    expect(result.period).toBe(PERIOD);
    expect(result.dimensions).toEqual(['branch']);
    expect(result.columns).toEqual(['perLine']);
    expect(result.rows.length).toBeGreaterThan(0);

    for (const row of result.rows) {
      // Currency leads every key and is never selectable — there is no exchange rate here.
      expect(row.currency).toBe('EGP');
      expect(row.cells.map((cell) => cell.dimension)).toEqual(['branch']);
      expect(row.measures['amountMinor']).toBeGreaterThan(0);
      expect(row.measures['lineCount']).toBeGreaterThan(0);
      // The column is the engine's arithmetic, over this row's own measures and nothing wider.
      // Both operands are the row's own minor-unit figures, so the quotient is too.
      expect(row.calculated['perLine']).toBeCloseTo(
        (row.measures['amountMinor'] ?? 0) / (row.measures['lineCount'] ?? 1),
        6,
      );
    }

    const after = rows<PayrollReportDefinitionDto>(await list('?page=1&pageSize=100')).length;
    expect(after, 'a preview must write no definition').toBe(before);
  });

  it('answers a stored definition with exactly what previewing it answers', async () => {
    const body = definition({ name: { ar: 'مخزّن', en: 'Stored' }, dimensions: ['branch'] });
    const saved = await create(body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);

    const stored = await runStored(data<PayrollReportDefinitionDto>(saved).id, { runId });
    const unsaved = await preview({ runId, definition: body });
    expect(stored.status).toBe(200);
    expect(data<PayrollReportResultDto>(stored).rows).toEqual(data<PayrollReportResultDto>(unsaved).rows);
  });

  it('reports a group nobody was placed in as a real group, not a gap', async () => {
    // No cost-centre membership exists in this suite, so every line belongs to the null group —
    // which D-REPORT-7 shows rather than hides.
    const res = await preview({ runId, definition: definition({ dimensions: ['costCenter'] }) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = data<PayrollReportResultDto>(res);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      const cell = row.cells.find((c) => c.dimension === 'costCenter');
      expect(cell?.id).toBeNull();
      expect(cell?.label).toBeNull();
    }
  });

  it('sorts by a measure, and by a calculated column the database could not have ordered', async () => {
    const descending = await preview({
      runId,
      definition: definition({
        dimensions: ['branch'],
        sort: { key: 'amountMinor', direction: 'desc' },
      }),
    });
    const amounts = data<PayrollReportResultDto>(descending).rows.map((r) => r.measures['amountMinor'] ?? 0);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);

    const byColumn = await preview({
      runId,
      definition: definition({
        dimensions: ['branch'],
        sort: { key: 'perLine', direction: 'asc' },
        columns: [
          {
            key: 'perLine',
            expression: {
              kind: 'binary',
              op: 'divide',
              left: { kind: 'field', path: 'amountMinor' },
              right: { kind: 'field', path: 'lineCount' },
            },
          },
        ],
      }),
    });
    expect(byColumn.status, JSON.stringify(byColumn.body)).toBe(200);
    const computed = data<PayrollReportResultDto>(byColumn).rows.map((r) => r.calculated['perLine'] ?? 0);
    expect([...computed].sort((a, b) => a - b)).toEqual(computed);
  });

  it('answers a run that has issued nothing with no rows, which is a true answer', async () => {
    const created = await request(app)
      .post('/api/v1/hr/payroll/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2025-09' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await preview({ runId: data<PayrollRunDto>(created).id, definition: definition() });
    expect(res.status).toBe(200);
    expect(data<PayrollReportResultDto>(res).rows).toEqual([]);
  }, 240_000);

  it('404s for a run that does not exist', async () => {
    const res = await preview({ runId: '000000000000000000000009', definition: definition() });
    expect(res.status).toBe(404);
  });
});

// ── Scope ───────────────────────────────────────────────────────────────────

describe('the same report, read at different scopes', () => {
  /**
   * The B1 premise, exercised: one definition, two readers, two answers — with no ownership model
   * and nothing in the definition naming a branch.
   */
  it('narrows a branch-scoped reader to their own branch', async () => {
    const body = definition({ dimensions: ['branch'] });

    const wide = data<PayrollReportResultDto>(await preview({ runId, definition: body }));
    const narrow = data<PayrollReportResultDto>(await preview({ runId, definition: body }, branchToken));

    expect(branchIdsIn(wide).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    expect(branchIdsIn(narrow)).toEqual([BRANCH_A]);
    // Not merely fewer rows — strictly less money, which is what "cannot see branch B" means.
    expect(totalOf(narrow)).toBeGreaterThan(0);
    expect(totalOf(narrow)).toBeLessThan(totalOf(wide));
  });

  it('narrows a STORED definition the same way — the scope is the caller’s, not the definition’s', async () => {
    const saved = await create(definition({ name: { ar: 'مشترك', en: 'Shared' }, dimensions: ['branch'] }));
    const id = data<PayrollReportDefinitionDto>(saved).id;

    const wide = data<PayrollReportResultDto>(await runStored(id, { runId }));
    const narrow = data<PayrollReportResultDto>(await runStored(id, { runId }, branchToken));
    expect(branchIdsIn(wide).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    expect(branchIdsIn(narrow)).toEqual([BRANCH_A]);
  });

  /**
   * THE PROPERTY THE PIPELINE'S SHAPE GUARANTEES.
   *
   * A filter is an additional `$match` after the scoped one, and a `$match` after a `$match` can
   * only narrow what survived the first. So a scoped reader naming the branch they cannot see gets
   * NOTHING — not that branch's money, and not an error that would tell them it exists.
   */
  it('never lets a filter widen what the scope allowed', async () => {
    const other = await preview(
      { runId, definition: definition({ filters: [{ field: 'branch', op: 'eq', values: [BRANCH_B] }] }) },
      branchToken,
    );
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(data<PayrollReportResultDto>(other).rows).toEqual([]);

    // Asking for BOTH branches is still answered with one.
    const both = await preview(
      { runId, definition: definition({ filters: [{ field: 'branch', op: 'in', values: [BRANCH_A, BRANCH_B] }] }) },
      branchToken,
    );
    expect(branchIdsIn(data<PayrollReportResultDto>(both))).toEqual([BRANCH_A]);

    // And excluding their own branch empties the report rather than revealing the rest.
    const excluded = await preview(
      { runId, definition: definition({ filters: [{ field: 'branch', op: 'ne', values: [BRANCH_A] }] }) },
      branchToken,
    );
    expect(data<PayrollReportResultDto>(excluded).rows).toEqual([]);
  });

  it('filters within the scope exactly as an unscoped caller would', async () => {
    const earningsOnly = await preview({
      runId,
      definition: definition({
        dimensions: ['kind'],
        filters: [{ field: 'kind', op: 'eq', values: ['earning'] }],
      }),
    });
    expect(earningsOnly.status, JSON.stringify(earningsOnly.body)).toBe(200);
    const result = data<PayrollReportResultDto>(earningsOnly);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.cells.find((cell) => cell.dimension === 'kind')?.id).toBe('earning');
    }
  });

  /**
   * ⚠️ A CHARACTERIZATION TEST, NOT AN ENDORSEMENT — finding F-B1-1.
   *
   * The payslip collection carries `branchId` and `costCenterId` and NO department field
   * (`payslip.repository.ts` declares `branchField` only). `BaseRepository.scopeFilter` answers a
   * scope whose field is undeclared with an EMPTY filter, so a `department`-scoped grant on
   * `employee.viewCompensation` narrows a payslip read by nothing at all — it reads exactly as
   * `organization` does.
   *
   * That is inherited rather than introduced here: the payslip list, the reconciliation, the P-HR-14
   * cost breakdown and the P-HR-25 report have all behaved this way since PY-7, and B1 runs the same
   * pipeline. It is asserted rather than hidden because the alternative — a suite that quietly omits
   * the department case — is how a reader concludes the scope ladder is complete when it is not.
   *
   * The owner's decision is pending; if department scope is later made to narrow, THIS TEST MUST
   * FAIL, which is the point of writing it down.
   */
  it('does NOT narrow a department-scoped reader — the payslip has no department axis (F-B1-1)', async () => {
    const body = definition({ dimensions: ['branch'] });
    const wide = data<PayrollReportResultDto>(await preview({ runId, definition: body }));
    const departmentScoped = data<PayrollReportResultDto>(
      await preview({ runId, definition: body }, departmentToken),
    );

    // Department A lives in branch A, yet the reader is answered with branch B's money as well.
    expect(branchIdsIn(departmentScoped).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    expect(totalOf(departmentScoped)).toBe(totalOf(wide));
  });
});
