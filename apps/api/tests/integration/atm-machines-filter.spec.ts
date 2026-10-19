// /atm/machines «كل الماكينات» — every column filtered, counted and paged, end to end.
//
// Proven over real HTTP, real RBAC and a real mongod:
//
//   · each column's filter alone — Bank and Area (names, several at once; a name holding a comma
//     and a name stored with a stray trailing space each match exactly their own machines), ID
//     (the codes named exactly, normalized, and a substring of the code), ATM Name (a substring,
//     case-insensitive, taken literally) — and all of them together;
//   · only ACTIVE machines are on the page (`isActive=true`, the legacy /all_atm), never a
//     deleted one;
//   · the summary counts the WHOLE filtered set — more machines than one page — and its counts
//     equal the distinct values of every row the pages walk to; its dropdowns follow the faceted
//     rule (each leaves its own choice out);
//   · the pages reach every machine, at any page size up to the platform cap;
//   · every column sorts, both ways;
//   · scope: a branch-scoped reader sees their branch alone, in the list and in the counts alike;
//     an organization-wide reader sees the company, or the branch the command bar narrows to; and
//     the request has no branch parameter for a screen to send.
//
// The machines are written straight into the collection: how one is ADDED is proven in atm.spec.ts
// and atm-data-edit-permissions.spec.ts; this suite is about reading the directory back.
// Every bank, area, code and name below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  joinAtmNameList,
  platformPermissions,
  type AtmMachineDto,
  type AtmMachinesSummaryDto,
  type PageMeta,
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
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // organization-wide, no home branch
let alexToken: string; // atmMachine.view at BRANCH scope, placed in Alex
let tantaToken: string; // the same, placed in Tanta
let alexBranchId: string;
let tantaBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-machines-filter-${String(Date.now())}`;
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

type Query = Record<string, string>;

/** What the screen sends on every request: the page shows ACTIVE machines, as /all_atm did. */
const ACTIVE: Query = { isActive: 'true' };

const get = (token: string, path: string, query: Query, branch?: string): request.Test => {
  const req = request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Authorization', `Bearer ${token}`);
  return branch === undefined ? req : req.set('X-Active-Branch', branch);
};

const page = async (
  token: string,
  query: Query,
  branch?: string,
): Promise<{ items: AtmMachineDto[]; meta: PageMeta }> => {
  const res = await get(token, '/atm/machines', { ...ACTIVE, ...query }, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const body = res.body as { data: AtmMachineDto[]; meta: PageMeta };
  return { items: body.data, meta: body.meta };
};

/** Every machine a filter matches, walked page by page — what the screen's export does. */
const walk = async (
  token: string,
  query: Query = {},
  branch?: string,
  pageSize = 100,
): Promise<{ rows: AtmMachineDto[]; meta: PageMeta }> => {
  const first = await page(token, { ...query, page: '1', pageSize: String(pageSize) }, branch);
  const rows = [...first.items];
  for (let n = 2; n <= first.meta.totalPages; n += 1) {
    rows.push(
      ...(await page(token, { ...query, page: String(n), pageSize: String(pageSize) }, branch))
        .items,
    );
  }
  return { rows, meta: first.meta };
};

const summary = async (
  token: string,
  query: Query = {},
  branch?: string,
): Promise<AtmMachinesSummaryDto> => {
  const res = await get(token, '/atm/machines/summary', { ...ACTIVE, ...query }, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: AtmMachinesSummaryDto }).data;
};

/** The counts a set of rows really holds — names as the table shows them. */
const countsOf = (rows: readonly AtmMachineDto[]): AtmMachinesSummaryDto['counts'] => ({
  machines: rows.length,
  banks: new Set(rows.map((row) => row.bankName.trim())).size,
  areas: new Set(rows.map((row) => row.area.trim())).size,
});

const codesOf = (rows: readonly AtmMachineDto[]): string[] =>
  rows.map((row) => row.machineCode).sort();

/** One fixture line: a bank, an area, how many ACTIVE machines carry both. */
const ALEX: readonly [bank: string, area: string, count: number][] = [
  ['SYN NBE', 'SYN Smouha', 101],
  ['SYN NBE', 'SYN Sidi Gaber', 6],
  ['SYN CIB', 'SYN Smouha', 4],
  ['SYN CIB', 'SYN Miami', 10],
  // One bank and one area under two spellings — a label typed with a trailing space, one without.
  ['SYN QNB ', 'SYN Agami ', 2],
  ['SYN QNB', 'SYN Agami', 1],
  // Names holding a comma: the platform list parser would cut them in two.
  ['SYN Bank, Ltd', 'SYN Raml, Station', 3],
  ['البنك الأهلي', 'سموحة', 3],
];
const ALEX_TOTAL = 130;
const TANTA: readonly [string, string, number][] = [
  ['SYN NBE', 'SYN Tanta Center', 5],
  ['SYN TANTA BANK', 'SYN Mahalla', 2],
];
const TANTA_TOTAL = 7;

const ALEX_BANKS = ['SYN Bank, Ltd', 'SYN CIB', 'SYN NBE', 'SYN QNB', 'البنك الأهلي'].sort();
const ALEX_AREAS = [
  'SYN Agami',
  'SYN Miami',
  'SYN Raml, Station',
  'SYN Sidi Gaber',
  'SYN Smouha',
  'سموحة',
].sort();

/** The names a few Alex machines carry instead of the plain one — the ATM Name filter's cases. */
const NAMED: Record<number, string> = {
  3: 'SYN Mall (East) 1',
  4: 'syn MALL (EAST) 2',
  5: 'SYN Mall East 3',
  6: 'SYN Station.Road',
  7: 'SYN StationXRoad',
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('atm-machines-admin@ecms.local');
  await rbacService.ensureAssignment(adminUserId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminUserId,
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
  adminToken = await login('atm-machines-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  alexBranchId = await mkBranch('95', 'الإسكندرية', 'Alexandria');
  tantaBranchId = await mkBranch('96', 'طنطا', 'Tanta');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'ATM machine reader', ar: 'قارئ الماكينات' }, permissionKeys: ['atmMachine.view'] },
    adminUserId,
  );
  const alexId = await mkUser('atm-machines-alex@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(alexId, String(viewerRole._id), 'branch');
  alexToken = await login('atm-machines-alex@ecms.local');
  const tantaId = await mkUser('atm-machines-tanta@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaId, String(viewerRole._id), 'branch');
  tantaToken = await login('atm-machines-tanta@ecms.local');

  const docs: Record<string, unknown>[] = [];
  const add = (
    branchId: string,
    code: string,
    bankName: string,
    area: string,
    name: string,
    extra: Record<string, unknown> = {},
  ): void => {
    docs.push({
      branchId: new Types.ObjectId(branchId),
      bankName,
      machineCode: code,
      name,
      zone: '',
      area,
      isActive: true,
      ...extra,
    });
  };
  let n = 0;
  for (const [bank, area, count] of ALEX) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      add(alexBranchId, `1${String(n).padStart(4, '0')}`, bank, area, NAMED[n] ?? `SYN ATM ${n}`);
    }
  }
  let t = 0;
  for (const [bank, area, count] of TANTA) {
    for (let i = 0; i < count; i += 1) {
      t += 1;
      add(tantaBranchId, `2${String(t).padStart(4, '0')}`, bank, area, `SYN TANTA ATM ${t}`);
    }
  }
  // Neither an archived machine nor a deleted one is on the page, in its counts or its dropdowns.
  add(alexBranchId, '19001', 'SYN OLD BANK', 'SYN Old Area', 'SYN Archived 1', { isActive: false });
  add(alexBranchId, '19002', 'SYN OLD BANK', 'SYN Old Area', 'SYN Archived 2', { isActive: false });
  add(alexBranchId, '19003-D', 'SYN GONE BANK', 'SYN Gone Area', 'SYN Deleted', {
    isDeleted: true,
    deletedAt: new Date(),
  });
  await AtmMachineModel.insertMany(docs);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('each column filter alone', () => {
  it('Bank: several at once, ORed — a name holding a comma, and both spellings of one bank', async () => {
    const nbe = await walk(alexToken, { banks: 'SYN NBE' });
    expect(nbe.meta.totalItems).toBe(107);
    expect(nbe.rows).toHaveLength(107);
    expect(nbe.rows.every((row) => row.bankName === 'SYN NBE')).toBe(true);

    const two = await walk(alexToken, { banks: joinAtmNameList(['SYN Bank, Ltd', 'SYN CIB']) });
    expect(two.rows).toHaveLength(17);
    expect(new Set(two.rows.map((row) => row.bankName))).toEqual(
      new Set(['SYN Bank, Ltd', 'SYN CIB']),
    );

    const qnb = await walk(alexToken, { banks: 'SYN QNB' });
    expect(qnb.rows).toHaveLength(3);
    expect(new Set(qnb.rows.map((row) => row.bankName))).toEqual(new Set(['SYN QNB', 'SYN QNB ']));

    expect((await walk(alexToken, { banks: 'البنك الأهلي' })).rows).toHaveLength(3);
    expect((await walk(alexToken, { banks: 'SYN NOWHERE' })).rows).toHaveLength(0);
  });

  it('Area: several at once, across banks — a name holding a comma too', async () => {
    const smouha = await walk(alexToken, { areas: 'SYN Smouha' });
    expect(smouha.rows).toHaveLength(105);
    expect(new Set(smouha.rows.map((row) => row.bankName))).toEqual(new Set(['SYN NBE', 'SYN CIB']));
    const raml = await walk(alexToken, {
      areas: joinAtmNameList(['SYN Raml, Station', 'SYN Agami']),
    });
    expect(raml.rows).toHaveLength(6);
  });

  it('ID: the codes named exactly — normalized, pasted with any separator — and nothing else', async () => {
    const named = await walk(alexToken, { codes: '010001 10002,0010003' });
    expect(codesOf(named.rows)).toEqual(['10001', '10002', '10003']);
    // A code is never a prefix: «1000» names no machine.
    expect((await walk(alexToken, { codes: '1000' })).rows).toHaveLength(0);
    // A machine of another branch is not reached by naming it.
    expect((await walk(alexToken, { codes: '20001' })).rows).toHaveLength(0);
  });

  it('ID: a substring of the code, as the picker searches it', async () => {
    const all = (await walk(alexToken)).rows;
    const found = await walk(alexToken, { code: '012' });
    expect(codesOf(found.rows)).toEqual(
      codesOf(all.filter((row) => row.machineCode.includes('012'))),
    );
    expect(found.rows.length).toBeGreaterThan(1);
  });

  it('ATM Name: a substring, case-insensitive, typed characters taken literally', async () => {
    const mall = await walk(alexToken, { name: 'mall (east)' });
    expect(mall.rows.map((row) => row.name).sort()).toEqual([
      'SYN Mall (East) 1',
      'syn MALL (EAST) 2',
    ]);
    // «.» is a dot, not «any character»: StationXRoad does not match.
    const dot = await walk(alexToken, { name: 'station.road' });
    expect(dot.rows.map((row) => row.name)).toEqual(['SYN Station.Road']);
  });

  it('shows ACTIVE machines only, and never a deleted one', async () => {
    const everything = (await walk(adminToken)).rows;
    expect(everything).toHaveLength(ALEX_TOTAL + TANTA_TOTAL);
    for (const name of ['SYN OLD BANK', 'SYN GONE BANK']) {
      expect(everything.some((row) => row.bankName === name)).toBe(false);
    }
    expect((await walk(adminToken, { banks: 'SYN OLD BANK' })).rows).toHaveLength(0);
  });
});

describe('the filters together', () => {
  it('ANDs the columns and ORs within each', async () => {
    const query = {
      banks: joinAtmNameList(['SYN NBE', 'SYN CIB']),
      areas: joinAtmNameList(['SYN Smouha', 'SYN Miami']),
    };
    const both = await walk(alexToken, query);
    expect(both.rows).toHaveLength(115); // NBE·Smouha 101 + CIB·Smouha 4 + CIB·Miami 10
    const narrowed = await walk(alexToken, { ...query, code: '010' });
    expect(codesOf(narrowed.rows)).toEqual(
      codesOf(both.rows.filter((row) => row.machineCode.includes('010'))),
    );
    const one = await walk(alexToken, { ...query, codes: '10005', name: 'mall east' });
    expect(codesOf(one.rows)).toEqual(['10005']);
    expect((await walk(alexToken, { ...query, codes: '10005', name: 'mall (east)' })).rows).toEqual(
      [],
    );
  });
});

describe('the summary', () => {
  it('counts the WHOLE filtered set — past one page — exactly as the rows hold it', async () => {
    for (const query of [
      {},
      { banks: 'SYN NBE' },
      { areas: 'SYN Smouha' },
      { banks: 'SYN QNB' },
      { code: '01' },
      { name: 'syn atm 1' },
      { banks: joinAtmNameList(['SYN NBE', 'SYN CIB']), areas: 'SYN Smouha' },
    ] as Query[]) {
      const rows = (await walk(alexToken, query)).rows;
      expect((await summary(alexToken, query)).counts, JSON.stringify(query)).toEqual(
        countsOf(rows),
      );
    }
    expect((await summary(alexToken)).counts).toEqual({ machines: 130, banks: 5, areas: 6 });
    expect((await summary(alexToken, { banks: 'SYN NBE' })).counts).toEqual({
      machines: 107,
      banks: 1,
      areas: 2,
    });
    // Both spellings are one bank and one area.
    expect((await summary(alexToken, { banks: 'SYN QNB' })).counts).toEqual({
      machines: 3,
      banks: 1,
      areas: 1,
    });
  });

  it('offers each dropdown the names of the machines matching every OTHER filter', async () => {
    const open = await summary(alexToken);
    expect(open.options).toEqual({ banks: ALEX_BANKS, areas: ALEX_AREAS });

    // An area chosen: the banks it has; the areas stay whole, so a second one can be ticked.
    const smouha = await summary(alexToken, { areas: 'SYN Smouha' });
    expect(smouha.options).toEqual({ banks: ['SYN CIB', 'SYN NBE'], areas: ALEX_AREAS });

    // A bank chosen: its areas; the banks stay whole.
    const cib = await summary(alexToken, { banks: 'SYN CIB' });
    expect(cib.options).toEqual({ banks: ALEX_BANKS, areas: ['SYN Miami', 'SYN Smouha'] });

    // The other columns narrow both.
    const named = await summary(alexToken, { codes: '10001' });
    expect(named.options).toEqual({ banks: ['SYN NBE'], areas: ['SYN Smouha'] });
  });

  it('refuses page and order parameters — it is the list’s whole answer, not a page of it', async () => {
    const res = await get(alexToken, '/atm/machines/summary', { page: '2' });
    expect(res.status).toBe(400);
  });
});

describe('the pages', () => {
  it('reach every machine, at any page size up to the cap', async () => {
    for (const size of [10, 25, 50, 100]) {
      const { rows, meta } = await walk(alexToken, {}, undefined, size);
      expect(meta.totalItems).toBe(ALEX_TOTAL);
      expect(meta.totalPages).toBe(Math.ceil(ALEX_TOTAL / size));
      expect(new Set(rows.map((row) => row.id)).size).toBe(ALEX_TOTAL);
    }
    const res = await get(alexToken, '/atm/machines', { ...ACTIVE, pageSize: '101' });
    expect(res.status).toBe(400);
  });
});

describe('the order', () => {
  const ascending = (values: readonly string[]): boolean =>
    values.every((value, i) => i === 0 || (values[i - 1] as string) <= value);

  it.each(['bankName', 'machineCode', 'name', 'area'] as const)(
    'sorts the whole set by %s, both ways',
    async (column) => {
      const up = (await walk(alexToken, { sortBy: column, sortDir: 'asc' })).rows;
      expect(up).toHaveLength(ALEX_TOTAL);
      expect(ascending(up.map((row) => row[column]))).toBe(true);
      const down = (await walk(alexToken, { sortBy: column, sortDir: 'desc' })).rows;
      expect(ascending(down.map((row) => row[column]).reverse())).toBe(true);
      expect(new Set(down.map((row) => row.id)).size).toBe(ALEX_TOTAL);
    },
  );
});

describe('scope', () => {
  it('a branch-scoped reader: their branch alone, in the list and in the counts', async () => {
    const rows = (await walk(tantaToken)).rows;
    expect(rows).toHaveLength(TANTA_TOTAL);
    expect(rows.every((row) => row.branchId === tantaBranchId)).toBe(true);
    const tanta = await summary(tantaToken);
    expect(tanta.counts).toEqual({ machines: 7, banks: 2, areas: 2 });
    expect(tanta.counts).toEqual(countsOf(rows));
    expect(tanta.options).toEqual({
      banks: ['SYN NBE', 'SYN TANTA BANK'],
      areas: ['SYN Mahalla', 'SYN Tanta Center'],
    });
    // The same bank name in another branch never leaks into this one's answer.
    const nbe = await walk(tantaToken, { banks: 'SYN NBE' });
    expect(nbe.rows).toHaveLength(5);
    expect((await summary(tantaToken, { banks: 'SYN NBE' })).counts.machines).toBe(5);
  });

  it('an organization-wide reader: the company, or the branch the command bar narrows to', async () => {
    const company = await summary(adminToken);
    expect(company.counts).toEqual({ machines: 137, banks: 6, areas: 8 });
    expect(company.counts).toEqual(countsOf((await walk(adminToken)).rows));
    expect((await summary(adminToken, { banks: 'SYN NBE' })).counts.machines).toBe(112);

    const narrowed = await summary(adminToken, {}, tantaBranchId);
    expect(narrowed.counts).toEqual({ machines: 7, banks: 2, areas: 2 });
    const rows = (await walk(adminToken, {}, tantaBranchId)).rows;
    expect(rows).toHaveLength(TANTA_TOTAL);
    expect(rows.every((row) => row.branchId === tantaBranchId)).toBe(true);
  });

  it('takes no branch from the screen — the scope is the caller’s, decided by the server', async () => {
    for (const path of ['/atm/machines', '/atm/machines/summary']) {
      const res = await get(tantaToken, path, { ...ACTIVE, branchId: alexBranchId });
      expect(res.status, path).toBe(400);
    }
  });
});
