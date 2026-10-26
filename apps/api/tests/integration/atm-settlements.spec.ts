// /atm/settlements, /atm/preparation and /atm/control — settlements phase 1, end to end
// (docs/12-planning/atm-settlements-phase1.md §10.3).
//
// Proven over real HTTP, real RBAC and a real mongod, in the spec's order:
//   1. context — the ONE work branch per page (DS-22), the blocked states;
//   2. the bank setting (DS-24);
//   3–5. the Full list import: preview, apply in its three modes, the conflicts and the lock, scope;
//   6–7. layout saves and standard loads;
//   8–13. plans: create, add, edit, issue (running serials), reopen, cancel, spares;
//   14. the four papers and their keys;
//   15. Preparation: cleaning, duplicates (same line, cross-kind, out of reach), «تم التجهيز»;
//   16. Control: routes, moves, routes from zones, the handover and route sheets;
//   17. realtime; 18. the index builder's report.
// The race cases run two sessions by hand through `setSettlementHookForTests`: request A stops at a
// named point after its checks, request B commits, then A continues.
//
// EVERYTHING IS INVENTED: codes `BRKN9001…`, names «ماكينة اختبار n», seals `SEAL-T-…`, counts made
// up. No workbook is committed: the import's workbooks are built here with ExcelJS.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  AtmSettingKeys,
  SettingKeys,
  branchTopicRoom,
  platformPermissions,
  realtimeTopic,
  topicRoom,
  type AtmCassetteLayoutDetailDto,
  type AtmCassetteLayoutsDto,
  type AtmCassetteSlot,
  type AtmControlDayDto,
  type AtmControlRouteDto,
  type AtmHandoverPrintDto,
  type AtmLayoutImportResultDto,
  type AtmLayoutImportRunSummaryDto,
  type AtmNotePrintDto,
  type AtmPlanAddResultDto,
  type AtmPlanLineDto,
  type AtmPreparationContextDto,
  type AtmPreparationLineDto,
  type AtmReceiptPrintDto,
  type AtmRepTapeExportDto,
  type AtmRoutesFromZonesResultDto,
  type AtmRoutesPrintDto,
  type AtmSettlementContextDto,
  type AtmSettlementPlanDto,
  type AtmStandardLoadDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { seedAtm } from '../../src/modules/atm/atm.seed';
import { migrateAtmIndexes } from '../../src/modules/atm/atm-indexes';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { logger } from '../../src/infrastructure/logging/logger';
import { emitToRoom } from '../../src/infrastructure/realtime/socket-server';
import type * as SocketServer from '../../src/infrastructure/realtime/socket-server';
import { type AuthContext } from '../../src/shared/types';
import { cairoDateString } from '../../src/modules/atm/shared/cairo-time';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { AtmRegisterEntryModel } from '../../src/modules/atm/register/register.model';
import { AtmMachineLocationModel } from '../../src/modules/atm/map/machine-location.model';
import { AtmMapZoneModel } from '../../src/modules/atm/map/zone.model';
import { AtmCassetteLayoutModel } from '../../src/modules/atm/settlements/layouts/cassette-layout.model';
import { AtmCassetteLayoutVersionModel } from '../../src/modules/atm/settlements/layouts/cassette-layout-version.model';
import { AtmStandardLoadModel } from '../../src/modules/atm/settlements/standard-loads/standard-load.model';
import { AtmLayoutImportRunModel } from '../../src/modules/atm/settlements/import/layout-import-run.model';
import { AtmPlanLineModel } from '../../src/modules/atm/settlements/plans/plan-line.model';
import { AtmReplenishmentPlanModel } from '../../src/modules/atm/settlements/plans/plan.model';
import {
  AtmNoteCounterModel,
  noteCounterKey,
} from '../../src/modules/atm/settlements/plans/note-counter.model';
import { AtmLinePreparationModel } from '../../src/modules/atm/settlements/preparation/line-preparation.model';
import { AtmDispatchRouteModel } from '../../src/modules/atm/settlements/control/dispatch-route.model';
import { AtmRouteAssignmentModel } from '../../src/modules/atm/settlements/control/route-assignment.model';
import { setSettlementHookForTests } from '../../src/modules/atm/settlements/shared/test-hooks';
import { STALE_RUN_MS } from '../../src/modules/atm/register/import/plan-import';
import { buildMasterWorkbook, type MasterRow } from './helpers/atm-master-workbook';

