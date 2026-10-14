// The open boards' bank and area filters, end to end — «الفلتر بتاع البنك والمنطقة اتأكد إنه شغال».
//
// Proven over real HTTP, real RBAC and a real mongod, for the replenishment board and the
// maintenance board alike (one repository serves both, and both are run):
//
//   · an area can be chosen on its own — with no bank chosen the area list is every open row's
//     area (the legacy header filter row), and choosing banks narrows it (the saved filter);
//   · every filter reaches EVERY matching row past one page — a busy day has more than
//     `MAX_PAGE_SIZE` open operations, and the board walks the pages (the cap itself is unchanged);
//   · a bank change leaves the old bank's area unoffered, which is what the screen prunes against;
//   · a name holding a comma, a name stored with a stray trailing space, and an Arabic name all
//     filter to exactly their own rows;
//   · the dropdowns and the list read the same rows under the same scope, including the command
//     bar's branch narrowing.
//
// The rows are written straight into the collections: how an operation is OPENED is proven in
// atm.spec.ts and atm-no-double-open.spec.ts; this suite is about reading the board back.
// Every bank, area and code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types, type Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  joinAtmNameList,
  platformPermissions,
  type AtmOperationFacetsDto,
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
import { AtmReplenishmentModel } from '../../src/modules/atm/replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../../src/modules/atm/maintenances/maintenance.model';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let mongoBase: { kind: 'replset' } | { kind: 'external'; url: string };
let app: Express;
let adminToken: string; // organization-wide, no home branch
let alexToken: string; // the operating bundle at BRANCH scope, placed in Alex
let tantaToken: string; // the same bundle, placed in Tanta
let alexBranchId: string;
let tantaBranchId: string;

const uriFor = (dbName: string): string => {
  if (mongoBase.kind === 'replset') return (replSet as MongoMemoryReplSet).getUri(dbName);
  const url = new URL(mongoBase.url);
  url.pathname = `/${dbName}`;
  return url.toString();
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

interface BoardRow {
  id: string;
  branchId: string;
  machineCode: string;
  bankName: string;
  area: string;
  closedAt: string | null;
}

type Query = Record<string, string>;

const get = (token: string, path: string, query: Query, branch?: string): request.Test => {
  const req = request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Authorization', `Bearer ${token}`);
  return branch === undefined ? req : req.set('X-Active-Branch', branch);
};

const facets = async (
  token: string,
  path: string,
  query: Query = {},
  branch?: string,
): Promise<AtmOperationFacetsDto> => {
  const res = await get(token, `${path}/facets`, query, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: AtmOperationFacetsDto }).data;
};

/**
 * The whole board for one filter, walked page by page at the platform cap — the arithmetic the
 * screen uses (`apps/web/src/modules/atm/lib/whole-board.ts`): page 1, then up to `totalPages`.
 */
const wholeBoard = async (
  token: string,
  path: string,
  query: Query = {},
  branch?: string,
): Promise<{ rows: BoardRow[]; totalItems: number; pages: number }> => {
  const page = async (n: number): Promise<{ items: BoardRow[]; meta: PageMeta }> => {
    const res = await get(token, path, { ...query, page: String(n), pageSize: '100' }, branch);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as { data: BoardRow[]; meta: PageMeta };
    return { items: body.data, meta: body.meta };
  };
  const first = await page(1);
  const rows = [...first.items];
  for (let n = 2; n <= first.meta.totalPages; n += 1) rows.push(...(await page(n)).items);
  return { rows, totalItems: first.meta.totalItems, pages: first.meta.totalPages };
};

const ids = (rows: readonly BoardRow[]): Set<string> => new Set(rows.map((row) => row.id));

const DAY = 24 * 3600 * 1000;

