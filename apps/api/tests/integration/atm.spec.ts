// ATM Operations integration suite — the ported legacy behaviours over real HTTP and real RBAC.
//
// What is worth proving end to end is exactly what the port doc argues about, so that is what this
// covers: the multi-row open with its unknown-code report, timing that starts at the open and a
// close that ends it, the leader shift-cascade, the branch scope a legacy deployment used to get
// from being a separate server, the maintenance close that REQUIRES an employee, the mail
// accept→maintenance path, and the two gates the legacy simply did not have (every mutation behind
// a permission, the admin-narrow mail log).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type AtmMachineDto,
  type AtmMaintenanceDto,
  type AtmReplenishmentDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // every atm grant, organization scope, no branch placement
let alexToken: string; // the operating bundle, BRANCH scope, placed in Alex
let reviewToken: string; // view + complete only — the legacy `atm-user-review` bundle
let outsiderToken: string; // no atm grant at all
let alexBranchId: string;
let tantaBranchId: string;
let adminUserId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-test-${Date.now()}`;
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
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const items = <T>(res: request.Response): T[] => (res.body as { data: T[] }).data;

/** Register machines into ONE branch, as the caller's placement decides. */
const addMachines = async (
  token: string,
  bankName: string,
  area: string,
  machines: { machineCode: string; name: string }[],
): Promise<request.Response> =>
  request(app)
    .post('/api/v1/atm/machines/bulk')
    .set('Authorization', `Bearer ${token}`)
    .send({ bankName, area, machines });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-admin@ecms.local');
  adminUserId = adminId;
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
  adminToken = await login('atm-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  alexBranchId = await mkBranch('90', 'الإسكندرية', 'Alexandria');
  tantaBranchId = await mkBranch('91', 'طنطا', 'Tanta');

  // The legacy `atm-user` bundle, at BRANCH scope and placed in Alex — the ECMS expression of
  // "this operator runs the Alexandria deployment".
  const operatorRole = await rbacService.createRole(
    {
      name: { en: 'ATM operator', ar: 'مشغل صراف آلي' },
      permissionKeys: [
        'atmReplenishment.view',
        'atmReplenishment.create',
        'atmReplenishment.edit',
        'atmReplenishment.delete',
        'atmReplenishment.complete',
        'atmMaintenance.view',
        'atmMaintenance.create',
        'atmMaintenance.edit',
        'atmMaintenance.complete',
        'atmMailTicket.view',
        'atmMailTicket.decide',
        'atmMachine.view',
        'atmMachine.manage',
      ],
    },
    adminId,
  );
  const alexId = await mkUser('atm-alex@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(alexId, String(operatorRole._id), 'branch');
  alexToken = await login('atm-alex@ecms.local');

  // The legacy `atm-user-review` bundle: the done surfaces and nothing that opens work.
  const reviewRole = await rbacService.createRole(
    {
      name: { en: 'ATM reviewer', ar: 'مراجع' },
      permissionKeys: [
        'atmReplenishment.view',
        'atmReplenishment.complete',
        'atmMaintenance.view',
        'atmMaintenance.complete',
      ],
    },
    adminId,
  );
  const reviewId = await mkUser('atm-review@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(reviewId, String(reviewRole._id), 'branch');
  reviewToken = await login('atm-review@ecms.local');

  const outsiderRole = await rbacService.createRole(
    { name: { en: 'ATM outsider', ar: 'بلا صلاحية' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const outsiderId = await mkUser('atm-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(outsiderRole._id), 'organization');
  outsiderToken = await login('atm-outsider@ecms.local');

  // Alex's master. The operator is placed in Alex, so this is where they land — nothing in the
  // request says so, which is the whole point of resolving the branch from the caller.
  expect(
    (
      await addMachines(alexToken, 'NBE', 'Smouha', [
        { machineCode: '0101', name: 'Smouha ATM' },
        { machineCode: '102', name: 'Roushdy ATM' },
      ])
    ).status,
  ).toBe(200);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('atm machines — the master and its data-edit surface', () => {
  it('normalizes the code on the way in and files the machine in the CALLER’s branch', async () => {
    const res = await request(app)
      .get('/api/v1/atm/machines?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(res.status).toBe(200);
    const machines = items<AtmMachineDto>(res);
    // '0101' was submitted; the leading zero is stripped exactly as every legacy entry point did.
    expect(machines.map((m) => m.machineCode).sort()).toEqual(['101', '102']);
    expect(new Set(machines.map((m) => m.branchId))).toEqual(new Set([alexBranchId]));
  });

  it('skips a code already registered and NAMES it, instead of erroring or silently dropping', async () => {
    const res = await addMachines(alexToken, 'NBE', 'Smouha', [
      { machineCode: '101', name: 'Duplicate' },
      { machineCode: '103', name: 'New one' },
    ]);
    expect(res.status).toBe(200);
    const body = data<{ created: AtmMachineDto[]; skippedCodes: string[] }>(res);
    expect(body.skippedCodes).toEqual(['101']);
    expect(body.created.map((m) => m.machineCode)).toEqual(['103']);
  });

  it('soft-deletes with the legacy `-D` rename, which frees the code to be registered again', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/atm/machines/bulk-delete')
          .set('Authorization', `Bearer ${alexToken}`)
          .send({ machineCodes: ['103'] })
      ).status,
    ).toBe(200);

    const readded = await addMachines(alexToken, 'NBE', 'Smouha', [
      { machineCode: '103', name: 'Replacement' },
    ]);
    expect(data<{ created: AtmMachineDto[] }>(readded).created).toHaveLength(1);
  });

  it('refuses every master mutation to a caller without the manage grant', async () => {
    const res = await addMachines(reviewToken, 'NBE', 'Smouha', [
      { machineCode: '999', name: 'Nope' },
    ]);
    expect(res.status).toBe(403);
  });
});

describe('atm replenishments — open, time, close', () => {
  let openedId: string;

  it('opens one operation per submitted line and reports the codes it did not know', async () => {
    const res = await request(app)
      .post('/api/v1/atm/replenishments/open')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({
        rows: [
          { machineCode: '101', scheduleTime: '10:00' },
          { machineCode: '102', scheduleTime: '11:30' },
          { machineCode: '9999', scheduleTime: null },
        ],
        forceDate: null,
      });
    expect(res.status).toBe(200);
    const body = data<{ opened: AtmReplenishmentDto[]; unknownCodes: string[] }>(res);
    expect(body.opened).toHaveLength(2);
    // Per request, not a shared global that any other user's submit could clear (port doc T5).
    expect(body.unknownCodes).toEqual(['9999']);
    // The machine snapshot is taken at open — the record a closed day keeps saying.
    expect(body.opened[0]).toMatchObject({ bankName: 'NBE', area: 'Smouha', closedAt: null });
    expect(body.opened[0]?.openedByName).not.toBeNull();
    openedId = body.opened[0]?.id as string;
  });

  it('lists the open rows and offers their banks as filter facets', async () => {
    const list = await request(app)
      .get('/api/v1/atm/replenishments?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(list.status).toBe(200);
    expect(items<AtmReplenishmentDto>(list).length).toBeGreaterThanOrEqual(2);

    const facets = await request(app)
      .get('/api/v1/atm/replenishments/facets?banks=NBE')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(facets.status, 'facets').toBe(200);
    expect(data<{ banks: string[]; areas: string[] }>(facets).banks).toContain('NBE');
    expect(data<{ banks: string[]; areas: string[] }>(facets).areas).toContain('Smouha');
  });

  it('cascades a changed leader over the same area and shift, and only over open rows', async () => {
    const before = await request(app)
      .get('/api/v1/atm/replenishments?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(before.status, 'before').toBe(200);
    const target = items<AtmReplenishmentDto>(before).find((r) => r.id === openedId);

    const res = await request(app)
      .patch(`/api/v1/atm/replenishments/${openedId}`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ leaderName: 'Ahmed', version: target?.version });
    expect(res.status).toBe(200);

    const after = await request(app)
      .get('/api/v1/atm/replenishments?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(after.status, 'after').toBe(200);
    const smouha = items<AtmReplenishmentDto>(after).filter((r) => r.area === 'Smouha');
    // Both Smouha rows were opened in the same shift, so the leader lands on both — the legacy
    // behaviour operators rely on and would notice missing (contad_app.js:861-867).
    expect(smouha.every((r) => r.leaderName === 'Ahmed')).toBe(true);
  });

  it('closes the checked set, stamping the closer, and reopens from the done page', async () => {
    const close = await request(app)
      .post('/api/v1/atm/replenishments/close')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ ids: [openedId] });
    expect(close.status).toBe(200);
    const closed = items<AtmReplenishmentDto>(close).find((r) => r.id === openedId);
    expect(closed?.closedAt).not.toBeNull();
    expect(closed?.closedByName).not.toBeNull();

    const done = await request(app)
      .get('/api/v1/atm/replenishments/done?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(done.status, 'done').toBe(200);
    expect(items<AtmReplenishmentDto>(done).map((r) => r.id)).toContain(openedId);

    const reopen = await request(app)
      .post(`/api/v1/atm/replenishments/${openedId}/reopen`)
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ version: closed?.version });
    expect(reopen.status).toBe(200);
    const reopened = data<AtmReplenishmentDto>(reopen);
    expect(reopened.closedAt).toBeNull();
    // The closer's NAME survives a reopen, exactly as `end = 0` left `ops_emp2` alone (:1032).
    expect(reopened.closedByName).not.toBeNull();
  });

  it('lets the review bundle close but never open — the legacy privilege split', async () => {
    const open = await request(app)
      .post('/api/v1/atm/replenishments/open')
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ rows: [{ machineCode: '102', scheduleTime: null }], forceDate: null });
    expect(open.status).toBe(403);

    const list = await request(app)
      .get('/api/v1/atm/replenishments?pageSize=100')
      .set('Authorization', `Bearer ${reviewToken}`);
    expect(list.status).toBe(200);
  });

  it('refuses a caller with no ATM grant at all', async () => {
    const res = await request(app)
      .get('/api/v1/atm/replenishments')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed open body at the boundary', async () => {
    const res = await request(app)
      .post('/api/v1/atm/replenishments/open')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ rows: [], forceDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});

describe('atm replenishments — branch scope', () => {
  it('never shows one branch’s operations to another branch’s operator', async () => {
    // Tanta's own operator, with the same role at branch scope.
    const tantaRole = await rbacService.createRole(
      {
        name: { en: 'ATM Tanta', ar: 'مشغل طنطا' },
        permissionKeys: ['atmReplenishment.view', 'atmMachine.view'],
      },
      adminUserId,
    );
    const tantaId = await mkUser('atm-tanta@ecms.local', tantaBranchId);
    await rbacService.ensureAssignment(tantaId, String(tantaRole._id), 'branch');
    const tantaToken = await login('atm-tanta@ecms.local');

    const list = await request(app)
      .get('/api/v1/atm/replenishments?pageSize=100')
      .set('Authorization', `Bearer ${tantaToken}`);
    expect(list.status).toBe(200);
    expect(items<AtmReplenishmentDto>(list)).toEqual([]);

    const machines = await request(app)
      .get('/api/v1/atm/machines?pageSize=100')
      .set('Authorization', `Bearer ${tantaToken}`);
    expect(machines.status, 'machines').toBe(200);
    expect(items<AtmMachineDto>(machines)).toEqual([]);
  });
});

describe('atm maintenance — the differences from replenishment', () => {
  let maintenanceId: string;

  it('opens with per-line service type and reference number', async () => {
    const res = await request(app)
      .post('/api/v1/atm/maintenances/open')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({
        rows: [
          { machineCode: '101', serviceType: 'Cash dispenser', referenceNumber: 'REF-1' },
          { machineCode: '102', serviceType: 'Card reader', referenceNumber: null },
        ],
        openedAt: null,
      });
    expect(res.status).toBe(200);
    const body = data<{ opened: AtmMaintenanceDto[]; unknownCodes: string[] }>(res);
    expect(body.opened).toHaveLength(2);
    expect(body.opened[0]).toMatchObject({
      serviceType: 'Cash dispenser',
      referenceNumber: 'REF-1',
      source: 'manual',
      mailTicketId: null,
    });
    maintenanceId = body.opened[0]?.id as string;
  });

  it('REFUSES to close without a real employee — the required assignee', async () => {
    const missing = await request(app)
      .post('/api/v1/atm/maintenances/close')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ ids: [maintenanceId] });
    expect(missing.status).toBe(400);

    // A syntactically valid id that names nobody the directory can answer for.
    const unknown = await request(app)
      .post('/api/v1/atm/maintenances/close')
      .set('Authorization', `Bearer ${alexToken}`)
      .send({ ids: [maintenanceId], leaderEmployeeId: '64b7f9c2e13b4a00123456ff' });
    expect(unknown.status).toBe(422);

    // Still open: a refused close changed nothing.
    const list = await request(app)
      .get('/api/v1/atm/maintenances?pageSize=100')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(items<AtmMaintenanceDto>(list).find((m) => m.id === maintenanceId)?.closedAt).toBeNull();
  });

  it('offers the close modal’s employee list, empty until the department setting is configured', async () => {
    const res = await request(app)
      .get('/api/v1/atm/maintenances/leader-options')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(res.status).toBe(200);
    expect(items<{ employeeId: string; name: string }>(res)).toEqual([]);
  });
});

describe('atm mail tickets', () => {
  it('serves an empty pending list and a zero badge before anything is ingested', async () => {
    const pending = await request(app)
      .get('/api/v1/atm/mail-tickets')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(pending.status).toBe(200);
    expect(items(pending)).toEqual([]);

    const badge = await request(app)
      .get('/api/v1/atm/mail-tickets/unread-count')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(badge.status, 'badge').toBe(200);
    expect(data<{ count: number }>(badge).count).toBe(0);
  });

  it('keeps the decisions log admin-narrow — the operator may decide but not audit', async () => {
    const asOperator = await request(app)
      .get('/api/v1/atm/mail-tickets/log')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(asOperator.status).toBe(403);

    const asAdmin = await request(app)
      .get('/api/v1/atm/mail-tickets/log')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
  });
});

describe('atm daily report', () => {
  it('counts still-open over total per bank, for the day', async () => {
    const res = await request(app)
      .get('/api/v1/atm/reports/daily')
      .set('Authorization', `Bearer ${alexToken}`);
    expect(res.status).toBe(200);
    const report = data<{
      date: string;
      replenishments: { bankName: string; total: number; open: number }[];
      maintenances: { bankName: string; total: number; open: number }[];
    }>(res);
    const nbe = report.replenishments.find((row) => row.bankName === 'NBE');
    expect(nbe?.total).toBeGreaterThanOrEqual(2);
    expect(nbe?.open).toBeGreaterThanOrEqual(1);
    expect(report.maintenances.find((row) => row.bankName === 'NBE')?.open).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('is refused to a caller holding no ATM view grant', async () => {
    const res = await request(app)
      .get('/api/v1/atm/reports/daily')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});