// The publisher's ONE output seam is watched; everything still reaches the real emitter.
vi.mock('../../src/infrastructure/realtime/socket-server', async (importOriginal) => {
  const actual = await importOriginal<typeof SocketServer>();
  return { ...actual, emitToRoom: vi.fn(actual.emitToRoom) };
});

const PASSWORD = 'Str0ng#Pass!';
const LAYOUT_KEYS = ['atmCassetteLayout.view', 'atmCassetteLayout.manage', 'atmCassetteLayout.import'];
const PLAN_KEYS = [
  'atmSettlementPlan.view',
  'atmSettlementPlan.manage',
  'atmSettlementPlan.print',
  'atmSettlementPlan.export',
];
const PREP_KEYS = ['atmPreparation.view', 'atmPreparation.capture'];
const CONTROL_KEYS = ['atmControl.view', 'atmControl.manage', 'atmControl.print'];

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminCtx: AuthContext;
let ALPHA = '';
let BETA = '';
const token: Record<string, string> = {};

const TODAY = cairoDateString(new Date());
const day = (n: number): string => {
  const [y, m, d] = TODAY.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-settlements-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (
  email: string,
  placement: { branchId?: string; departmentId?: string } = {},
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: {
        branchId: placement.branchId ?? null,
        departmentId: placement.departmentId ?? null,
        sectionId: null,
        jobTitleId: null,
      },
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
const errorCode = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';
const detailsOf = (res: request.Response): { field?: string; code: string; message: string }[] =>
  (res.body as { error?: { details?: { field?: string; code: string; message: string }[] } }).error
    ?.details ?? [];
const detailCodes = (res: request.Response): string[] => detailsOf(res).map((d) => d.code);

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  as: string,
  body?: unknown,
  activeBranch?: string,
): request.Test => {
  let req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token[as] ?? as}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body as object);
};

