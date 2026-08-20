// بوابة العملاء, end to end — the half that needs a real database.
//
// `portal-surface.spec.ts` asserts the SHAPE of this surface (no write route, one producer of the
// confinement type, no leaked field names) by reading its own source. What only a running server
// can answer is the part that actually matters:
//
//   · customer A never sees customer B's metal, through any of the eleven reads;
//   · a customer cannot write anything, anywhere in ECMS — including the platform endpoints that
//     are deliberately open to every authenticated employee;
//   · deactivating a customer, or re-pointing an account, takes effect on the NEXT request;
//   · drafts do not reach a customer at all.
//
// The two customers here hold metal in the SAME drawer on purpose. A per-drawer aggregation that
// forgot its company filter would pass every other test in this file and fail that one.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type GoldCompanyDto,
  type GoldDrawerDto,
  type GoldPortalAccountCreatedDto,
  type GoldPortalBarDto,
  type GoldPortalDrawerDto,
  type GoldPortalOverviewDto,
  type GoldPortalReceiptDto,
  type GoldReceivingReceiptDto,
  type GoldRepresentativeDto,
  type GoldVaultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { goldPermissions } from '../../src/modules/gold/gold.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const CUSTOMER_PASSWORD = 'Cust0mer#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchAId: string;

/** The two customers, their logins, and the drawer they share. */
let alphaId: string;
let betaId: string;
let alphaToken: string;
let betaToken: string;
let sharedDrawerId: string;
let alphaSerials: string[] = [];

let serial = 5000;
const nextSerial = (): string => `PB-${String(serial++)}`;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-gold-portal-test-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

type Body = Record<string, unknown>;
const post = (path: string, token: string, body: Body = {}): request.Test =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const patch = (path: string, token: string, body: Body = {}): request.Test =>
  request(app).patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const del = (path: string, token: string): request.Test =>
  request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
const get = (path: string, token: string): request.Test =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