/** One open-board fixture per collection; the counts are what every assertion below adds up. */
const ALEX_OPEN: readonly [bank: string, area: string, count: number][] = [
  ['SYN NBE', 'SYN Smouha', 101],
  ['SYN NBE', 'SYN Sidi Gaber', 6],
  ['SYN CIB', 'SYN Smouha', 4],
  ['SYN CIB', 'SYN Miami', 10],
  // One bank under two spellings — a label typed with a trailing space, and one without.
  ['SYN QNB ', 'SYN Agami ', 2],
  ['SYN QNB', 'SYN Agami', 1],
  // Names holding a comma: the platform list parser used to cut them in two.
  ['SYN Bank, Ltd', 'SYN Raml, Station', 3],
  ['البنك الأهلي', 'سموحة', 3],
];
const ALEX_TOTAL = ALEX_OPEN.reduce((sum, [, , count]) => sum + count, 0); // 130
const TANTA_OPEN: readonly [string, string, number][] = [
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

const seed = async (model: Model<never>, prefix: string): Promise<void> => {
  const docs: Record<string, unknown>[] = [];
  let n = 0;
  const row = (
    branchId: string,
    bankName: string,
    area: string,
    extra: Record<string, unknown> = {},
  ): void => {
    n += 1;
    const openedAt = new Date(Date.now() - (n % 9 === 0 ? 3 * DAY : 0) - n * 1000);
    docs.push({
      branchId: new Types.ObjectId(branchId),
      machineId: new Types.ObjectId(),
      machineCode: `${prefix}${String(n).padStart(4, '0')}`,
      bankName,
      machineName: `SYN ${prefix}${String(n)}`,
      zone: '',
      area,
      openedAt,
      closedAt: null,
      ...extra,
    });
  };
  for (const [bank, area, count] of ALEX_OPEN) {
    for (let i = 0; i < count; i += 1) row(alexBranchId, bank, area);
  }
  for (const [bank, area, count] of TANTA_OPEN) {
    for (let i = 0; i < count; i += 1) row(tantaBranchId, bank, area);
  }
  // Neither a closed row nor a deleted one is on the board, or in its dropdowns.
  row(alexBranchId, 'SYN OLD BANK', 'SYN Old Area', { closedAt: new Date() });
  row(alexBranchId, 'SYN OLD BANK', 'SYN Old Area', { closedAt: new Date() });
  row(alexBranchId, 'SYN GONE BANK', 'SYN Gone Area', { isDeleted: true, deletedAt: new Date() });
  await model.insertMany(docs);
};

beforeAll(async () => {
  const external = process.env.MONGO_TEST_URI;
  if (external !== undefined && external !== '') {
    mongoBase = { kind: 'external', url: external };
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoBase = { kind: 'replset' };
  }
  await bootPlatform({
    mongoUri: uriFor(`ecms-atm-board-filters-${String(Date.now())}`),
    modules: moduleManifests,
  });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('atm-filters-admin@ecms.local');
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
  adminToken = await login('atm-filters-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  alexBranchId = await mkBranch('93', 'الإسكندرية', 'Alexandria');
  tantaBranchId = await mkBranch('94', 'طنطا', 'Tanta');

  const viewerRole = await rbacService.createRole(
    {
      name: { en: 'ATM board reader', ar: 'قارئ لوحة الصراف الآلي' },
      permissionKeys: ['atmReplenishment.view', 'atmMaintenance.view'],
    },
    adminUserId,
  );
  const alexId = await mkUser('atm-filters-alex@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(alexId, String(viewerRole._id), 'branch');
  alexToken = await login('atm-filters-alex@ecms.local');
  const tantaId = await mkUser('atm-filters-tanta@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaId, String(viewerRole._id), 'branch');
  tantaToken = await login('atm-filters-tanta@ecms.local');

  await seed(AtmReplenishmentModel as unknown as Model<never>, 'R');
  await seed(AtmMaintenanceModel as unknown as Model<never>, 'M');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe.each([
  { board: 'replenishments', path: '/atm/replenishments' },
  { board: 'maintenance', path: '/atm/maintenances' },
])('the $board board', ({ path }) => {
  describe('the dropdowns', () => {
    it('offers EVERY open area while no bank is chosen — an area can be filtered on its own', async () => {
      const offered = await facets(alexToken, path);
      expect(offered.banks).toEqual(ALEX_BANKS);
      expect(offered.areas).toEqual(ALEX_AREAS);
    });

    it('narrows the areas to the chosen banks, and leaves the banks whole', async () => {
      const nbe = await facets(alexToken, path, { banks: 'SYN NBE' });
      expect(nbe.banks).toEqual(ALEX_BANKS);
      expect(nbe.areas).toEqual(['SYN Sidi Gaber', 'SYN Smouha']);
      const two = await facets(alexToken, path, { banks: joinAtmNameList(['SYN NBE', 'SYN CIB']) });
      expect(two.areas).toEqual(['SYN Miami', 'SYN Sidi Gaber', 'SYN Smouha']);
    });

    it('offers nothing closed, nothing deleted, and nothing from another branch', async () => {
      const offered = await facets(alexToken, path);
      for (const name of ['SYN OLD BANK', 'SYN GONE BANK', 'SYN TANTA BANK']) {
        expect(offered.banks).not.toContain(name);
      }
      for (const name of ['SYN Old Area', 'SYN Gone Area', 'SYN Tanta Center', 'SYN Mahalla']) {
        expect(offered.areas).not.toContain(name);
      }
    });
  });

  describe('every matching row is reachable past one page', () => {
    it('the unfiltered board: every open row of the branch, in the board order', async () => {
      const board = await wholeBoard(alexToken, path);
      expect(board.pages).toBeGreaterThan(1);
      expect(board.totalItems).toBe(ALEX_TOTAL);
      expect(board.rows).toHaveLength(ALEX_TOTAL);
      expect(ids(board.rows).size).toBe(ALEX_TOTAL);
      expect(board.rows.every((row) => row.branchId === alexBranchId)).toBe(true);
      expect(board.rows.every((row) => row.closedAt === null)).toBe(true);
      // Area descending across the page boundary, the legacy `.sort({ area: -1 })`.
      for (let i = 1; i < board.rows.length; i += 1) {
        expect((board.rows[i - 1] as BoardRow).area >= (board.rows[i] as BoardRow).area).toBe(true);
      }
    });

    it('by bank alone', async () => {
      const board = await wholeBoard(alexToken, path, { banks: 'SYN NBE' });
      expect(board.pages).toBe(2);
      expect(board.rows).toHaveLength(107);
      expect(ids(board.rows).size).toBe(107);
      expect(new Set(board.rows.map((row) => row.bankName))).toEqual(new Set(['SYN NBE']));
    });

    it('by area alone — across banks', async () => {
      const board = await wholeBoard(alexToken, path, { areas: 'SYN Smouha' });
      expect(board.pages).toBe(2);
      expect(board.rows).toHaveLength(105);
      expect(new Set(board.rows.map((row) => row.area))).toEqual(new Set(['SYN Smouha']));
      expect(new Set(board.rows.map((row) => row.bankName))).toEqual(
        new Set(['SYN NBE', 'SYN CIB']),
      );
    });

    it('by bank and area together', async () => {
      const board = await wholeBoard(alexToken, path, { banks: 'SYN NBE', areas: 'SYN Smouha' });
      expect(board.pages).toBe(2);
      expect(board.rows).toHaveLength(101);
      expect(ids(board.rows).size).toBe(101);
      expect(
        board.rows.every((row) => row.bankName === 'SYN NBE' && row.area === 'SYN Smouha'),
      ).toBe(true);
    });

    it('never by raising the page cap — it stays the platform’s', async () => {
      const res = await get(alexToken, path, { pageSize: '1000' });
      expect(res.status).toBe(400);
    });
  });

  describe('a bank change', () => {
    it('stops offering the previous bank’s area — what the screen prunes the selection against', async () => {
      // NBE + «Sidi Gaber» is a real pair; switching the bank to CIB orphans the area.
      expect((await facets(alexToken, path, { banks: 'SYN NBE' })).areas).toContain(
        'SYN Sidi Gaber',
      );
      const cib = await facets(alexToken, path, { banks: 'SYN CIB' });
      expect(cib.areas).toEqual(['SYN Miami', 'SYN Smouha']);
      // Kept, the orphaned area answers honestly — nothing open matches both — which is exactly
      // the empty board the screen must not leave behind; pruned, the bank's whole board is back.
      const stale = await wholeBoard(alexToken, path, {
        banks: 'SYN CIB',
        areas: 'SYN Sidi Gaber',
      });
      expect(stale.rows).toHaveLength(0);
      expect((await wholeBoard(alexToken, path, { banks: 'SYN CIB' })).rows).toHaveLength(14);
    });
  });

  describe('names as the rows store them', () => {
    it('folds a spelling with stray spaces into its name — one option, every row', async () => {
      const offered = await facets(alexToken, path);
      expect(offered.banks.filter((bank) => bank.trim() === 'SYN QNB')).toEqual(['SYN QNB']);
      expect(offered.areas.filter((area) => area.trim() === 'SYN Agami')).toEqual(['SYN Agami']);
      const byBank = await wholeBoard(alexToken, path, { banks: 'SYN QNB' });
      expect(byBank.rows).toHaveLength(3);
      const byArea = await wholeBoard(alexToken, path, { areas: 'SYN Agami' });
      expect(byArea.rows).toHaveLength(3);
      expect((await facets(alexToken, path, { banks: 'SYN QNB' })).areas).toEqual(['SYN Agami']);
    });

    it('keeps a name holding a comma whole', async () => {
      const banks = joinAtmNameList(['SYN Bank, Ltd']);
      const areas = joinAtmNameList(['SYN Raml, Station']);
      expect((await wholeBoard(alexToken, path, { banks })).rows).toHaveLength(3);
      expect((await wholeBoard(alexToken, path, { areas })).rows).toHaveLength(3);
      expect((await wholeBoard(alexToken, path, { banks, areas })).rows).toHaveLength(3);
      expect((await facets(alexToken, path, { banks })).areas).toEqual(['SYN Raml, Station']);
    });

    it('still reads a plain comma list as several names — every link written before', async () => {
      const board = await wholeBoard(alexToken, path, { banks: 'SYN NBE,SYN CIB' });
      expect(board.rows).toHaveLength(107 + 14);
    });

    it('filters by an Arabic name', async () => {
      expect((await wholeBoard(alexToken, path, { banks: 'البنك الأهلي' })).rows).toHaveLength(3);
      expect((await wholeBoard(alexToken, path, { areas: 'سموحة' })).rows).toHaveLength(3);
      expect((await facets(alexToken, path, { banks: 'البنك الأهلي' })).areas).toEqual(['سموحة']);
    });
  });

  describe('the dropdowns and the board read one scope', () => {
    it('a branch-scoped reader: their branch only, in both', async () => {
      const offered = await facets(tantaToken, path);
      expect(offered.banks).toEqual(['SYN NBE', 'SYN TANTA BANK']);
      expect(offered.areas).toEqual(['SYN Mahalla', 'SYN Tanta Center']);
      expect((await wholeBoard(tantaToken, path)).rows).toHaveLength(TANTA_TOTAL);
      // The same bank name in another branch never leaks into this one's filter.
      const nbe = await wholeBoard(tantaToken, path, { banks: 'SYN NBE' });
      expect(nbe.rows).toHaveLength(5);
      expect(nbe.rows.every((row) => row.branchId === tantaBranchId)).toBe(true);
    });

    it('an organization-wide reader: the company, or the branch the command bar narrows to', async () => {
      const company = await facets(adminToken, path);
      expect(company.areas).toEqual([...ALEX_AREAS, 'SYN Mahalla', 'SYN Tanta Center'].sort());
      expect((await wholeBoard(adminToken, path)).rows).toHaveLength(ALEX_TOTAL + TANTA_TOTAL);
      expect((await wholeBoard(adminToken, path, { banks: 'SYN NBE' })).rows).toHaveLength(112);

      const narrowed = await facets(adminToken, path, {}, tantaBranchId);
      expect(narrowed.banks).toEqual(['SYN NBE', 'SYN TANTA BANK']);
      expect(narrowed.areas).toEqual(['SYN Mahalla', 'SYN Tanta Center']);
      const board = await wholeBoard(adminToken, path, { banks: 'SYN NBE' }, tantaBranchId);
      expect(board.rows).toHaveLength(5);
      expect(board.rows.every((row) => row.branchId === tantaBranchId)).toBe(true);
    });
  });
});