const okData = async <T>(test: request.Test, status = 200): Promise<T> => {
  const res = await test;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const auditsOf = async (filter: Record<string, unknown>) =>
  AuditLogModel.find(filter).sort({ _id: 1 }).lean().exec();

// ── Slots ───────────────────────────────────────────────────────────────────────────────────────
const W = (slot: number, denomination: number, currency = 'EGP'): AtmCassetteSlot => ({
  slot,
  kind: 'withdrawal',
  denomination,
  currency,
});
const EMPTY = (slot: number): AtmCassetteSlot => ({
  slot,
  kind: 'empty',
  denomination: null,
  currency: null,
});
const DEPOSIT = (slot: number): AtmCassetteSlot => ({
  slot,
  kind: 'deposit',
  denomination: null,
  currency: null,
});
const STD4 = [W(1, 200), W(2, 200), W(3, 100), W(4, 50)];

// ── Machines ────────────────────────────────────────────────────────────────────────────────────
const machine: Record<string, string> = {};
let entryRow = 0;

const addMachine = async (
  branchId: string,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const [doc] = await AtmMachineModel.create([
    {
      branchId: oid(branchId),
      bankName: 'SYN BANK',
      machineCode: code,
      name: `ماكينة اختبار ${code}`,
      zone: '',
      area: 'منطقة تجريبية 1',
      isActive: true,
      ...extra,
    },
  ]);
  return String(doc?._id);
};

/** An OPEN register entry linking the machine to a bank. */
const addEntry = async (
  machineId: string,
  branchId: string,
  code: string,
  bankCode: string,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  entryRow += 1;
  await AtmRegisterEntryModel.create([
    {
      branchId: oid(branchId),
      area: 'منطقة تجريبية 1',
      bankCode,
      machineCode: code,
      machineId: oid(machineId),
      name: `ماكينة اختبار ${code}`,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      status: 'open',
      source: 'manual',
      ...extra,
    },
  ]);
};

const brkMachine = async (key: string, code: string, branchId = ALPHA): Promise<string> => {
  machine[key] = await addMachine(branchId, code);
  await addEntry(machine[key] ?? '', branchId, code, 'BRK');
  return machine[key] ?? '';
};

// ── Calls ───────────────────────────────────────────────────────────────────────────────────────
const putLayout = (
  as: string,
  machineId: string,
  slots: AtmCassetteSlot[],
  extra: Record<string, unknown> = {},
  activeBranch?: string,
): request.Test =>
  call(
    'put',
    `/atm/settlements/layouts/${machineId}`,
    as,
    {
      version: null,
      slots,
      typeLabel: null,
      featuresLabel: null,
      hubLabel: null,
      standardLoadId: null,
      reason: null,
      ...extra,
    },
    activeBranch,
  );

const layoutDetail = async (as: string, machineId: string): Promise<AtmCassetteLayoutDetailDto> =>
  okData<AtmCassetteLayoutDetailDto>(call('get', `/atm/settlements/layouts/${machineId}`, as));

const createPlan = async (
  date: string,
  as = 'alphaSettle',
  branchId = ALPHA,
  activeBranch?: string,
): Promise<AtmSettlementPlanDto> =>
  okData<AtmSettlementPlanDto>(
    call('post', '/atm/settlements/plans', as, { bankCode: 'BRK', replenishDate: date, branchId }, activeBranch),
  );

const getPlan = async (planId: string, as = 'alphaSettle'): Promise<AtmSettlementPlanDto> =>
  okData<AtmSettlementPlanDto>(call('get', `/atm/settlements/plans/${planId}`, as));

const addLines = (
  planId: string,
  run: 1 | 2 | 3,
  rows: { machineCode: string; scheduleTime: string | null }[],
  as = 'alphaSettle',
  activeBranch?: string,
): request.Test =>
  call('post', `/atm/settlements/plans/${planId}/lines`, as, { run, rows }, activeBranch);

const addOk = async (
  planId: string,
  run: 1 | 2 | 3,
  rows: { machineCode: string; scheduleTime: string | null }[],
  as = 'alphaSettle',
  activeBranch?: string,
): Promise<AtmPlanAddResultDto> => okData<AtmPlanAddResultDto>(addLines(planId, run, rows, as, activeBranch));

const lineOf = (plan: AtmSettlementPlanDto, code: string, run = 1): AtmPlanLineDto => {
  const line = plan.lines.find((l) => l.machineCode === code && l.run === run && l.status !== 'cancelled');
  expect(line, `${code} run ${String(run)}`).toBeDefined();
  return line as AtmPlanLineDto;
};

const issue = (planId: string, lines: AtmPlanLineDto[], as = 'alphaSettle', activeBranch?: string): request.Test =>
  call(
    'post',
    `/atm/settlements/plans/${planId}/issue`,
    as,
    { lines: lines.map((l) => ({ id: l.id, version: l.version })) },
    activeBranch,
  );

/** Issue every draft line of the plan. */
const issueAll = async (planId: string, as = 'alphaSettle', activeBranch?: string): Promise<AtmSettlementPlanDto> => {
  const plan = await getPlan(planId, as);
  return okData<AtmSettlementPlanDto>(
    issue(
      planId,
      plan.lines.filter((l) => l.status === 'draft'),
      as,
      activeBranch,
    ),
  );
};

const patchLine = (planId: string, line: AtmPlanLineDto, body: Record<string, unknown>, as = 'alphaSettle'): request.Test =>
  call('patch', `/atm/settlements/plans/${planId}/lines/${line.id}`, as, { version: line.version, ...body });

const printPlan = (planId: string, body: Record<string, unknown>, as = 'alphaSettle', activeBranch?: string): request.Test =>
  call('post', `/atm/settlements/plans/${planId}/prints`, as, body, activeBranch);

const prepLines = async (planId: string, as = 'alphaPrep', activeBranch?: string): Promise<AtmPreparationLineDto[]> =>
  okData<AtmPreparationLineDto[]>(call('get', `/atm/preparation/plans/${planId}/lines`, as, undefined, activeBranch));

const prepOf = async (planId: string, lineId: string, as = 'alphaPrep'): Promise<AtmPreparationLineDto> => {
  const line = (await prepLines(planId, as)).find((l) => l.lineId === lineId);
  expect(line).toBeDefined();
  return line as AtmPreparationLineDto;
};

/** P3 with the given values; every field not named is sent blank. */
const savePrep = (
  prep: AtmPreparationLineDto,
  values: { qrs?: Record<number, string | null>; seals?: Record<number, string | null> },
  as = 'alphaPrep',
): request.Test =>
  call('put', `/atm/preparation/lines/${prep.lineId}`, as, {
    version: prep.preparation.version,
    bags: prep.preparation.bags.map((b) => ({ bag: b.bag, qr: values.qrs?.[b.bag] ?? b.qr })),
    seals: prep.preparation.seals.map((s) => ({ slot: s.slot, value: values.seals?.[s.slot] ?? s.value })),
  });

/** Capture every required value of a line with unique synthetic values, then mark it prepared. */
let sealCounter = 0;
const prepareFully = async (planId: string, lineId: string): Promise<AtmPreparationLineDto> => {
  const prep = await prepOf(planId, lineId);
  const qrs: Record<number, string> = {};
  const seals: Record<number, string> = {};
  for (const bag of prep.preparation.bags) {
    sealCounter += 1;
    qrs[bag.bag] = `QR-T-${String(sealCounter).padStart(4, '0')}`;
  }
  for (const seal of prep.preparation.seals) {
    sealCounter += 1;
    seals[seal.slot] = `SEAL-T-${String(sealCounter).padStart(4, '0')}`;
  }
  const saved = (await okData<{ line: AtmPreparationLineDto }>(savePrep(prep, { qrs, seals }))).line;
  return (
    await okData<{ line: AtmPreparationLineDto }>(
      call('post', `/atm/preparation/lines/${lineId}/prepared`, 'alphaPrep', {
        version: saved.preparation.version,
      }),
    )
  ).line;
};

const importBook = (
  as: string,
  book: Buffer,
  fields: Record<string, string>,
  activeBranch?: string,
): request.Test => {
  let req = request(app)
    .post('/api/v1/atm/settlements/layouts/import')
    .set('Authorization', `Bearer ${token[as] ?? as}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  return req.attach('file', book, 'master-brk.xlsx');
};

const previewRevisionsOf = (result: AtmLayoutImportResultDto): string =>
  JSON.stringify(
    result.rows
      .filter((r) => ['new', 'changed', 'changedManual'].includes(r.outcome) && r.machineId !== null)
      .map((r) => ({ machineId: r.machineId, revision: r.revision })),
  );

const fullListRow = (code: string, denominations: number[], extra: Partial<MasterRow> = {}): MasterRow => ({
  code,
  location: `ماكينة اختبار ${code}`,
  denominations,
  deposit: 'Withdrawall',
  dep: 'منطقة تجريبية 1',
  bank: 'BRK (S2)',
  help: denominations.filter((d) => d !== 0).join('-'),
  ...extra,
});

// ── Setup ───────────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  adminId = await mkUser('atm-settle-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  adminCtx = {
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
  await settingsService.set(adminCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  await seedAtm();
  token.admin = await login('atm-settle-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, 'admin', body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  ALPHA = await post('/platform/branches', { code: '91', name: { ar: 'فرع ألفا', en: 'SYN Alpha' } });
  BETA = await post('/platform/branches', { code: '92', name: { ar: 'فرع بيتا', en: 'SYN Beta' } });
  const alphaDept = await post('/platform/departments', {
    code: 'SET-A-OPS',
    name: { ar: 'التسويات', en: 'Settlements' },
    branchId: ALPHA,
  });

  const role = async (name: string, keys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en: name, ar: name }, permissionKeys: keys }, adminId))._id);
  const users: {
    name: string;
    grants: { keys: string[]; scope: 'organization' | 'branch' | 'department' | 'own' }[];
    placement?: { branchId?: string; departmentId?: string };
  }[] = [
    {
      name: 'orgSettle',
      grants: [
        {
          keys: [...LAYOUT_KEYS, ...PLAN_KEYS, ...PREP_KEYS, ...CONTROL_KEYS, 'atmMap.view'],
          scope: 'organization',
        },
      ],
    },
    { name: 'alphaSettle', grants: [{ keys: [...LAYOUT_KEYS, ...PLAN_KEYS], scope: 'branch' }], placement: { branchId: ALPHA } },
    { name: 'alphaPrep', grants: [{ keys: PREP_KEYS, scope: 'branch' }], placement: { branchId: ALPHA } },
    {
      name: 'alphaCtl',
      grants: [{ keys: [...CONTROL_KEYS, 'atmMap.view'], scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    { name: 'alphaCtlNoMap', grants: [{ keys: CONTROL_KEYS, scope: 'branch' }], placement: { branchId: ALPHA } },
    {
      name: 'alphaCtlOwnMap',
      grants: [
        { keys: CONTROL_KEYS, scope: 'branch' },
        { keys: ['atmMap.view'], scope: 'own' },
      ],
      placement: { branchId: ALPHA },
    },
    { name: 'betaPrep', grants: [{ keys: PREP_KEYS, scope: 'branch' }], placement: { branchId: BETA } },
    {
      name: 'deptView',
      grants: [{ keys: ['atmSettlementPlan.view'], scope: 'department' }],
      placement: { branchId: ALPHA, departmentId: alphaDept },
    },
    {
      name: 'deptManage',
      grants: [{ keys: ['atmSettlementPlan.view', 'atmSettlementPlan.manage'], scope: 'department' }],
      placement: { branchId: ALPHA, departmentId: alphaDept },
    },
    {
      name: 'deptCapture',
      grants: [{ keys: PREP_KEYS, scope: 'department' }],
      placement: { branchId: ALPHA, departmentId: alphaDept },
    },
    {
      name: 'orgViewOwnPrint',
      grants: [
        { keys: ['atmSettlementPlan.view'], scope: 'organization' },
        { keys: ['atmSettlementPlan.print'], scope: 'own' },
      ],
      placement: { branchId: ALPHA },
    },
    {
      name: 'alphaPlanViewer',
      grants: [{ keys: ['atmSettlementPlan.view'], scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    {
      name: 'ownView',
      grants: [
        {
          keys: ['atmSettlementPlan.view', 'atmCassetteLayout.view', 'atmPreparation.view', 'atmControl.view'],
          scope: 'own',
        },
      ],
      placement: { branchId: ALPHA },
    },
    { name: 'noKeys', grants: [{ keys: ['atmMachine.view'], scope: 'organization' }] },
  ];
  for (const user of users) {
    const email = `atm-settle-${user.name.toLowerCase()}@ecms.local`;
    const id = await mkUser(email, user.placement);
    for (const [i, grant] of user.grants.entries()) {
      await rbacService.ensureAssignment(id, await role(`${user.name}-${String(i)}`, grant.keys), grant.scope);
    }
    token[user.name] = await login(email);
  }

  // Machines. Plan machines BRKN9001…, import machines BRKN92xx, layout-save machines BRKN93xx.
  for (let n = 1; n <= 7; n += 1) await brkMachine(`A${String(n)}`, `BRKN900${String(n)}`);
  await brkMachine('ASIX', 'BRKN9008');
  await brkMachine('ADEP', 'BRKN9009');
  await brkMachine('A20', 'BRKN9010');
  await brkMachine('ANOLAYOUT', 'BRKN9011');
  await brkMachine('ADEPONLY', 'BRKN9012');
  machine.ABM = await addMachine(ALPHA, 'BRKN9050');
  await addEntry(machine.ABM, ALPHA, 'BRKN9050', 'BM');
  machine.AARCH = await addMachine(ALPHA, 'BRKN9051', { isActive: false });
  await addEntry(machine.AARCH, ALPHA, 'BRKN9051', 'BRK');
  machine.ATWO = await addMachine(ALPHA, 'BRKN9052');
  // Two open entries of one code: an imported duplicate-open pair, exempt from D6 (DEC-11).
  await addEntry(machine.ATWO, ALPHA, 'BRKN9052', 'BRK', { openPeriodExempt: true });
  await addEntry(machine.ATWO, ALPHA, 'BRKN9052', 'BM', { openPeriodExempt: true });
  machine.ANOREG = await addMachine(ALPHA, 'BRKN9053');
  await brkMachine('B1', 'BRKN9101', BETA);

  // Zones in Alpha: Z1 (order 0) and Z2 (order 1) overlap on [30.005, 30.010] × [31.005, 31.010].
  const square = (lat: number, lng: number, size: number) => [
    { lat, lng },
    { lat, lng: lng + size },
    { lat: lat + size, lng: lng + size },
    { lat: lat + size, lng },
  ];
  await AtmMapZoneModel.create([
    { branchId: oid(ALPHA), name: 'قطاع اختبار 1', color: '#483bba', order: 0, points: square(30.0, 31.0, 0.01) },
    { branchId: oid(ALPHA), name: 'قطاع اختبار 2', color: '#1f8a4c', order: 1, points: square(30.005, 31.005, 0.01) },
  ]);
  const locate = async (key: string, lat: number, lng: number, needsReview = false) => {
    await AtmMachineLocationModel.create([
      {
        machineId: oid(machine[key] ?? ''),
        branchId: oid(ALPHA),
        status: 'located',
        lat,
        lng,
        source: 'manual',
        needsReview,
      },
    ]);
  };
  await locate('A1', 30.007, 31.007); // inside both — Z1 is first in order
  await locate('A2', 30.013, 31.013); // inside Z2 only
  await locate('A3', 30.002, 31.002, true); // inside Z1, a pin under review
  await locate('A5', 29.5, 30.5); // outside every zone
  // A4 stays unlocated.
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

afterEach(() => {
  setSettlementHookForTests('layoutImport.afterRunInsert', null);
  setSettlementHookForTests('layoutImport.beforeRow', null);
  setSettlementHookForTests('plan.update.beforeWrite', null);
  setSettlementHookForTests('plan.issue.beforeWrite', null);
  setSettlementHookForTests('plan.reopen.beforeWrite', null);
  setSettlementHookForTests('print.notes.beforeWrite', null);
  setSettlementHookForTests('preparation.save.beforeWrite', null);
  setSettlementHookForTests('preparation.prepared.beforeWrite', null);
  setSettlementHookForTests('control.assign.beforeWrite', null);
});

// ── 1. Context ──────────────────────────────────────────────────────────────────────────────────

describe('1. context — the one work branch of each page (DS-22)', () => {
  it('an organization user at Alpha works in Alpha, with every action', async () => {
    const ctx = await okData<AtmSettlementContextDto>(
      call('get', '/atm/settlements/context?page=plans', 'orgSettle', undefined, ALPHA),
    );
    expect(ctx.branch?.id).toBe(ALPHA);
    expect(ctx.blocked).toBeNull();
    expect(ctx.banks).toEqual(['BRK']);
    expect(Object.values(ctx.can).every(Boolean)).toBe(true);
  });

  it('the same user at «كل الفروع» must choose; every other endpoint answers the one 422', async () => {
    const ctx = await okData<AtmSettlementContextDto>(
      call('get', '/atm/settlements/context?page=layouts', 'orgSettle'),
    );
    expect(ctx.branch).toBeNull();
    expect(ctx.blocked).toBe('chooseBranch');
    const res = await call('get', `/atm/settlements/plans?bankCode=BRK&date=${day(1)}`, 'orgSettle');
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ATM_WORK_BRANCH_REQUIRED');
    expect(detailsOf(res)[0]).toMatchObject({ field: 'branch', code: 'CHOOSE_BRANCH' });
  });

  it('a branch user works in their branch; own scope reaches none', async () => {
    const alpha = await okData<AtmSettlementContextDto>(
      call('get', '/atm/settlements/context?page=import', 'alphaSettle'),
    );
    expect(alpha.branch?.id).toBe(ALPHA);
    expect(alpha.can.importLayouts).toBe(true);
    const own = await okData<AtmSettlementContextDto>(
      call('get', '/atm/settlements/context?page=plans', 'ownView'),
    );
    expect(own.blocked).toBe('noBranch');
    expect(Object.values(own.can).some(Boolean)).toBe(false);
    const res = await call('get', `/atm/settlements/plans?bankCode=BRK&date=${day(1)}`, 'ownView');
    expect(res.status).toBe(422);
    expect(detailCodes(res)).toEqual(['NO_BRANCH']);
  });

  it('a key not held is refused at the route', async () => {
    expect((await call('get', '/atm/settlements/context?page=plans', 'noKeys')).status).toBe(403);
    expect((await call('get', '/atm/preparation/context', 'noKeys')).status).toBe(403);
    expect((await call('get', '/atm/control/day', 'noKeys')).status).toBe(403);
  });
});

// ── 2. The bank setting ─────────────────────────────────────────────────────────────────────────

describe('2. the bank setting (DS-24)', () => {
  it('BRK only by default; a bank added to the setting is offered', async () => {
    const before = await call('get', '/atm/settlements/layouts?bankCode=BM', 'alphaSettle');
    expect(before.status).toBe(422);
    expect(errorCode(before)).toBe('ATM_SETTLEMENT_BANK_NOT_ENABLED');
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.SettlementBanks,
      scope: 'organization',
      value: ['BRK', 'BM'],
    });
    const after = await okData<AtmCassetteLayoutsDto>(
      call('get', '/atm/settlements/layouts?bankCode=BM', 'alphaSettle'),
    );
    expect(after.rows.map((r) => r.machineCode)).toEqual(['BRKN9050']);
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.SettlementBanks,
      scope: 'organization',
      value: ['BRK'],
    });
  });
});