const login = async (identifier: string, password: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password });
  expect(res.status, `login ${identifier}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

/** Create a customer login through the staff screen, then activate it as the customer would. */
const mkPortalAccount = async (companyId: string, username: string): Promise<string> => {
  const created = await post('/gold/portal-accounts', adminToken, {
    companyId,
    firstName: { ar: 'مندوب', en: 'Rep' },
    lastName: { ar: username, en: username },
    username,
  });
  expect(created.status, `create ${username}`).toBe(201);
  const account = data<GoldPortalAccountCreatedDto>(created);

  const activated = await request(app)
    .post('/api/v1/auth/activate')
    .send({ token: account.activationToken, password: CUSTOMER_PASSWORD });
  expect(activated.status, `activate ${username}`).toBe(204);
  return login(username, CUSTOMER_PASSWORD);
};

/** A confirmed receiving receipt putting `count` bars into the shared drawer for one owner. */
const depositInto = async (
  companyId: string,
  representativeId: string,
  vaultId: string,
  drawerId: string,
  count: number,
): Promise<string[]> => {
  const serials = Array.from({ length: count }, () => nextSerial());
  const draft = await post('/gold/receiving', adminToken, {
    deliveredByUs: false,
    companyId,
    representativeId,
    lines: serials.map((serialNumber) => ({
      serialNumber,
      metalType: 'gold',
      weight: 1000,
      purity: '999.9',
      vaultId,
      drawerId,
    })),
  });
  expect(draft.status).toBe(201);
  const receipt = data<GoldReceivingReceiptDto>(draft);
  const confirmed = await post(`/gold/receiving/${receipt.id}/confirm`, adminToken, {
    version: receipt.version,
  });
  expect(confirmed.status).toBe(200);
  return serials;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...goldPermissions].map((p) => p.key),
  );

  const bootstrap = await userService.create(
    {
      email: 'portal-bootstrap@ecms.local',
      firstName: { ar: 'م', en: 'B' },
      lastName: { ar: 'م', en: 'B' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const bootstrapId = String(bootstrap.user._id);
  await userService.setPassword(bootstrapId, PASSWORD, 'passwordReset');
  await userService.forceActivate(bootstrapId);
  await rbacService.ensureAssignment(bootstrapId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    userId: bootstrapId,
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

  const bootstrapToken = await login('portal-bootstrap@ecms.local', PASSWORD);
  const branch = await post('/platform/branches', bootstrapToken, {
    code: '90',
    name: { ar: 'فرع البوابة', en: 'Portal Branch' },
  });
  expect(branch.status).toBe(201);
  branchAId = data<{ id: string }>(branch).id;

  // The vault operator files from a branch, as every gold document is filed.
  const operator = await userService.create(
    {
      email: 'portal-admin@ecms.local',
      firstName: { ar: 'م', en: 'A' },
      lastName: { ar: 'م', en: 'A' },
      locale: 'en',
      organization: {
        branchId: branchAId,
        departmentId: null,
        sectionId: null,
        jobTitleId: null,
      },
    },
    null,
  );
  const operatorId = String(operator.user._id);
  await userService.setPassword(operatorId, PASSWORD, 'passwordReset');
  await userService.forceActivate(operatorId);
  await rbacService.ensureAssignment(operatorId, String(superAdmin._id), 'organization');
  adminToken = await login('portal-admin@ecms.local', PASSWORD);

  // Two customers, both funds so both report tabs have something to say.
  const alpha = await post('/gold/companies', adminToken, { name: 'صندوق ألفا', type: 'fund' });
  const beta = await post('/gold/companies', adminToken, { name: 'صندوق بيتا', type: 'fund' });
  expect(alpha.status).toBe(201);
  expect(beta.status).toBe(201);
  alphaId = data<GoldCompanyDto>(alpha).id;
  betaId = data<GoldCompanyDto>(beta).id;

  const alphaRep = await post('/gold/representatives', adminToken, {
    companyId: alphaId,
    fullName: 'مندوب ألفا',
    nationalId: '29001010900001',
  });
  const betaRep = await post('/gold/representatives', adminToken, {
    companyId: betaId,
    fullName: 'مندوب بيتا',
    nationalId: '29001010900002',
  });
  expect(alphaRep.status).toBe(201);
  expect(betaRep.status).toBe(201);

  const vault = await post('/gold/vaults', adminToken, { name: 'خزينة البوابة' });
  expect(vault.status).toBe(201);
  const vaultId = data<GoldVaultDto>(vault).id;
  const layout = await post(`/gold/vaults/${vaultId}/generate-layout`, adminToken, {
    rows: 2,
    cols: 2,
    drawerWeightLimit: 0,
  });
  expect(layout.status).toBe(200);
  const drawers = await get(`/gold/vaults/${vaultId}/drawers`, adminToken);
  expect(drawers.status).toBe(200);
  const firstDrawer = data<GoldDrawerDto[]>(drawers)[0];
  expect(firstDrawer).toBeDefined();
  sharedDrawerId = String(firstDrawer?.id);

  // BOTH customers' metal in the SAME drawer — the case a missing company filter would pass.
  alphaSerials = await depositInto(
    alphaId,
    data<GoldRepresentativeDto>(alphaRep).id,
    vaultId,
    sharedDrawerId,
    3,
  );
  await depositInto(betaId, data<GoldRepresentativeDto>(betaRep).id, vaultId, sharedDrawerId, 5);

  // A DRAFT for alpha, never confirmed — it must not reach the customer at all.
  const draft = await post('/gold/receiving', adminToken, {
    deliveredByUs: false,
    companyId: alphaId,
    lines: [],
  });
  expect(draft.status).toBe(201);

  alphaToken = await mkPortalAccount(alphaId, 'portal.alpha');
  betaToken = await mkPortalAccount(betaId, 'portal.beta');
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a customer sees their own metal, and only their own', () => {
  it('lists their bars and none of the other customer’s', async () => {
    const mine = await get('/gold/portal/bars?pageSize=100', alphaToken);
    expect(mine.status).toBe(200);
    const serials = data<GoldPortalBarDto[]>(mine).map((b) => b.serialNumber);
    expect(serials.sort()).toEqual([...alphaSerials].sort());

    const theirs = await get('/gold/portal/bars?pageSize=100', betaToken);
    expect(theirs.status).toBe(200);
    for (const bar of data<GoldPortalBarDto[]>(theirs)) {
      expect(alphaSerials).not.toContain(bar.serialNumber);
    }
  });

  /**
   * The load-bearing one. Both customers have bars in the SAME drawer, so a per-drawer aggregation
   * that lost its company filter would report eight bars to each of them instead of three and five.
   */
  it('counts a SHARED drawer as their own share of it', async () => {
    const mine = await get('/gold/portal/drawers', alphaToken);
    const theirs = await get('/gold/portal/drawers', betaToken);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);

    const alphaRow = data<GoldPortalDrawerDto[]>(mine).find((d) => d.drawerId === sharedDrawerId);
    const betaRow = data<GoldPortalDrawerDto[]>(theirs).find((d) => d.drawerId === sharedDrawerId);
    expect(alphaRow?.myBarsCount).toBe(3);
    expect(betaRow?.myBarsCount).toBe(5);
  });

  it('totals the overview from their own bars', async () => {
    const mine = data<GoldPortalOverviewDto>(await get('/gold/portal/overview', alphaToken));
    const theirs = data<GoldPortalOverviewDto>(await get('/gold/portal/overview', betaToken));
    expect(mine.totalBars).toBe(3);
    expect(theirs.totalBars).toBe(5);
  });

  it('shows confirmed receipts only — a draft never reaches the customer', async () => {
    const res = await get('/gold/portal/receiving?pageSize=100', alphaToken);
    expect(res.status).toBe(200);
    const receipts = data<GoldPortalReceiptDto[]>(res);
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) expect(receipt.status).toBe('confirmed');
  });

  it('refuses a company id appended to the query rather than ignoring it', async () => {
    // `.strict()` — the schema does not declare the key, so this is a 400, not a silent override.
    const res = await get(`/gold/portal/bars?companyId=${betaId}`, alphaToken);
    expect(res.status).toBe(400);
  });

  it('confines the reports to their own fund', async () => {
    const res = await get('/gold/portal/reports/movement?year=2026&metalType=gold', alphaToken);
    expect(res.status).toBe(200);
    const rows = data<{ rows: { companyId: string }[] }>(res).rows;
    for (const row of rows) expect(row.companyId).toBe(alphaId);
  });
});

describe('a customer cannot write, anywhere', () => {
  it('is refused on every write against its own surface', async () => {
    expect((await post('/gold/portal/bars', alphaToken)).status).toBe(403);
    expect((await patch('/gold/portal/bars', alphaToken)).status).toBe(403);
    expect((await del('/gold/portal/bars', alphaToken)).status).toBe(403);
  });

  it('cannot reach the staff side of its own module', async () => {
    expect((await get('/gold/bars', alphaToken)).status).toBe(403);
    expect((await get('/gold/companies', alphaToken)).status).toBe(403);
    expect((await get('/gold/reports/client-balances', alphaToken)).status).toBe(403);
    expect((await post('/gold/companies', alphaToken, { name: 'x' })).status).toBe(403);
  });

  /** Both of these are open to any authenticated EMPLOYEE, which is exactly why the gate exists. */
  it('cannot reach the platform surfaces that need no permission', async () => {
    // A REAL user id, so a 403 here is the confinement gate and not the body validator — the gate
    // runs inside `authenticate`, before `validate` ever sees the request.
    const me = data<{ id: string }>(await get('/auth/me', adminToken));
    const resolved = await post('/platform/directory/resolve', alphaToken, { userIds: [me.id] });
    expect(resolved.status).toBe(403);
    expect((await get('/platform/me/applications', alphaToken)).status).toBe(403);
  });

  it('cannot administer portal accounts, including its own', async () => {
    expect((await get('/gold/portal-accounts', alphaToken)).status).toBe(403);
    expect((await post('/gold/portal-accounts', alphaToken, { companyId: alphaId })).status).toBe(403);
  });

  it('keeps its own account self-service', async () => {
    expect((await get('/auth/me', alphaToken)).status).toBe(200);
    expect((await get('/auth/sessions', alphaToken)).status).toBe(200);
  });
});

describe('the binding is re-read on every request', () => {
  it('cuts the portal off the moment the customer company is deactivated', async () => {
    const beforeChange = await get('/gold/portal/overview', betaToken);
    expect(beforeChange.status).toBe(200);

    const company = data<GoldCompanyDto>(await get(`/gold/companies/${betaId}`, adminToken));
    const suspended = await patch(`/gold/companies/${betaId}`, adminToken, {
      status: 'inactive',
      version: company.version,
    });
    expect(suspended.status).toBe(200);

    // No waiting: a binding read from the 60-second auth snapshot would still answer 200 here.
    expect((await get('/gold/portal/overview', betaToken)).status).toBe(403);

    const restored = data<GoldCompanyDto>(await get(`/gold/companies/${betaId}`, adminToken));
    const reactivated = await patch(`/gold/companies/${betaId}`, adminToken, {
      status: 'active',
      version: restored.version,
    });
    expect(reactivated.status).toBe(200);
    expect((await get('/gold/portal/overview', betaToken)).status).toBe(200);
  });
});

describe('an employee is not a customer', () => {
  it('is refused on the portal even holding every permission there is', async () => {
    // The super-admin holds `goldPortal.view`; what they do not have is a binding.
    expect((await get('/gold/portal/overview', adminToken)).status).toBe(403);
  });
});

describe('the staff screen administers customer logins and nothing else', () => {
  it('lists the portal accounts with their company', async () => {
    const res = await get('/gold/portal-accounts?pageSize=100', adminToken);
    expect(res.status).toBe(200);
    const rows = data<{ companyId: string; username: string | null }[]>(res);
    expect(rows.map((r) => r.username).sort()).toEqual(['portal.alpha', 'portal.beta']);
  });

  it('refuses to create an account for a company that is not active', async () => {
    const company = data<GoldCompanyDto>(await get(`/gold/companies/${betaId}`, adminToken));
    await patch(`/gold/companies/${betaId}`, adminToken, {
      status: 'inactive',
      version: company.version,
    });
    const refused = await post('/gold/portal-accounts', adminToken, {
      companyId: betaId,
      firstName: { ar: 'x', en: 'x' },
      lastName: { ar: 'y', en: 'y' },
      username: 'portal.rejected',
    });
    expect(refused.status).toBe(422);

    const restored = data<GoldCompanyDto>(await get(`/gold/companies/${betaId}`, adminToken));
    await patch(`/gold/companies/${betaId}`, adminToken, {
      status: 'active',
      version: restored.version,
    });
  });

  /** The grant is authority over CUSTOMER logins — never a way to reach an employee's account. */
  it('404s when pointed at an employee’s account id', async () => {
    const me = data<{ id: string }>(await get('/auth/me', adminToken));
    expect((await get(`/gold/portal-accounts/${me.id}`, adminToken)).status).toBe(404);
    expect((await del(`/gold/portal-accounts/${me.id}`, adminToken)).status).toBe(404);
  });
});
