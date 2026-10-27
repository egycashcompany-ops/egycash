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
import {
  setSettlementHookForTests,
  type SettlementHookPoint,
} from '../../src/modules/atm/settlements/shared/test-hooks';
import { STALE_RUN_MS } from '../../src/modules/atm/register/import/plan-import';
import { buildMasterWorkbook, type MasterRow } from './helpers/atm-master-workbook';

// The publisher's ONE output seam is watched; everything still reaches the real emitter.
vi.mock('../../src/infrastructure/realtime/socket-server', async (importOriginal) => {
  const actual = await importOriginal<typeof SocketServer>();
  return { ...actual, emitToRoom: vi.fn(actual.emitToRoom) };
});

const PASSWORD = 'Str0ng#Pass!';
const LAYOUT_KEYS = [
  'atmCassetteLayout.view',
  'atmCassetteLayout.manage',
  'atmCassetteLayout.import',
];
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
  const agent = request(app);
  let req = agent[method](`/api/v1${path}`).set('Authorization', `Bearer ${token[as] ?? as}`);
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
    call(
      'post',
      '/atm/settlements/plans',
      as,
      { bankCode: 'BRK', replenishDate: date, branchId },
      activeBranch,
    ),
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
): Promise<AtmPlanAddResultDto> =>
  okData<AtmPlanAddResultDto>(addLines(planId, run, rows, as, activeBranch));

const lineOf = (plan: AtmSettlementPlanDto, code: string, run = 1): AtmPlanLineDto => {
  const line = plan.lines.find(
    (l) => l.machineCode === code && l.run === run && l.status !== 'cancelled',
  );
  expect(line, `${code} run ${String(run)}`).toBeDefined();
  return line as AtmPlanLineDto;
};

const issue = (
  planId: string,
  lines: AtmPlanLineDto[],
  as = 'alphaSettle',
  activeBranch?: string,
): request.Test =>
  call(
    'post',
    `/atm/settlements/plans/${planId}/issue`,
    as,
    { lines: lines.map((l) => ({ id: l.id, version: l.version })) },
    activeBranch,
  );

/** Issue every draft line of the plan. */
const issueAll = async (
  planId: string,
  as = 'alphaSettle',
  activeBranch?: string,
): Promise<AtmSettlementPlanDto> => {
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

const patchLine = (
  planId: string,
  line: AtmPlanLineDto,
  body: Record<string, unknown>,
  as = 'alphaSettle',
): request.Test =>
  call('patch', `/atm/settlements/plans/${planId}/lines/${line.id}`, as, {
    version: line.version,
    ...body,
  });

const printPlan = (
  planId: string,
  body: Record<string, unknown>,
  as = 'alphaSettle',
  activeBranch?: string,
): request.Test => call('post', `/atm/settlements/plans/${planId}/prints`, as, body, activeBranch);

const prepLines = async (
  planId: string,
  as = 'alphaPrep',
  activeBranch?: string,
): Promise<AtmPreparationLineDto[]> =>
  okData<AtmPreparationLineDto[]>(
    call('get', `/atm/preparation/plans/${planId}/lines`, as, undefined, activeBranch),
  );

const prepOf = async (
  planId: string,
  lineId: string,
  as = 'alphaPrep',
): Promise<AtmPreparationLineDto> => {
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
    seals: prep.preparation.seals.map((s) => ({
      slot: s.slot,
      value: values.seals?.[s.slot] ?? s.value,
    })),
  });

/** Capture every required value of a line with unique synthetic values, then mark it prepared. */
let sealCounter = 0;
const prepareFully = async (
  planId: string,
  lineId: string,
  as = 'alphaPrep',
): Promise<AtmPreparationLineDto> => {
  const prep = await prepOf(planId, lineId, as);
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
  const saved = (await okData<{ line: AtmPreparationLineDto }>(savePrep(prep, { qrs, seals }, as)))
    .line;
  return (
    await okData<{ line: AtmPreparationLineDto }>(
      call('post', `/atm/preparation/lines/${lineId}/prepared`, as, {
        version: saved.preparation.version,
      }),
    )
  ).line;
};

/** Any line of the plan by id, cancelled ones included. */
const lineById = (plan: AtmSettlementPlanDto, id: string): AtmPlanLineDto => {
  const line = plan.lines.find((l) => l.id === id);
  expect(line, id).toBeDefined();
  return line as AtmPlanLineDto;
};

const lineAction = (
  planId: string,
  line: Pick<AtmPlanLineDto, 'id' | 'version'>,
  action: 'reopen' | 'cancel',
  reason: string,
  as = 'alphaSettle',
): request.Test =>
  call('post', `/atm/settlements/plans/${planId}/lines/${line.id}/${action}`, as, {
    version: line.version,
    reason,
  });

/** A plan of Alpha with the given batches added (each batch one run). */
const buildPlan = async (
  date: string,
  batches: { run: 1 | 2 | 3; rows: [string, string | null][] }[],
): Promise<AtmSettlementPlanDto> => {
  const plan = await createPlan(date);
  for (const batch of batches) {
    const added = await addOk(
      plan.id,
      batch.run,
      batch.rows.map(([machineCode, scheduleTime]) => ({ machineCode, scheduleTime })),
    );
    expect(added.refused, JSON.stringify(added.refused)).toEqual([]);
  }
  return getPlan(plan.id);
};

/** The Note counter of Alpha × BRK (DS-11). */
const counterSeq = async (): Promise<number> =>
  (
    await AtmNoteCounterModel.findOne({ key: noteCounterKey(ALPHA, 'BRK') })
      .lean()
      .exec()
  )?.seq ?? 0;

/** The instant at which the Cairo clock reads `hour:minute` on `dayText`. */
const cairoInstant = (dayText: string, hour: number, minute: number): Date => {
  const [y, m, d] = dayText.split('-').map(Number) as [number, number, number];
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let offset = -4; offset <= 4; offset += 1) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hour - offset, minute));
    const part = (type: string): string =>
      format.formatToParts(candidate).find((p) => p.type === type)?.value ?? '';
    if (
      `${part('year')}-${part('month')}-${part('day')}` === dayText &&
      Number(part('hour')) === hour &&
      Number(part('minute')) === minute
    ) {
      return candidate;
    }
  }
  throw new Error('no such Cairo instant');
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
      .filter(
        (r) => ['new', 'changed', 'changedManual'].includes(r.outcome) && r.machineId !== null,
      )
      .map((r) => ({ machineId: r.machineId, revision: r.revision })),
  );

const importFields = (extra: Record<string, string> = {}): Record<string, string> => ({
  bankCode: 'BRK',
  branchId: ALPHA,
  ...extra,
});

const applyFields = (
  result: AtmLayoutImportResultDto,
  mode: string,
  extra: Record<string, string> = {},
): Record<string, string> =>
  importFields({
    apply: 'true',
    mode,
    fileSha256: result.fileSha256,
    previewRevisions: previewRevisionsOf(result),
    ...extra,
  });

const previewOf = async (book: Buffer, as = 'alphaSettle'): Promise<AtmLayoutImportResultDto> =>
  okData<AtmLayoutImportResultDto>(importBook(as, book, importFields()));

const importRowOf = (result: AtmLayoutImportResultDto, code: string) =>
  result.rows.find((r) => r.code === code);

const fullListRow = (
  code: string,
  denominations: number[],
  extra: Partial<MasterRow> = {},
): MasterRow => ({
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
  ALPHA = await post('/platform/branches', {
    code: '91',
    name: { ar: 'فرع ألفا', en: 'SYN Alpha' },
  });
  BETA = await post('/platform/branches', { code: '92', name: { ar: 'فرع بيتا', en: 'SYN Beta' } });
  const alphaDept = await post('/platform/departments', {
    code: 'SET-A-OPS',
    name: { ar: 'التسويات', en: 'Settlements' },
    branchId: ALPHA,
  });

  const role = async (name: string, keys: string[]): Promise<string> =>
    String(
      (
        await rbacService.createRole(
          { name: { en: name, ar: name }, permissionKeys: keys },
          adminId,
        )
      )._id,
    );
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
    {
      name: 'alphaSettle',
      grants: [{ keys: [...LAYOUT_KEYS, ...PLAN_KEYS], scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    {
      name: 'alphaPrep',
      grants: [{ keys: PREP_KEYS, scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    {
      name: 'alphaCtl',
      grants: [{ keys: [...CONTROL_KEYS, 'atmMap.view'], scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    {
      name: 'alphaCtlNoMap',
      grants: [{ keys: CONTROL_KEYS, scope: 'branch' }],
      placement: { branchId: ALPHA },
    },
    {
      name: 'alphaCtlOwnMap',
      grants: [
        { keys: CONTROL_KEYS, scope: 'branch' },
        { keys: ['atmMap.view'], scope: 'own' },
      ],
      placement: { branchId: ALPHA },
    },
    {
      name: 'betaPrep',
      grants: [{ keys: PREP_KEYS, scope: 'branch' }],
      placement: { branchId: BETA },
    },
    {
      name: 'deptView',
      grants: [{ keys: ['atmSettlementPlan.view'], scope: 'department' }],
      placement: { branchId: ALPHA, departmentId: alphaDept },
    },
    {
      name: 'deptManage',
      grants: [
        { keys: ['atmSettlementPlan.view', 'atmSettlementPlan.manage'], scope: 'department' },
      ],
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
          keys: [
            'atmSettlementPlan.view',
            'atmCassetteLayout.view',
            'atmPreparation.view',
            'atmControl.view',
          ],
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
      await rbacService.ensureAssignment(
        id,
        await role(`${user.name}-${String(i)}`, grant.keys),
        grant.scope,
      );
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
    {
      branchId: oid(ALPHA),
      name: 'قطاع اختبار 1',
      color: '#483bba',
      order: 0,
      points: square(30.0, 31.0, 0.01),
    },
    {
      branchId: oid(ALPHA),
      name: 'قطاع اختبار 2',
      color: '#1f8a4c',
      order: 1,
      points: square(30.005, 31.005, 0.01),
    },
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

const HOOK_POINTS: SettlementHookPoint[] = [
  'layoutImport.afterRunInsert',
  'layoutImport.beforeRow',
  'plan.add.beforeWrite',
  'plan.update.beforeWrite',
  'plan.issue.beforeWrite',
  'plan.reopen.beforeWrite',
  'print.notes.beforeWrite',
  'preparation.save.beforeWrite',
  'preparation.prepared.beforeWrite',
  'control.assign.beforeWrite',
  'control.zones.beforeWrite',
];

afterEach(() => {
  for (const point of HOOK_POINTS) setSettlementHookForTests(point, null);
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
    const res = await call(
      'get',
      `/atm/settlements/plans?bankCode=BRK&date=${day(1)}`,
      'orgSettle',
    );
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

// ── 3–5. The Full list import ───────────────────────────────────────────────────────────────────

describe('3–5. the Full list seed import (S-1, §5)', () => {
  const LABELS = {
    typeLabel: 'BRK (S2)',
    featuresLabel: 'Withdrawall',
    hubLabel: 'منطقة تجريبية 1',
  };
  const OLD = [W(1, 200), W(2, 100), W(3, 50), EMPTY(4)];
  let book: Buffer;
  let preview: AtmLayoutImportResultDto;

  /** A layout as an earlier import (or a person) left it — written directly, revision 1. */
  const directLayout = async (
    key: string,
    slots: AtmCassetteSlot[],
    source: 'import' | 'manual',
  ): Promise<void> => {
    const machineId = oid(machine[key] ?? '');
    const now = new Date();
    const [layout] = await AtmCassetteLayoutModel.create([
      {
        machineId,
        branchId: oid(ALPHA),
        slots,
        ...LABELS,
        standardLoadId: null,
        revision: 1,
        source,
        changedByName: null,
        changedAt: now,
      },
    ]);
    await AtmCassetteLayoutVersionModel.create([
      {
        layoutId: layout?._id,
        machineId,
        branchId: oid(ALPHA),
        revision: 1,
        slots,
        ...LABELS,
        standardLoadId: null,
        source,
        reason: null,
        importRunId: null,
        changedBy: oid(adminId),
        changedByName: null,
        changedAt: now,
      },
    ]);
  };

  const layoutOf = async (key: string) =>
    AtmCassetteLayoutModel.findOne({ machineId: oid(machine[key] ?? ''), isDeleted: false })
      .lean()
      .exec();

  beforeAll(async () => {
    for (const n of [
      '01',
      '02',
      '03',
      '04',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
    ]) {
      await brkMachine(`I${n}`, `BRKN92${n}`);
    }
    machine.I05 = await addMachine(ALPHA, 'BRKN9205', { isActive: false });
    await addEntry(machine.I05, ALPHA, 'BRKN9205', 'BRK');
    machine.I06 = await addMachine(ALPHA, 'BRKN9206');
    machine.I07 = await addMachine(ALPHA, 'BRKN9207');
    await addEntry(machine.I07, ALPHA, 'BRKN9207', 'BM');
    await directLayout('I02', OLD, 'import');
    await directLayout('I03', OLD, 'import');
    await directLayout('I04', OLD, 'manual');
    book = await buildMasterWorkbook({
      fullList: [
        fullListRow('BRKN9201', [200, 200, 100, 50]), // new
        fullListRow('BRKN9202', [200, 100, 50, 0]), // same
        fullListRow('BRKN9203', [200, 200, 100, 50]), // changed (an import's layout)
        fullListRow('BRKN9204', [200, 200, 100, 50]), // changedManual
        fullListRow('BRKN9205', [200, 200, 100, 50]), // archived
        fullListRow('BRKN9206', [200, 200, 100, 50]), // noRegisterBank
        fullListRow('BRKN9207', [200, 200, 100, 50]), // otherBank
        fullListRow('BRKN9299', [200, 200, 100, 50]), // notFound
        fullListRow('BRKN9208', [200, 100, 50, 20]), // duplicateInFile ×2
        fullListRow('BRKN9208', [200, 100, 50, 20]),
        fullListRow('BRKN9209', [200, 30, 100, 50]), // invalid: 30 is no EGP note
        fullListRow('BRKN9210', [200, 200, 100, 50], { bank: 'B'.repeat(61) }), // invalid: labelTooLong
        fullListRow('BRKN9101', [200, 200, 100, 50]), // a Beta machine → notFound here
        fullListRow('BRKN9213', [0, 50, 100, 200], { help: '200-100-50' }), // new, reversed
      ],
      standardRows: [
        [1_050_000, 4000, 2000, 1000], // D = 200·E + 100·F + 50·G → new
        [999, 100, 100, 100], // D disagrees → mismatch
      ],
    });
  });

  it('3 — a preview: one row per outcome, the flags, the machines the file misses; nothing written', async () => {
    preview = await previewOf(book);
    expect(preview.applied).toBe(false);
    expect(preview.applyCounts).toBeNull();
    expect(preview.counts).toEqual({
      invalid: 2,
      duplicateInFile: 2,
      notFound: 2,
      archived: 1,
      noRegisterBank: 1,
      otherBank: 1,
      new: 2,
      same: 1,
      changed: 1,
      changedManual: 1,
    });
    expect(importRowOf(preview, 'BRKN9206')).toMatchObject({
      outcome: 'noRegisterBank',
      bankName: 'SYN BANK',
    });
    expect(importRowOf(preview, 'BRKN9203')).toMatchObject({
      outcome: 'changed',
      revision: 1,
      before: OLD,
    });
    expect(importRowOf(preview, 'BRKN9204')).toMatchObject({
      outcome: 'changedManual',
      revision: 1,
    });
    const reversed = importRowOf(preview, 'BRKN9213');
    expect(reversed?.flags).toEqual(expect.arrayContaining(['reversedOrder', 'helpOrderOpposite']));
    expect(reversed?.flags).not.toContain('helpDisagrees');
    expect(reversed?.after?.[0]).toEqual(EMPTY(1));
    const tooLong = importRowOf(preview, 'BRKN9210');
    expect(tooLong).toMatchObject({ outcome: 'invalid', typeLabel: { after: null } });
    expect(tooLong?.flags).toContain('labelTooLong');
    expect(preview.flags.labelTooLong).toBe(1);
    const missing = preview.missingFromFile.map((m) => m.machineCode);
    expect(missing).toContain('BRKN9211');
    expect(missing).not.toContain('BRKN9201');
    expect(missing).not.toContain('BRKN9052'); // two banks: not the bank's machine
    expect(preview.standardLoads).toEqual([
      {
        row: 1,
        outcome: 'new',
        notes: [
          { denomination: 200, notes: 4000 },
          { denomination: 100, notes: 2000 },
          { denomination: 50, notes: 1000 },
        ],
      },
      expect.objectContaining({ row: 2, outcome: 'mismatch' }),
    ]);
    // A preview writes nothing at all.
    expect(await AtmLayoutImportRunModel.countDocuments({})).toBe(0);
    expect(await auditsOf({ action: 'atmLayoutImport' })).toHaveLength(0);
    expect(await layoutOf('I01')).toBeNull();
  });

  it('4 — apply refusals: another file, no mode; an apply that is not exactly "true" is a preview', async () => {
    const wrong = await importBook(
      'alphaSettle',
      book,
      applyFields(preview, 'newOnly', { fileSha256: 'f'.repeat(64) }),
    );
    expect(wrong.status).toBe(409);
    expect(errorCode(wrong)).toBe('ATM_LAYOUT_IMPORT_FILE_CHANGED');
    const noMode = await importBook(
      'alphaSettle',
      book,
      importFields({
        apply: 'true',
        fileSha256: preview.fileSha256,
        previewRevisions: previewRevisionsOf(preview),
      }),
    );
    expect(noMode.status).toBe(400);
    const yes = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', book, applyFields(preview, 'newOnly', { apply: 'yes' })),
    );
    expect(yes.applied).toBe(false);
    expect(await AtmLayoutImportRunModel.countDocuments({})).toBe(0);
  });

  it('4 — newOnly writes the new rows only, each with its version row and audit, and the standard loads', async () => {
    const applied = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', book, applyFields(preview, 'newOnly', { standardLoads: 'true' })),
    );
    expect(applied.applied).toBe(true);
    expect(applied.applyCounts).toEqual({
      created: 2,
      updated: 0,
      standardLoadsCreated: 1,
      conflicts: 0,
    });
    expect(importRowOf(applied, 'BRKN9201')?.outcome).toBe('same');
    expect(importRowOf(applied, 'BRKN9203')?.outcome).toBe('changed');
    expect(await layoutOf('I01')).toMatchObject({ revision: 1, source: 'import' });
    expect(await layoutOf('I03')).toMatchObject({ revision: 1, slots: OLD });

    const run = await AtmLayoutImportRunModel.findOne({ branchId: oid(ALPHA) })
      .lean()
      .exec();
    expect(run).toMatchObject({ state: 'done', mode: 'newOnly', standardLoads: true });
    expect(run?.counts).toMatchObject({
      created: 2,
      updated: 0,
      conflicts: 0,
      standardLoadsCreated: 1,
      new: 2,
    });
    const versions = await AtmCassetteLayoutVersionModel.find({ machineId: oid(machine.I01 ?? '') })
      .lean()
      .exec();
    expect(versions).toEqual([
      expect.objectContaining({ revision: 1, source: 'import', importRunId: run?._id }),
    ]);
    const runAudits = await auditsOf({ action: 'atmLayoutImport' });
    expect(runAudits).toHaveLength(1);
    expect(runAudits[0]?.entityRef).toMatchObject({
      entityType: 'layoutImport',
      entityId: String(run?._id),
    });
    for (const key of ['I01', 'I13']) {
      expect(
        await auditsOf({
          'entityRef.entityType': 'cassetteLayout',
          'entityRef.entityId': machine[key],
          action: 'create',
        }),
      ).toHaveLength(1);
    }

    // REP. TAPE row 1 became the default profile; the mismatched row 2 did not become one.
    const loads = await AtmStandardLoadModel.find({
      branchId: oid(ALPHA),
      bankCode: 'BRK',
      isDeleted: false,
    })
      .lean()
      .exec();
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ isDefault: true, label: null });
    expect(loads[0]?.notes.map((n) => [n.denomination, n.notes])).toEqual([
      [200, 4000],
      [100, 2000],
      [50, 1000],
    ]);
    expect(
      await auditsOf({
        'entityRef.entityType': 'standardLoad',
        'entityRef.entityId': String(loads[0]?._id),
        action: 'create',
      }),
    ).toHaveLength(1);
  });

  it("4 — newAndChanged updates an import's layout and leaves a hand correction alone", async () => {
    const second = await previewOf(book);
    const applied = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', book, applyFields(second, 'newAndChanged')),
    );
    expect(applied.applyCounts).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    expect(await layoutOf('I03')).toMatchObject({ revision: 2, source: 'import', slots: STD4 });
    expect(await layoutOf('I04')).toMatchObject({ revision: 1, source: 'manual', slots: OLD });
    expect(importRowOf(applied, 'BRKN9204')?.outcome).toBe('changedManual');
  });

  it('4 — overwriteManual replaces the hand correction; a second apply finds everything the same', async () => {
    const third = await previewOf(book);
    const applied = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', book, applyFields(third, 'overwriteManual')),
    );
    expect(applied.applyCounts).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    expect(await layoutOf('I04')).toMatchObject({ revision: 2, source: 'import', slots: STD4 });

    const versionsBefore = await AtmCassetteLayoutVersionModel.countDocuments({});
    const fourth = await previewOf(book);
    expect(fourth.counts).toMatchObject({ new: 0, changed: 0, changedManual: 0, same: 5 });
    expect(fourth.standardLoads[0]?.outcome).toBe('same');
    const again = await okData<AtmLayoutImportResultDto>(
      importBook(
        'alphaSettle',
        book,
        applyFields(fourth, 'overwriteManual', { standardLoads: 'true' }),
      ),
    );
    expect(again.applyCounts).toEqual({
      created: 0,
      updated: 0,
      standardLoadsCreated: 0,
      conflicts: 0,
    });
    expect(await AtmCassetteLayoutVersionModel.countDocuments({})).toBe(versionsBefore);
  });

  it('4 — a layout saved by hand after the preview is a conflict, and the hand save stands', async () => {
    const solo = await buildMasterWorkbook({
      fullList: [fullListRow('BRKN9212', [200, 200, 100, 50])],
    });
    const before = await previewOf(solo);
    expect(importRowOf(before, 'BRKN9212')).toMatchObject({ outcome: 'new', revision: null });
    await okData(putLayout('alphaSettle', machine.I12 ?? '', OLD));
    const applied = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', solo, applyFields(before, 'overwriteManual')),
    );
    expect(applied.applyCounts).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(await layoutOf('I12')).toMatchObject({ revision: 1, source: 'manual', slots: OLD });
  });

  it('4 — two applies at once: the second meets the lock; a run left running too long is taken over (interleaved)', async () => {
    const solo = await buildMasterWorkbook({
      fullList: [fullListRow('BRKN9214', [200, 200, 100, 50])],
    });
    const before = await previewOf(solo);
    let second: request.Response | undefined;
    setSettlementHookForTests('layoutImport.afterRunInsert', async () => {
      second = await importBook('alphaSettle', solo, applyFields(before, 'newOnly'));
    });
    const first = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', solo, applyFields(before, 'newOnly')),
    );
    expect(first.applyCounts?.created).toBe(1);
    expect(second?.status).toBe(409);
    expect(second === undefined ? '' : errorCode(second)).toBe('ATM_LAYOUT_IMPORT_RUNNING');

    const [stale] = await AtmLayoutImportRunModel.create([
      {
        branchId: oid(ALPHA),
        bankCode: 'BRK',
        fileName: 'stale.xlsx',
        fileSha256: '0'.repeat(64),
        state: 'running',
        startedAt: new Date(Date.now() - STALE_RUN_MS - 60_000),
        mode: 'newOnly',
        standardLoads: false,
        counts: {},
      },
    ]);
    const again = await previewOf(solo);
    await okData(importBook('alphaSettle', solo, applyFields(again, 'newOnly')));
    expect((await AtmLayoutImportRunModel.findById(stale?._id).lean().exec())?.state).toBe(
      'abandoned',
    );
  });

  it('4 — a duplicate key mid-apply is a conflict of that row only; the other rows are written (interleaved)', async () => {
    const pair = await buildMasterWorkbook({
      fullList: [
        fullListRow('BRKN9215', [200, 200, 100, 50]),
        fullListRow('BRKN9216', [200, 200, 100, 50]),
      ],
    });
    const before = await previewOf(pair);
    setSettlementHookForTests('layoutImport.beforeRow', async () => {
      await okData(putLayout('alphaSettle', machine.I15 ?? '', OLD));
    });
    const applied = await okData<AtmLayoutImportResultDto>(
      importBook('alphaSettle', pair, applyFields(before, 'newOnly')),
    );
    expect(applied.applyCounts).toMatchObject({ created: 1, updated: 0, conflicts: 1 });
    expect(await layoutOf('I15')).toMatchObject({ source: 'manual', slots: OLD });
    expect(await layoutOf('I16')).toMatchObject({ source: 'import', revision: 1 });
  });

  it("5 — the import works in the page's branch: another branch, the runs of the caller's branch, a key not held", async () => {
    const other = await importBook('alphaSettle', book, importFields({ branchId: BETA }));
    expect(other.status).toBe(400);
    expect(detailCodes(other)).toContain('BRANCH_MISMATCH');
    expect(importRowOf(preview, 'BRKN9101')?.outcome).toBe('notFound');

    await AtmLayoutImportRunModel.create([
      {
        branchId: oid(BETA),
        bankCode: 'BRK',
        fileName: 'beta.xlsx',
        fileSha256: '1'.repeat(64),
        state: 'done',
        startedAt: new Date(),
        finishedAt: new Date(),
        mode: 'newOnly',
        standardLoads: false,
        counts: { betaOnly: 1 },
      },
    ]);
    const alphaRuns = await okData<AtmLayoutImportRunSummaryDto[]>(
      call('get', '/atm/settlements/layouts/import/runs?bankCode=BRK', 'alphaSettle'),
    );
    expect(alphaRuns.length).toBe(
      Math.min(10, await AtmLayoutImportRunModel.countDocuments({ branchId: oid(ALPHA) })),
    );
    expect(alphaRuns.some((r) => 'betaOnly' in r.counts)).toBe(false);
    const betaRuns = await okData<AtmLayoutImportRunSummaryDto[]>(
      call(
        'get',
        '/atm/settlements/layouts/import/runs?bankCode=BRK',
        'orgSettle',
        undefined,
        BETA,
      ),
    );
    expect(betaRuns.map((r) => r.counts)).toEqual([{ betaOnly: 1 }]);
    const out = await call(
      'get',
      `/atm/settlements/layouts/import/runs?bankCode=BRK&branchId=${BETA}`,
      'alphaSettle',
    );
    expect(out.status).toBe(400);
    expect(detailCodes(out)).toEqual(['OUT_OF_REACH']);
    expect((await importBook('noKeys', book, importFields())).status).toBe(403);
  });

  it('5 — the upload cap bounds the text fields too: one too large, or too many, is 422 TOO_LARGE (SEC-5)', async () => {
    // busboy alone would buffer up to 1 MB a field and any number of fields before the schema ran.
    const tooLarge = await importBook(
      'alphaSettle',
      book,
      importFields({ previewRevisions: 'x'.repeat(300 * 1024) }),
    );
    expect(tooLarge.status, JSON.stringify(tooLarge.body).slice(0, 300)).toBe(422);
    expect(detailCodes(tooLarge)).toEqual(['TOO_LARGE']);
    const pads = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`pad${String(i)}`, 'x'] as const),
    );
    const tooMany = await importBook('alphaSettle', book, importFields(pads));
    expect(tooMany.status, JSON.stringify(tooMany.body).slice(0, 300)).toBe(422);
    expect(detailCodes(tooMany)).toEqual(['TOO_LARGE']);
    // What the page sends (an apply carries seven fields) stays inside the cap.
    expect((await importBook('alphaSettle', book, importFields())).status).toBe(200);
  });
});

// ── 6. Layout save ──────────────────────────────────────────────────────────────────────────────

describe('6. a layout saved by hand (§6.4 S5, S6)', () => {
  const REASON = 'تغيير الفئات من البنك';

  beforeAll(async () => {
    await brkMachine('L1', 'BRKN9301');
    await brkMachine('L2', 'BRKN9302');
  });

  it('creates once, updates on its version, refuses a bad shape', async () => {
    const created = await okData<AtmCassetteLayoutDetailDto>(
      putLayout('alphaSettle', machine.L1 ?? '', STD4, { typeLabel: 'BRK (S2)' }),
    );
    expect(created.layout).toMatchObject({
      revision: 1,
      version: 0,
      source: 'manual',
      typeLabel: 'BRK (S2)',
    });
    const twice = await putLayout('alphaSettle', machine.L1 ?? '', STD4);
    expect(twice.status).toBe(409);
    expect(errorCode(twice)).toBe('STALE_DOCUMENT');

    const updated = await okData<AtmCassetteLayoutDetailDto>(
      putLayout('alphaSettle', machine.L1 ?? '', [W(1, 200), W(2, 100), W(3, 50), W(4, 20)], {
        version: 0,
        reason: REASON,
      }),
    );
    expect(updated.layout).toMatchObject({ revision: 2, version: 1 });
    const stale = await putLayout('alphaSettle', machine.L1 ?? '', STD4, { version: 0 });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('STALE_DOCUMENT');

    const three = await putLayout(
      'alphaSettle',
      machine.L1 ?? '',
      [W(1, 200), W(2, 100), W(3, 50)],
      {
        version: 1,
      },
    );
    expect(three.status).toBe(400);
    expect(detailsOf(three).map((d) => d.message)).toContain('SLOT_COUNT');
    const control = await putLayout('alphaSettle', machine.L1 ?? '', STD4, {
      version: 1,
      typeLabel: 'BRK\u0007',
    });
    expect(control.status).toBe(400);
    expect((await layoutDetail('alphaSettle', machine.L1 ?? '')).layout?.revision).toBe(2);
  });

  it("a profile of another bank is refused; another branch's machine is not there", async () => {
    const [bm] = await AtmStandardLoadModel.create([
      {
        branchId: oid(ALPHA),
        bankCode: 'BM',
        label: null,
        isDefault: false,
        order: 0,
        notes: [{ denomination: 200, notes: 1000 }],
      },
    ]);
    const res = await putLayout('alphaSettle', machine.L2 ?? '', STD4, {
      standardLoadId: String(bm?._id),
    });
    expect(res.status).toBe(400);
    expect(detailCodes(res)).toEqual(['STANDARD_LOAD_OTHER_BANK']);
    expect((await putLayout('alphaSettle', machine.B1 ?? '', STD4)).status).toBe(404);
    expect(
      (await call('get', `/atm/settlements/layouts/${machine.B1 ?? ''}`, 'alphaSettle')).status,
    ).toBe(404);
  });

  it('the detail lists every version, newest first, and the live lines it affects', async () => {
    const plan = await createPlan(day(30));
    await addOk(plan.id, 1, [{ machineCode: 'BRKN9301', scheduleTime: '21:00' }]);
    const detail = await layoutDetail('alphaSettle', machine.L1 ?? '');
    expect(detail.versions.map((v) => v.revision)).toEqual([2, 1]);
    expect(detail.versions[0]).toMatchObject({ source: 'manual', reason: REASON });
    expect(detail.affectedLines).toEqual([
      expect.objectContaining({
        planId: plan.id,
        replenishDate: day(30),
        status: 'draft',
        run: 1,
        serial: null,
      }),
    ]);
    const audits = await auditsOf({
      'entityRef.entityType': 'cassetteLayout',
      'entityRef.entityId': machine.L1,
    });
    expect(audits.map((a) => a.action)).toEqual(['create', 'update']);
    expect(audits[1]?.changes).toContainEqual(
      expect.objectContaining({ field: 'reason', new: REASON }),
    );
    // The list shows the bank's machines with their layouts.
    const list = await okData<AtmCassetteLayoutsDto>(
      call('get', '/atm/settlements/layouts?bankCode=BRK', 'alphaSettle'),
    );
    expect(list.rows.find((r) => r.machineCode === 'BRKN9301')?.layout?.revision).toBe(2);
    expect(list.rows.find((r) => r.machineCode === 'BRKN9002')?.flags).toEqual(['noLayout']);
    expect(
      list.rows.some((r) => r.machineCode === 'BRKN9101' || r.machineCode === 'BRKN9050'),
    ).toBe(false);
  });
});

// ── 7. Standard loads ───────────────────────────────────────────────────────────────────────────

describe('7. standard loads (§6.4 S7–S10)', () => {
  const postLoad = (body: Record<string, unknown>, as = 'alphaSettle'): request.Test =>
    call('post', '/atm/settlements/standard-loads', as, {
      branchId: ALPHA,
      bankCode: 'BRK',
      ...body,
    });
  const listLoads = async (): Promise<AtmStandardLoadDto[]> =>
    okData<AtmStandardLoadDto[]>(
      call('get', '/atm/settlements/standard-loads?bankCode=BRK', 'alphaSettle'),
    );

  beforeAll(async () => {
    await brkMachine('S1', 'BRKN9310');
  });

  it('a second default clears the first, with an audit on each', async () => {
    const previous = (await listLoads()).find((l) => l.isDefault);
    expect(previous).toBeDefined();
    const created = await okData<AtmStandardLoadDto>(
      postLoad({
        label: 'حمولة اختبار 1',
        isDefault: true,
        notes: [
          { denomination: 200, notes: 3000 },
          { denomination: 100, notes: 1000 },
        ],
      }),
    );
    expect(created).toMatchObject({
      isDefault: true,
      egpTotalMinor: (3000 * 200 + 1000 * 100) * 100,
    });
    expect((await listLoads()).filter((l) => l.isDefault).map((l) => l.id)).toEqual([created.id]);
    const cleared = await auditsOf({
      'entityRef.entityType': 'standardLoad',
      'entityRef.entityId': previous?.id,
      action: 'update',
    });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.changes).toContainEqual(
      expect.objectContaining({ field: 'isDefault', old: true, new: false }),
    );
    expect(
      await auditsOf({
        'entityRef.entityType': 'standardLoad',
        'entityRef.entityId': created.id,
        action: 'create',
      }),
    ).toHaveLength(1);
  });

  it('a profile in use by a layout or a draft line is not deleted; an unused one is', async () => {
    const used = await okData<AtmStandardLoadDto>(
      postLoad({
        label: 'حمولة اختبار 2',
        isDefault: false,
        notes: [{ denomination: 200, notes: 1000 }],
      }),
    );
    await okData(putLayout('alphaSettle', machine.S1 ?? '', STD4, { standardLoadId: used.id }));
    const plan = await createPlan(day(31));
    const added = await addOk(plan.id, 1, [{ machineCode: 'BRKN9310', scheduleTime: null }]);
    expect(added.added[0]?.standardLoadId).toBe(used.id);
    const res = await call(
      'delete',
      `/atm/settlements/standard-loads/${used.id}?version=${String(used.version)}`,
      'alphaSettle',
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_STANDARD_LOAD_IN_USE');
    expect(detailsOf(res)).toEqual([
      expect.objectContaining({ field: 'layouts', message: '1' }),
      expect.objectContaining({ field: 'draftLines', message: '1' }),
    ]);

    const unused = await okData<AtmStandardLoadDto>(
      postLoad({
        label: 'حمولة اختبار 3',
        isDefault: false,
        notes: [{ denomination: 50, notes: 500 }],
      }),
    );
    const gone = await call(
      'delete',
      `/atm/settlements/standard-loads/${unused.id}?version=${String(unused.version)}`,
      'alphaSettle',
    );
    expect(gone.status).toBe(204);
    expect((await listLoads()).some((l) => l.id === unused.id)).toBe(false);
    expect(
      await auditsOf({
        'entityRef.entityType': 'standardLoad',
        'entityRef.entityId': unused.id,
        action: 'delete',
      }),
    ).toHaveLength(1);
  });

  it("a body branch other than the page's is refused; a plan-only user reads the profiles", async () => {
    const res = await postLoad({
      branchId: BETA,
      label: null,
      isDefault: false,
      notes: [{ denomination: 200, notes: 100 }],
    });
    expect(res.status).toBe(400);
    expect(detailCodes(res)).toEqual(['BRANCH_MISMATCH']);
    const viewer = await okData<AtmStandardLoadDto[]>(
      call('get', '/atm/settlements/standard-loads?bankCode=BRK', 'alphaPlanViewer'),
    );
    expect(viewer.map((l) => l.id).sort()).toEqual((await listLoads()).map((l) => l.id).sort());
  });
});

// ── 8. Plan create ──────────────────────────────────────────────────────────────────────────────

describe('8. plan create (§6.5 S12, DS-1, DS-22)', () => {
  it('one plan per branch × bank × day; a body branch is checked, never trusted', async () => {
    const plan = await createPlan(day(2));
    expect(plan).toMatchObject({
      branchId: ALPHA,
      bankCode: 'BRK',
      replenishDate: day(2),
      lines: [],
    });
    const twice = await call('post', '/atm/settlements/plans', 'alphaSettle', {
      bankCode: 'BRK',
      replenishDate: day(2),
      branchId: ALPHA,
    });
    expect(twice.status).toBe(409);
    expect(errorCode(twice)).toBe('ATM_PLAN_EXISTS');
    expect(detailsOf(twice)[0]?.message).toBe(plan.id);

    const beta = await call('post', '/atm/settlements/plans', 'alphaSettle', {
      bankCode: 'BRK',
      replenishDate: day(20),
      branchId: BETA,
    });
    expect(beta.status).toBe(400);
    expect(detailCodes(beta)).toEqual(['BRANCH_MISMATCH']);
    // The top bar cannot widen a branch user's reach: the work branch stays Alpha.
    const header = await call(
      'post',
      '/atm/settlements/plans',
      'alphaSettle',
      { bankCode: 'BRK', replenishDate: day(20), branchId: BETA },
      BETA,
    );
    expect(header.status).toBe(400);
    const out = await call(
      'get',
      `/atm/settlements/plans?bankCode=BRK&date=${day(2)}&branchId=${BETA}`,
      'alphaSettle',
    );
    expect(out.status).toBe(400);
    expect(detailCodes(out)).toEqual(['OUT_OF_REACH']);
    const byDay = await okData<{ plan: AtmSettlementPlanDto | null }>(
      call('get', `/atm/settlements/plans?bankCode=BRK&date=${day(2)}`, 'alphaSettle'),
    );
    expect(byDay.plan?.id).toBe(plan.id);
    expect(
      await auditsOf({
        'entityRef.entityType': 'settlementPlan',
        'entityRef.entityId': plan.id,
        action: 'create',
      }),
    ).toHaveLength(1);
  });

  it("a department grant reads its branch's plan and never writes; own scope reads nothing", async () => {
    const plan = await okData<{ plan: AtmSettlementPlanDto | null }>(
      call('get', `/atm/settlements/plans?bankCode=BRK&date=${day(2)}`, 'alphaSettle'),
    );
    const id = plan.plan?.id ?? '';
    const read = await okData<AtmSettlementPlanDto>(
      call('get', `/atm/settlements/plans/${id}`, 'deptView'),
    );
    expect(read.can).toEqual({ manage: false, print: false, export: false });
    const body = { bankCode: 'BRK', replenishDate: day(21), branchId: ALPHA };
    expect((await call('post', '/atm/settlements/plans', 'deptView', body)).status).toBe(403);
    expect((await call('post', '/atm/settlements/plans', 'deptManage', body)).status).toBe(403);
    expect(
      (await addLines(id, 1, [{ machineCode: 'BRKN9001', scheduleTime: null }], 'deptManage'))
        .status,
    ).toBe(403);
    expect((await call('get', `/atm/settlements/plans/${id}`, 'ownView')).status).toBe(404);
  });
});

// ── 9. Adding lines ─────────────────────────────────────────────────────────────────────────────

/** The plan pages' standard loads (created in 9's setup): the bank default and a second one. */
const PROFILE: Record<'def' | 'alt', string> = { def: '', alt: '' };
const STD_NOTES = [
  { denomination: 200, notes: 4000 },
  { denomination: 100, notes: 2000 },
  { denomination: 50, notes: 1000 },
];
const egp = (pairs: [number, number][]): number =>
  pairs.reduce((sum, [notes, denomination]) => sum + notes * denomination * 100, 0);

describe('9. adding lines (§6.5 S14)', () => {
  let planId = '';

  beforeAll(async () => {
    const post = async (
      label: string,
      isDefault: boolean,
      notes: typeof STD_NOTES,
    ): Promise<string> =>
      (
        await okData<AtmStandardLoadDto>(
          call('post', '/atm/settlements/standard-loads', 'alphaSettle', {
            branchId: ALPHA,
            bankCode: 'BRK',
            label,
            isDefault,
            notes,
          }),
        )
      ).id;
    PROFILE.def = await post('حمولة أ', true, STD_NOTES);
    PROFILE.alt = await post('حمولة ب', false, [
      { denomination: 200, notes: 2000 },
      { denomination: 100, notes: 1000 },
      { denomination: 50, notes: 600 },
    ]);
    const labels = { typeLabel: 'BRK (S2)', hubLabel: 'منطقة تجريبية 1' };
    for (const key of ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'ABM', 'ATWO', 'ANOREG']) {
      await okData(putLayout('alphaSettle', machine[key] ?? '', STD4, labels));
    }
    await okData(
      putLayout('alphaSettle', machine.A2 ?? '', STD4, { ...labels, standardLoadId: PROFILE.alt }),
    );
    await okData(
      putLayout('alphaSettle', machine.ASIX ?? '', [
        W(1, 200),
        W(2, 200),
        W(3, 100),
        W(4, 100),
        W(5, 50),
        W(6, 50),
      ]),
    );
    await okData(
      putLayout('alphaSettle', machine.ADEP ?? '', [
        W(1, 200),
        W(2, 100),
        DEPOSIT(3),
        W(4, 100, 'USD'),
      ]),
    );
    await okData(
      putLayout('alphaSettle', machine.A20 ?? '', [W(1, 200), W(2, 100), W(3, 50), W(4, 20)]),
    );
    await okData(
      putLayout('alphaSettle', machine.ADEPONLY ?? '', [
        DEPOSIT(1),
        DEPOSIT(2),
        EMPTY(3),
        EMPTY(4),
      ]),
    );
    await okData(putLayout('orgSettle', machine.B1 ?? '', STD4));
    planId = (await createPlan(day(3))).id;
  });

  it('refuses each row with its reason and adds the rest; counts come from the profile', async () => {
    const result = await addOk(planId, 1, [
      { machineCode: 'BRKN9001', scheduleTime: '21:00' },
      { machineCode: 'BRKN9002', scheduleTime: '9:00 PM' },
      { machineCode: 'BRKN9999', scheduleTime: null },
      { machineCode: 'BRKN9051', scheduleTime: null },
      { machineCode: 'BRKN9053', scheduleTime: null },
      { machineCode: 'BRKN9050', scheduleTime: null },
      { machineCode: 'BRKN9052', scheduleTime: null },
      { machineCode: 'BRKN9011', scheduleTime: null },
      { machineCode: 'BRKN9012', scheduleTime: null },
      { machineCode: 'BRKN9001', scheduleTime: null },
      { machineCode: 'BRKN9003', scheduleTime: '25:00' },
      { machineCode: 'BRKN9010', scheduleTime: null },
    ]);
    expect(result.refused).toEqual([
      { code: 'BRKN9999', reason: 'unknownCode' },
      { code: 'BRKN9051', reason: 'inactive' },
      { code: 'BRKN9053', reason: 'noRegisterBank' },
      { code: 'BRKN9050', reason: 'otherBank' },
      { code: 'BRKN9052', reason: 'otherBank' },
      { code: 'BRKN9011', reason: 'noLayout' },
      { code: 'BRKN9012', reason: 'noFillableSlot' },
      { code: 'BRKN9001', reason: 'duplicateInRequest' },
      { code: 'BRKN9003', reason: 'badTime' },
    ]);
    expect(result.added.map((l) => [l.machineCode, l.scheduleTime, l.status])).toEqual([
      ['BRKN9001', '21:00', 'draft'],
      ['BRKN9002', '21:00', 'draft'],
      ['BRKN9010', null, 'draft'],
    ]);
    const [def, alt, twenty] = result.added;
    // The bank default: the two 200 cassettes share the 200s equally.
    expect(def?.slots.map((s) => s.notes)).toEqual([2000, 2000, 2000, 1000]);
    expect(def).toMatchObject({
      countsSource: 'standard',
      standardLoadId: PROFILE.def,
      standardNotes: STD_NOTES,
    });
    expect(def?.egpTotalMinor).toBe(
      egp([
        [4000, 200],
        [2000, 100],
        [1000, 50],
      ]),
    );
    // The machine's own profile.
    expect(alt?.slots.map((s) => s.notes)).toEqual([1000, 1000, 1000, 600]);
    expect(alt?.standardLoadId).toBe(PROFILE.alt);
    // A 20 cassette the profile does not fill gets 0.
    expect(twenty?.slots.map((s) => s.notes)).toEqual([4000, 2000, 1000, 0]);
    expect(
      await auditsOf({
        'entityRef.entityType': 'planLine',
        'entityRef.entityId': def?.id,
        action: 'create',
      }),
    ).toHaveLength(1);
  });

  it('the same machine on another run is added; twice on one run is refused', async () => {
    const second = await addOk(planId, 2, [{ machineCode: 'BRKN9001', scheduleTime: '23:00' }]);
    expect(second.added.map((l) => [l.machineCode, l.run])).toEqual([['BRKN9001', 2]]);
    const again = await addOk(planId, 2, [{ machineCode: 'BRKN9001', scheduleTime: '23:30' }]);
    expect(again).toEqual({ added: [], refused: [{ code: 'BRKN9001', reason: 'duplicateInRun' }] });
  });

  it('two adds of one machine at once leave exactly one line (interleaved)', async () => {
    let inner: AtmPlanAddResultDto | undefined;
    setSettlementHookForTests('plan.add.beforeWrite', async () => {
      inner = await addOk(planId, 1, [{ machineCode: 'BRKN9004', scheduleTime: null }]);
    });
    const outer = await addOk(planId, 1, [{ machineCode: 'BRKN9004', scheduleTime: null }]);
    expect(inner?.added).toHaveLength(1);
    expect(outer).toEqual({ added: [], refused: [{ code: 'BRKN9004', reason: 'duplicateInRun' }] });
    expect(
      await AtmPlanLineModel.countDocuments({
        planId: oid(planId),
        machineId: oid(machine.A4 ?? ''),
        run: 1,
        isDeleted: false,
      }),
    ).toBe(1);
  });

  it('a PATCH moving a line into a run an add just took answers 409 (interleaved)', async () => {
    const line = (await addOk(planId, 1, [{ machineCode: 'BRKN9005', scheduleTime: '08:00' }]))
      .added[0];
    expect(line).toBeDefined();
    setSettlementHookForTests('plan.update.beforeWrite', async () => {
      await addOk(planId, 2, [{ machineCode: 'BRKN9005', scheduleTime: '20:00' }]);
    });
    const res = await patchLine(planId, line as AtmPlanLineDto, { run: 2 });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('STALE_DOCUMENT');
    const plan = await getPlan(planId);
    expect(lineOf(plan, 'BRKN9005', 1).id).toBe(line?.id);
    expect(lineOf(plan, 'BRKN9005', 2).scheduleTime).toBe('20:00');
    // Moving a line onto a run that is taken is refused before any write.
    const taken = await patchLine(planId, lineOf(plan, 'BRKN9005', 1), { run: 2 });
    expect(taken.status).toBe(422);
    expect(detailCodes(taken)).toEqual(['DUPLICATE_IN_RUN']);
  });

  it('a plan holds at most 400 lines: the 401st is refused and nothing is written', async () => {
    const full = await createPlan(day(40));
    await AtmPlanLineModel.insertMany(
      Array.from({ length: 400 }, (_, i) => ({
        planId: oid(full.id),
        branchId: oid(ALPHA),
        bankCode: 'BRK',
        replenishDate: day(40),
        kind: 'spare',
        typeLabel: 'BRK (S2)',
        run: 1,
        position: i + 1,
        status: 'draft',
        slots: [
          {
            slot: 1,
            kind: 'withdrawal',
            denomination: 200,
            currency: 'EGP',
            notes: 100,
            bag: null,
          },
        ],
        countsSource: 'manual',
        egpTotalMinor: egp([[100, 200]]),
      })),
    );
    const res = await addLines(full.id, 1, [{ machineCode: 'BRKN9006', scheduleTime: null }]);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ATM_PLAN_FULL');
    expect(await AtmPlanLineModel.countDocuments({ planId: oid(full.id) })).toBe(400);
    expect((await AtmReplenishmentPlanModel.findById(full.id).lean().exec())?.lastPosition).toBe(0);
  });
});

// ── 10. Editing a draft ─────────────────────────────────────────────────────────────────────────

describe('10. editing a draft (§6.5 S16, S17)', () => {
  let planId = '';

  beforeAll(async () => {
    planId = (
      await buildPlan(day(4), [
        {
          run: 1,
          rows: [
            ['BRKN9001', '21:00'],
            ['BRKN9009', '22:00'],
          ],
        },
      ])
    ).id;
  });

  it('notes override single slots; a typed denomination total is split evenly (S-4)', async () => {
    let line = lineOf(await getPlan(planId), 'BRKN9001');
    line = await okData<AtmPlanLineDto>(
      patchLine(planId, line, { notes: [{ slot: 4, notes: 1500 }] }),
    );
    expect(line.countsSource).toBe('manual');
    expect(line.slots.map((s) => s.notes)).toEqual([2000, 2000, 2000, 1500]);
    expect(line.egpTotalMinor).toBe(
      egp([
        [4000, 200],
        [2000, 100],
        [1500, 50],
      ]),
    );
    expect(line.issues.map((i) => i.code)).toContain('DIFFERS_FROM_STANDARD');
    line = await okData<AtmPlanLineDto>(
      patchLine(planId, line, { denominationNotes: [{ denomination: 200, notes: 5000 }] }),
    );
    expect(line.slots.map((s) => s.notes)).toEqual([2500, 2500, 2000, 1500]);
    expect(
      await auditsOf({
        'entityRef.entityType': 'planLine',
        'entityRef.entityId': line.id,
        action: 'update',
      }),
    ).toHaveLength(2);
  });

  it('only a planned slot of the line takes notes', async () => {
    const dep = lineOf(await getPlan(planId), 'BRKN9009');
    expect(dep.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['FOREIGN_CURRENCY_NOT_PLANNED', 'STANDARD_DENOMINATION_UNPLACED']),
    );
    for (const slot of [3, 4]) {
      const res = await patchLine(planId, dep, { notes: [{ slot, notes: 100 }] });
      expect(res.status, `slot ${String(slot)}`).toBe(400);
      expect(detailCodes(res)).toEqual(['SLOT_NOT_FILLABLE']);
    }
    const five = await patchLine(planId, dep, { notes: [{ slot: 5, notes: 100 }] });
    expect(five.status).toBe(400);
    expect(detailCodes(five)).toEqual(['UNKNOWN_SLOT']);
    expect((await patchLine(planId, dep, { notes: [{ slot: 9, notes: 100 }] })).status).toBe(400);
  });

  it('a typed total whose even split overfills a cassette is refused on its field; a spare too (MONEY-1)', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9001');
    // Two 200 cassettes: 300 000 would put 150 000 in each, over the per-cassette cap.
    const over = await patchLine(planId, line, {
      denominationNotes: [{ denomination: 200, notes: 300_000 }],
    });
    expect(over.status).toBe(400);
    expect(detailsOf(over)).toEqual([
      expect.objectContaining({
        field: 'body.denominationNotes.0.notes',
        code: 'CASSETTE_NOTES_MAX',
      }),
    ]);
    expect(lineOf(await getPlan(planId), 'BRKN9001')).toMatchObject({
      version: line.version,
      egpTotalMinor: line.egpTotalMinor,
    });
    const full = await okData<AtmPlanLineDto>(
      patchLine(planId, line, { denominationNotes: [{ denomination: 200, notes: 200_000 }] }),
    );
    expect(full.slots.filter((s) => s.denomination === 200).map((s) => s.notes)).toEqual([
      100_000, 100_000,
    ]);
    // A spare set with one 100 cassette: the same refusal, never a server error.
    const spare = await call(
      'post',
      `/atm/settlements/plans/${planId}/spare-lines`,
      'alphaSettle',
      {
        run: 1,
        scheduleTime: '09:00',
        spareCode: 'SP-T9',
        typeLabel: 'BRK (S2)',
        slots: [W(1, 100)],
        standardLoadId: null,
        denominationNotes: [{ denomination: 100, notes: 800_000 }],
      },
    );
    expect(spare.status, JSON.stringify(spare.body).slice(0, 300)).toBe(400);
    expect(detailsOf(spare)).toEqual([
      expect.objectContaining({
        field: 'body.denominationNotes.0.notes',
        code: 'CASSETTE_NOTES_MAX',
      }),
    ]);
    expect((await getPlan(planId)).lines.some((l) => l.kind === 'spare')).toBe(false);
  });

  it("refreshLayout takes the machine's new layout and refills from the line's profile", async () => {
    const before = await layoutDetail('alphaSettle', machine.A1 ?? '');
    await okData(
      putLayout('alphaSettle', machine.A1 ?? '', STD4, {
        version: before.layout?.version ?? 0,
        typeLabel: 'BRK (S9)',
        hubLabel: 'منطقة تجريبية 1',
      }),
    );
    const stale = lineOf(await getPlan(planId), 'BRKN9001');
    expect(stale.issues.map((i) => i.code)).toContain('LAYOUT_CHANGED');
    const refreshed = await okData<AtmPlanLineDto>(
      patchLine(planId, stale, { refreshLayout: true }),
    );
    expect(refreshed.issues.map((i) => i.code)).not.toContain('LAYOUT_CHANGED');
    expect(refreshed).toMatchObject({
      typeLabel: 'BRK (S9)',
      countsSource: 'standard',
      standardLoadId: PROFILE.def,
      layoutRevision: (before.layout?.revision ?? 0) + 1,
    });
    expect(refreshed.slots.map((s) => s.notes)).toEqual([2000, 2000, 2000, 1000]);
  });

  it('an issued line is not edited; a line is reached through its own plan only; a draft is deleted', async () => {
    await okData(issue(planId, [lineOf(await getPlan(planId), 'BRKN9001')]));
    const issued = lineOf(await getPlan(planId), 'BRKN9001');
    expect(issued.status).toBe('issued');
    const res = await patchLine(planId, issued, { scheduleTime: '20:00' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_PLAN_LINE_STATE');
    expect(
      (
        await call(
          'delete',
          `/atm/settlements/plans/${planId}/lines/${issued.id}?version=${String(issued.version)}`,
          'alphaSettle',
        )
      ).status,
    ).toBe(409);

    const dep = lineOf(await getPlan(planId), 'BRKN9009');
    const other = await createPlan(day(41));
    const wrong = await call(
      'patch',
      `/atm/settlements/plans/${other.id}/lines/${dep.id}`,
      'alphaSettle',
      {
        version: dep.version,
        scheduleTime: '20:00',
      },
    );
    expect(wrong.status).toBe(404);
    const removed = await call(
      'delete',
      `/atm/settlements/plans/${planId}/lines/${dep.id}?version=${String(dep.version)}`,
      'alphaSettle',
    );
    expect(removed.status).toBe(204);
    expect((await getPlan(planId)).lines.some((l) => l.id === dep.id)).toBe(false);
    expect(
      await auditsOf({
        'entityRef.entityType': 'planLine',
        'entityRef.entityId': dep.id,
        action: 'delete',
      }),
    ).toHaveLength(1);
  });

  it('refreshLayout follows the profile the layout points at now, unless one was chosen for the line (MONEY-2)', async () => {
    const code = 'BRKN9401';
    const id = await brkMachine('AREF', code);
    const labels = { typeLabel: 'BRK (S2)' };
    await okData(putLayout('alphaSettle', id, STD4, labels));
    const plan = await buildPlan(day(26), [{ run: 1, rows: [[code, '01:00']] }]);
    let line = lineOf(plan, code);
    // Added with the bank default (the layout names no profile yet).
    expect(line.standardLoadId).toBe(PROFILE.def);
    expect(line.slots.map((s) => s.notes)).toEqual([2000, 2000, 2000, 1000]);

    const save = async (typeLabel: string): Promise<void> => {
      const detail = await layoutDetail('alphaSettle', id);
      await okData(
        putLayout('alphaSettle', id, STD4, {
          version: detail.layout?.version ?? 0,
          typeLabel,
          standardLoadId: PROFILE.alt,
        }),
      );
    };
    // The machine moves to the other profile, and its type changes: «تحديث من فئات الماكينة».
    await save('BRK (S3)');
    line = lineOf(await getPlan(plan.id), code);
    expect(line.issues.map((i) => i.code)).toContain('LAYOUT_CHANGED');
    line = await okData<AtmPlanLineDto>(patchLine(plan.id, line, { refreshLayout: true }));
    expect(line).toMatchObject({
      standardLoadId: PROFILE.alt,
      countsSource: 'standard',
      typeLabel: 'BRK (S3)',
    });
    expect(line.slots.map((s) => s.notes)).toEqual([1000, 1000, 1000, 600]);
    expect(line.issues.map((i) => i.code)).not.toContain('LAYOUT_CHANGED');

    // A profile the user chose for the line survives the next refresh.
    line = await okData<AtmPlanLineDto>(patchLine(plan.id, line, { standardLoadId: PROFILE.def }));
    await save('BRK (S4)');
    line = await okData<AtmPlanLineDto>(
      patchLine(plan.id, lineOf(await getPlan(plan.id), code), { refreshLayout: true }),
    );
    expect(line).toMatchObject({ standardLoadId: PROFILE.def, typeLabel: 'BRK (S4)' });
    expect(line.slots.map((s) => s.notes)).toEqual([2000, 2000, 2000, 1000]);
    // «الافتراضية» (null) hands the line back to the layout's profile.
    line = await okData<AtmPlanLineDto>(patchLine(plan.id, line, { standardLoadId: null }));
    expect(line.standardLoadId).toBe(PROFILE.alt);
  });

  it('a layout save that only re-points its standard load raises neither layout warning (MONEY-3)', async () => {
    const code = 'BRKN9402';
    const id = await brkMachine('ASTD', code);
    const labels = { typeLabel: 'BRK (S2)', hubLabel: 'منطقة تجريبية 1' };
    await okData(putLayout('alphaSettle', id, STD4, labels));
    const plan = await buildPlan(day(29), [
      { run: 1, rows: [[code, '01:00']] },
      { run: 2, rows: [[code, '20:00']] },
    ]);
    await okData(issue(plan.id, [lineOf(plan, code, 1)]));
    const layoutCodes = async (run: 1 | 2): Promise<string[]> =>
      lineOf(await getPlan(plan.id), code, run)
        .issues.map((i) => i.code)
        .filter((c) => c.startsWith('LAYOUT_CHANGED'));

    let detail = await layoutDetail('alphaSettle', id);
    await okData(
      putLayout('alphaSettle', id, STD4, {
        ...labels,
        version: detail.layout?.version ?? 0,
        standardLoadId: PROFILE.alt,
      }),
    );
    detail = await layoutDetail('alphaSettle', id);
    // The change is kept in the layout's history all the same.
    expect(detail.layout).toMatchObject({ revision: 2, standardLoadId: PROFILE.alt });
    expect(detail.versions).toHaveLength(2);
    expect(await layoutCodes(1)).toEqual([]);
    expect(await layoutCodes(2)).toEqual([]);

    // FIT-3: the draft, filled from the bank's default, now offers the refresh to the layout's new
    // profile (STANDARD_LOAD_CHANGED); the issued line's counts are on its Note — nothing to offer.
    const loadCodes = async (run: 1 | 2): Promise<string[]> =>
      lineOf(await getPlan(plan.id), code, run)
        .issues.map((i) => i.code)
        .filter((c) => c === 'STANDARD_LOAD_CHANGED');
    expect(await loadCodes(2)).toEqual(['STANDARD_LOAD_CHANGED']);
    expect(await loadCodes(1)).toEqual([]);
    const refreshed = await okData<AtmPlanLineDto>(
      patchLine(plan.id, lineOf(await getPlan(plan.id), code, 2), { refreshLayout: true }),
    );
    expect(refreshed.standardLoadId).toBe(PROFILE.alt);
    expect(refreshed.issues.map((i) => i.code)).not.toContain('STANDARD_LOAD_CHANGED');

    // A label change still raises both.
    await okData(
      putLayout('alphaSettle', id, STD4, {
        ...labels,
        typeLabel: 'BRK (S5)',
        version: detail.layout?.version ?? 0,
        standardLoadId: PROFILE.alt,
      }),
    );
    expect(await layoutCodes(1)).toEqual(['LAYOUT_CHANGED_AFTER_ISSUE']);
    expect(await layoutCodes(2)).toEqual(['LAYOUT_CHANGED']);
  });
});

// ── 11. Issue ───────────────────────────────────────────────────────────────────────────────────

describe('11. issue — the running Note serials (§6.5 S18, DS-11)', () => {
  let planId = '';

  beforeAll(async () => {
    planId = (
      await buildPlan(day(5), [
        {
          run: 1,
          rows: [
            ['BRKN9001', '21:00'],
            ['BRKN9002', '08:00'],
            ['BRKN9003', null],
            ['BRKN9008', '08:00'],
          ],
        },
        { run: 2, rows: [['BRKN9001', '23:00']] },
        { run: 3, rows: [['BRKN9004', null]] },
      ])
    ).id;
  });

  it('an error blocks the whole issue and writes nothing', async () => {
    let plan = await getPlan(planId);
    const empty = lineOf(plan, 'BRKN9004', 3);
    await okData(
      patchLine(planId, empty, { notes: [1, 2, 3, 4].map((slot) => ({ slot, notes: 0 })) }),
    );
    plan = await getPlan(planId);
    const before = await counterSeq();
    const res = await issue(planId, plan.lines);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ATM_PLAN_ISSUE_BLOCKED');
    const index = plan.lines.findIndex((l) => l.id === empty.id);
    expect(detailsOf(res)).toContainEqual(
      expect.objectContaining({ field: `lines[${String(index)}]`, code: 'EMPTY_LINE' }),
    );
    expect((await getPlan(planId)).lines.every((l) => l.status === 'draft')).toBe(true);
    expect(await counterSeq()).toBe(before);
    const emptied = lineOf(plan, 'BRKN9004', 3);
    expect(
      (
        await call(
          'delete',
          `/atm/settlements/plans/${planId}/lines/${emptied.id}?version=${String(emptied.version)}`,
          'alphaSettle',
        )
      ).status,
    ).toBe(204);
  });

  it('a stale version refuses the issue and writes nothing', async () => {
    const plan = await getPlan(planId);
    const res = await call('post', `/atm/settlements/plans/${planId}/issue`, 'alphaSettle', {
      lines: plan.lines.map((l, i) => ({ id: l.id, version: i === 0 ? l.version + 1 : l.version })),
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('STALE_DOCUMENT');
    expect((await getPlan(planId)).lines.every((l) => l.status === 'draft')).toBe(true);
  });

  it('a PATCH committed between the read and the write fails the issue; the counter is unchanged (interleaved)', async () => {
    const plan = await getPlan(planId);
    let seqInBetween = -1;
    setSettlementHookForTests('plan.issue.beforeWrite', async () => {
      seqInBetween = await counterSeq();
      await okData(
        patchLine(planId, lineOf(plan, 'BRKN9003'), { notes: [{ slot: 4, notes: 900 }] }),
      );
    });
    const res = await issue(planId, plan.lines);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('STALE_DOCUMENT');
    expect(seqInBetween).toBeGreaterThanOrEqual(0);
    expect(await counterSeq()).toBe(seqInBetween);
    const after = await getPlan(planId);
    expect(after.lines.every((l) => l.status === 'draft')).toBe(true);
    expect(lineOf(after, 'BRKN9003').slots[3]?.notes).toBe(900);
  });

  it('issues consecutive serials in (run, time, position) order, each line with its bags', async () => {
    const before = await counterSeq();
    const plan = await getPlan(planId);
    const issued = await okData<AtmSettlementPlanDto>(issue(planId, plan.lines));
    const order: [string, number][] = [
      ['BRKN9002', 1],
      ['BRKN9008', 1],
      ['BRKN9001', 1],
      ['BRKN9003', 1],
      ['BRKN9001', 2],
    ];
    expect(order.map(([code, run]) => lineOf(issued, code, run).serial)).toEqual(
      [1, 2, 3, 4, 5].map((n) => before + n),
    );
    expect(issued.lines.map((l) => l.serial)).toEqual([1, 2, 3, 4, 5].map((n) => before + n));
    const six = lineOf(issued, 'BRKN9008');
    expect(six.slots.map((s) => s.bag)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(six.preparationStatus).toBe('none');
    const prep = await AtmLinePreparationModel.findOne({ lineId: oid(six.id), isDeleted: false })
      .lean()
      .exec();
    expect(prep?.bags.map((b) => ({ bag: b.bag, slots: b.slots, qr: b.qr }))).toEqual([
      { bag: 1, slots: [1, 2, 3, 4], qr: null },
      { bag: 2, slots: [5, 6], qr: null },
    ]);
    expect(prep?.seals.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(prep?.status).toBe('open');
    const audits = await auditsOf({
      'entityRef.entityType': 'planLine',
      'entityRef.entityId': six.id,
      action: 'statusChange',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes).toEqual([
      expect.objectContaining({ field: 'status', old: 'draft', new: 'issued' }),
      expect.objectContaining({ field: 'serial', old: null, new: six.serial }),
    ]);
    expect(issued.summary).toMatchObject({
      lines: 5,
      machines: 4,
      spares: 0,
      bags: 6,
      notPrinted: 5,
    });
    expect(issued.summary.byStatus).toEqual({ draft: 0, issued: 5, prepared: 0, cancelled: 0 });
  });

  it("later issues continue the numbers, on this plan and on the next day's", async () => {
    const before = await counterSeq();
    await addOk(planId, 1, [{ machineCode: 'BRKN9006', scheduleTime: null }]);
    expect(lineOf(await issueAll(planId), 'BRKN9006').serial).toBe(before + 1);
    const next = await buildPlan(day(6), [{ run: 1, rows: [['BRKN9001', '21:00']] }]);
    expect(lineOf(await issueAll(next.id), 'BRKN9001').serial).toBe(before + 2);
  });

  it('two issues at once (two plans of one branch × bank) take unique, contiguous serials', async () => {
    const before = await counterSeq();
    const plans = await Promise.all(
      [day(7), day(8)].map(async (date) =>
        buildPlan(date, [
          {
            run: 1,
            rows: [
              ['BRKN9001', '21:00'],
              ['BRKN9002', '22:00'],
            ],
          },
        ]),
      ),
    );
    const results = await Promise.all(plans.map((p) => issue(p.id, p.lines)));
    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(200);
    const serials = results
      .flatMap((res) => data<AtmSettlementPlanDto>(res).lines.map((l) => l.serial ?? 0))
      .sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4].map((n) => before + n));
  });
});

// ── 12. Reopen and cancel ───────────────────────────────────────────────────────────────────────

describe('12. reopen and cancel (§6.5 S19, S20)', () => {
  let planId = '';

  beforeAll(async () => {
    planId = (
      await buildPlan(day(9), [
        {
          run: 1,
          rows: [
            ['BRKN9001', '01:00'],
            ['BRKN9002', '02:00'],
            ['BRKN9003', '03:00'],
            ['BRKN9004', '04:00'],
            ['BRKN9005', '05:00'],
          ],
        },
      ])
    ).id;
    await issueAll(planId);
  });

  it('reopening a printed line voids its serial and its print count; a re-issue takes a NEW number', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9001');
    await okData(printPlan(planId, { kind: 'notes', lineIds: [line.id] }));
    const printed = lineOf(await getPlan(planId), 'BRKN9001');
    expect(printed.notePrintCount).toBe(1);
    const prep = await AtmLinePreparationModel.findOne({ lineId: oid(line.id), isDeleted: false })
      .lean()
      .exec();
    const reopened = await okData<AtmPlanLineDto>(
      lineAction(planId, printed, 'reopen', 'تعديل العدد'),
    );
    expect(reopened).toMatchObject({
      status: 'draft',
      serial: null,
      notePrintCount: 0,
      preparationStatus: null,
    });
    expect(reopened.voidedSerials).toEqual([
      expect.objectContaining({ serial: printed.serial, printCount: 1, reason: 'تعديل العدد' }),
    ]);
    expect(reopened.slots.every((s) => s.bag === null)).toBe(true);
    expect((await AtmLinePreparationModel.findById(prep?._id).lean().exec())?.isDeleted).toBe(true);
    expect(
      await auditsOf({
        'entityRef.entityType': 'linePreparation',
        'entityRef.entityId': String(prep?._id),
        action: 'delete',
      }),
    ).toHaveLength(1);
    const status = await auditsOf({
      'entityRef.entityType': 'planLine',
      'entityRef.entityId': line.id,
      action: 'statusChange',
    });
    expect(status.at(-1)?.changes).toContainEqual(
      expect.objectContaining({ field: 'serial', old: printed.serial, new: null }),
    );

    const again = lineOf(await issueAll(planId), 'BRKN9001');
    expect(again.serial).not.toBe(printed.serial);
    expect(again.serial ?? 0).toBeGreaterThan(printed.serial ?? 0);
    expect(again.voidedSerials.map((v) => v.serial)).toEqual([printed.serial]);
    const unprinted = await okData<AtmNotePrintDto>(
      printPlan(planId, { kind: 'notes', unprintedOnly: true }),
    );
    expect(unprinted.notes.map((n) => n.lineId)).toContain(line.id);
    expect(unprinted.notes.find((n) => n.lineId === line.id)?.serial).toBe(again.serial);
  });

  it('a line whose preparation holds a value is not reopened', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9002');
    await okData(savePrep(await prepOf(planId, line.id), { seals: { 1: 'SEAL-T-1201' } }));
    const res = await lineAction(
      planId,
      lineOf(await getPlan(planId), 'BRKN9002'),
      'reopen',
      'تعديل',
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_PLAN_LINE_HAS_CAPTURES');
  });

  it('a reopen racing a capture fails; no draft keeps a deleted preparation holding seals (interleaved)', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9003');
    const prep = await prepOf(planId, line.id);
    setSettlementHookForTests('plan.reopen.beforeWrite', async () => {
      await okData(savePrep(prep, { seals: { 1: 'SEAL-T-1202' } }));
    });
    const res = await lineAction(planId, line, 'reopen', 'تعديل');
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_PLAN_LINE_HAS_CAPTURES');
    const after = await AtmLinePreparationModel.findOne({ lineId: oid(line.id), isDeleted: false })
      .lean()
      .exec();
    expect(after?.seals.find((s) => s.slot === 1)?.value).toBe('SEAL-T-1202');
    expect(lineOf(await getPlan(planId), 'BRKN9003')).toMatchObject({
      status: 'issued',
      serial: line.serial,
    });
  });

  it('a cancel racing a capture: the capture fails and never lands on the cancelled line (interleaved)', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9004');
    const prep = await prepOf(planId, line.id);
    setSettlementHookForTests('preparation.save.beforeWrite', async () => {
      await okData(lineAction(planId, line, 'cancel', 'لن تُغذّى'));
    });
    const res = await savePrep(prep, { seals: { 1: 'SEAL-T-1203' } });
    expect(res.status).toBe(409);
    const after = await AtmLinePreparationModel.findOne({ lineId: oid(line.id), isDeleted: false })
      .lean()
      .exec();
    expect(after?.seals.every((s) => s.value === null)).toBe(true);
    expect(lineById(await getPlan(planId), line.id)).toMatchObject({
      status: 'cancelled',
      serial: line.serial,
    });
    // A cancelled line takes no capture at all.
    const locked = await savePrep(await prepOf(planId, line.id), { seals: { 1: 'SEAL-T-1203' } });
    expect(locked.status).toBe(409);
    expect(errorCode(locked)).toBe('ATM_PREPARATION_LOCKED');
  });

  it('cancelling a prepared line keeps its preparation and removes its route assignment', async () => {
    const line = lineOf(await getPlan(planId), 'BRKN9005');
    await prepareFully(planId, line.id);
    const route = await okData<AtmControlRouteDto>(
      call('post', '/atm/control/routes', 'alphaCtl', {
        branchId: ALPHA,
        replenishDate: day(9),
        name: 'خط اختبار 1',
        leaderName: null,
      }),
    );
    await okData(
      call('put', '/atm/control/assignments', 'alphaCtl', {
        branchId: ALPHA,
        replenishDate: day(9),
        moves: [{ lineId: line.id, from: null, to: route.id }],
      }),
    );
    const prepared = lineOf(await getPlan(planId), 'BRKN9005');
    expect(prepared).toMatchObject({ status: 'prepared', preparationStatus: 'prepared' });
    const cancelled = await okData<AtmPlanLineDto>(
      lineAction(planId, prepared, 'cancel', 'تعطل الماكينة'),
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', serial: prepared.serial });
    const prep = await AtmLinePreparationModel.findOne({ lineId: oid(line.id), isDeleted: false })
      .lean()
      .exec();
    expect(prep?.status).toBe('prepared');
    expect(
      await AtmRouteAssignmentModel.countDocuments({ lineId: oid(line.id), isDeleted: false }),
    ).toBe(0);
    expect(
      await auditsOf({
        'entityRef.entityType': 'routeAssignment',
        'entityRef.entityId': line.id,
        action: 'delete',
      }),
    ).toHaveLength(1);
    // Neither action fits a cancelled line.
    expect((await lineAction(planId, cancelled, 'cancel', 'مرة أخرى')).status).toBe(409);
    expect(errorCode(await lineAction(planId, cancelled, 'reopen', 'مرة أخرى'))).toBe(
      'ATM_PLAN_LINE_STATE',
    );
  });

  it('a capture or «تم التجهيز» from the form of a voided preparation answers 409 once the line is issued again (SEC-1)', async () => {
    const plan = await buildPlan(day(27), [{ run: 1, rows: [['BRKN9001', '01:00']] }]);
    let line = lineOf(await issueAll(plan.id), 'BRKN9001');
    // Preparation's form saves once with nothing scanned, so the line can still be reopened.
    const first = await prepOf(plan.id, line.id);
    const stale = (await okData<{ line: AtmPreparationLineDto }>(savePrep(first, {}))).line;
    line = lineOf(await getPlan(plan.id), 'BRKN9001');
    await okData(lineAction(plan.id, line, 'reopen', 'تعديل العدد'));
    await issueAll(plan.id);
    const fresh = await prepOf(plan.id, line.id);
    expect(fresh.preparation.id).not.toBe(stale.preparation.id);
    expect(fresh.serial).not.toBe(stale.serial);
    // A colleague scans the new bag once: every value, as for «تم التجهيز».
    const qrs = Object.fromEntries(
      fresh.preparation.bags.map((b) => [b.bag, `QR-T-27${String(b.bag)}`]),
    );
    const seals = Object.fromEntries(
      fresh.preparation.seals.map((x) => [x.slot, `SEAL-T-27${String(x.slot)}`]),
    );
    await okData(savePrep(fresh, { qrs, seals }));

    // The stale form, whose version the new preparation would otherwise reach, writes nothing.
    const save = await savePrep(stale, { seals: { 1: 'SEAL-T-2799' } });
    expect(save.status, JSON.stringify(save.body)).toBe(409);
    const mark = await call('post', `/atm/preparation/lines/${line.id}/prepared`, 'alphaPrep', {
      version: stale.preparation.version,
    });
    expect(mark.status, JSON.stringify(mark.body)).toBe(409);
    const now = await prepOf(plan.id, line.id);
    expect(now.preparation.status).toBe('open');
    expect(now.preparation.seals.find((x) => x.slot === 1)?.value).toBe('SEAL-T-271');
  });

  it('a Note printed while a reopen is in flight is counted in the voided serial (SEC-4, interleaved)', async () => {
    const plan = await buildPlan(day(28), [{ run: 1, rows: [['BRKN9002', '02:00']] }]);
    const line = lineOf(await issueAll(plan.id), 'BRKN9002');
    setSettlementHookForTests('plan.reopen.beforeWrite', async () => {
      await okData(printPlan(plan.id, { kind: 'notes', lineIds: [line.id] }));
    });
    const reopened = await okData<AtmPlanLineDto>(lineAction(plan.id, line, 'reopen', 'تعديل'));
    expect(reopened.voidedSerials).toEqual([
      expect.objectContaining({ serial: line.serial, printCount: 1 }),
    ]);
  });
});

// ── 13. Spare sets ──────────────────────────────────────────────────────────────────────────────

describe('13. spare sets (S-9, §6.6)', () => {
  let planId = '';
  let spareId = '';

  it('a spare set is its own line, with a Note of its own', async () => {
    planId = (
      await buildPlan(day(10), [
        { run: 1, rows: [['BRKN9001', '08:00']] },
        { run: 2, rows: [['BRKN9001', '20:00']] },
      ])
    ).id;
    const spare = await okData<AtmPlanLineDto>(
      call('post', `/atm/settlements/plans/${planId}/spare-lines`, 'alphaSettle', {
        run: 1,
        scheduleTime: '09:00',
        spareCode: 'SP-T1',
        typeLabel: 'BRK (S2)',
        slots: [W(1, 200), W(2, 100)],
        standardLoadId: null,
        denominationNotes: [
          { denomination: 200, notes: 1000 },
          { denomination: 100, notes: 500 },
        ],
      }),
    );
    spareId = spare.id;
    expect(spare).toMatchObject({
      kind: 'spare',
      machineId: null,
      spareCode: 'SP-T1',
      typeLabel: 'BRK (S2)',
      countsSource: 'manual',
      status: 'draft',
    });
    expect(spare.slots.map((s) => s.notes)).toEqual([1000, 500]);
    // A spare's slots must all be planned.
    const bad = await call('post', `/atm/settlements/plans/${planId}/spare-lines`, 'alphaSettle', {
      run: 1,
      scheduleTime: null,
      spareCode: null,
      typeLabel: 'BRK (S2)',
      slots: [W(1, 200), DEPOSIT(2)],
      standardLoadId: null,
    });
    expect(bad.status).toBe(400);

    await issueAll(planId);
    const notes = await okData<AtmNotePrintDto>(
      printPlan(planId, { kind: 'notes', lineIds: [spareId] }),
    );
    expect(notes.notes).toEqual([
      expect.objectContaining({
        kind: 'spare',
        spareCode: 'SP-T1',
        typeLabel: 'BRK (S2)',
        machineCode: null,
        bagCount: 1,
      }),
    ]);
  });

  it('records which machine a spare set replenished; a correction replaces it', async () => {
    let spare = lineById(await getPlan(planId), spareId);
    const bm = await call(
      'post',
      `/atm/settlements/plans/${planId}/lines/${spareId}/spare-use`,
      'alphaSettle',
      {
        version: spare.version,
        machineCode: 'BRKN9050',
      },
    );
    expect(bm.status).toBe(422);
    expect(detailCodes(bm)).toEqual(['otherBank']);
    spare = await okData<AtmPlanLineDto>(
      call('post', `/atm/settlements/plans/${planId}/lines/${spareId}/spare-use`, 'alphaSettle', {
        version: spare.version,
        machineCode: 'BRKN9002',
      }),
    );
    expect(spare.spareUse?.machineCode).toBe('BRKN9002');
    spare = await okData<AtmPlanLineDto>(
      call('post', `/atm/settlements/plans/${planId}/lines/${spareId}/spare-use`, 'alphaSettle', {
        version: spare.version,
        machineCode: 'BRKN9003',
      }),
    );
    expect(spare.spareUse?.machineCode).toBe('BRKN9003');
    expect(
      await auditsOf({
        'entityRef.entityType': 'planLine',
        'entityRef.entityId': spareId,
        action: 'update',
      }),
    ).toHaveLength(2);
    // Only a spare records a machine.
    const machineLine = lineOf(await getPlan(planId), 'BRKN9001');
    const notSpare = await call(
      'post',
      `/atm/settlements/plans/${planId}/lines/${machineLine.id}/spare-use`,
      'alphaSettle',
      { version: machineLine.version, machineCode: 'BRKN9002' },
    );
    expect(notSpare.status).toBe(409);
  });

  it('«بيان التغذية» counts distinct machines plus spare sets', async () => {
    const receipt = await okData<AtmReceiptPrintDto>(printPlan(planId, { kind: 'receipt' }));
    expect(receipt.machineCount).toBe(2);
    const plan = await getPlan(planId);
    expect(plan.summary.receipt.machineCount).toBe(2);
    expect(plan.summary).toMatchObject({ lines: 3, machines: 1, spares: 1 });
  });
});

// ── 14. The papers ──────────────────────────────────────────────────────────────────────────────

describe('14. the papers and their keys (§6.7)', () => {
  let planId = '';

  beforeAll(async () => {
    const plan = await buildPlan(day(11), [
      {
        run: 1,
        rows: [
          ['BRKN9001', '08:00'],
          ['BRKN9010', '09:00'],
          ['BRKN9002', '10:00'],
          ['BRKN9003', '11:00'],
        ],
      },
    ]);
    planId = plan.id;
    await okData(patchLine(planId, lineOf(plan, 'BRKN9010'), { notes: [{ slot: 4, notes: 300 }] }));
    const fresh = await getPlan(planId);
    await okData(
      issue(
        planId,
        fresh.lines.filter((l) => l.machineCode !== 'BRKN9003'),
      ),
    );
  });

  it('Notes need the print key reaching the branch; a print counts each Note and is audited', async () => {
    expect((await printPlan(planId, { kind: 'notes' }, 'alphaPlanViewer')).status).toBe(403);
    expect((await printPlan(planId, { kind: 'notes' }, 'orgViewOwnPrint')).status).toBe(403);
    const before = await getPlan(planId);
    const issued = before.lines.filter((l) => l.status === 'issued');
    const notes = await okData<AtmNotePrintDto>(printPlan(planId, { kind: 'notes' }));
    expect(notes).toMatchObject({ bankCode: 'BRK', replenishDate: day(11) });
    expect(notes.notes.map((n) => n.serial)).toEqual(issued.map((l) => l.serial));
    expect(notes.notes.every((n) => n.slots.every((s) => s.bag === 1))).toBe(true);
    const after = await getPlan(planId);
    for (const line of issued) {
      expect(lineById(after, line.id)).toMatchObject({ notePrintCount: 1, version: line.version });
    }
    const audits = await auditsOf({
      'entityRef.entityType': 'settlementPlan',
      'entityRef.entityId': planId,
      action: 'atmSettlementPrint',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes.find((c) => c.field === 'lines')?.new).toEqual(
      issued.map((l) => ({ lineId: l.id, serial: l.serial, version: l.version })),
    );
    // A draft does not print.
    const draft = lineOf(after, 'BRKN9003');
    const res = await printPlan(planId, { kind: 'notes', lineIds: [draft.id] });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ATM_PLAN_LINE_STATE');
  });

  it('a Note print racing a reopen answers 409 and counts nothing (interleaved)', async () => {
    const plan = await getPlan(planId);
    const a = lineOf(plan, 'BRKN9001');
    const b = lineOf(plan, 'BRKN9002');
    setSettlementHookForTests('print.notes.beforeWrite', async () => {
      await okData(lineAction(planId, b, 'reopen', 'تعديل'));
    });
    const res = await printPlan(planId, { kind: 'notes', lineIds: [a.id, b.id] });
    expect(res.status).toBe(409);
    expect(lineOf(await getPlan(planId), 'BRKN9001').notePrintCount).toBe(a.notePrintCount);
    await okData(issue(planId, [lineOf(await getPlan(planId), 'BRKN9002')]));
  });

  it('«بيان التغذية»: six rows with 20/10/5 summed, drafts excluded and counted, what it covered kept', async () => {
    const receipt = await okData<AtmReceiptPrintDto>(printPlan(planId, { kind: 'receipt' }));
    expect(receipt.rows).toEqual([
      { denomination: 200, notes: 10000 },
      { denomination: 100, notes: 5000 },
      { denomination: 50, notes: 2600 },
      { denomination: 20, notes: 300 },
      { denomination: 10, notes: 0 },
      { denomination: 5, notes: 0 },
    ]);
    expect(receipt).toMatchObject({
      excludedDraftLines: 1,
      machineCount: 3,
      previous: null,
      bankNameAr: expect.any(String),
    });
    expect(receipt.egpTotalMinor).toBe(
      egp([
        [10000, 200],
        [5000, 100],
        [2600, 50],
        [300, 20],
      ]),
    );
    let plan = await getPlan(planId);
    expect(plan.summary.receiptPrint).not.toBeNull();
    expect(plan.summary.receiptStale).toBe(false);
    await okData(issue(planId, [lineOf(plan, 'BRKN9003')]));
    plan = await getPlan(planId);
    expect(plan.summary.receiptStale).toBe(true);
    const second = await okData<AtmReceiptPrintDto>(printPlan(planId, { kind: 'receipt' }));
    expect(second.previous?.serials).toEqual(receipt.serials);
    expect(second.excludedDraftLines).toBe(0);
    const audit = (
      await auditsOf({ 'entityRef.entityId': planId, action: 'atmSettlementPrint' })
    ).find((a) => a.changes.some((c) => c.field === 'kind' && c.new === 'receipt'));
    expect(audit?.changes.find((c) => c.field === 'rows')?.new).toEqual(receipt.rows);
  });

  it('«سيلزات» from Settlements has blank QR boxes; the .xlsx needs the export key', async () => {
    const handover = await okData<AtmHandoverPrintDto>(printPlan(planId, { kind: 'handover' }));
    expect(handover.withQr).toBe(false);
    expect(handover.rows).toHaveLength(4);
    expect(handover.rows.every((r) => r.qrs.length === 0)).toBe(true);
    expect((await getPlan(planId)).summary).toMatchObject({ handoverStale: false });
    expect((await printPlan(planId, { kind: 'repTape' }, 'alphaPlanViewer')).status).toBe(403);
    const tape = await okData<AtmRepTapeExportDto>(printPlan(planId, { kind: 'repTape' }));
    expect(tape.rows.map((r) => r.reference).sort()).toEqual([
      'BRKN9001',
      'BRKN9002',
      'BRKN9003',
      'BRKN9010',
    ]);
    expect(tape.rows.find((r) => r.reference === 'BRKN9001')).toMatchObject({
      comment: 'Repl @8:00 AM',
    });
    expect(tape.rows.find((r) => r.reference === 'BRKN9010')?.byDenomination).toEqual([
      { denomination: 200, notes: 4000 },
      { denomination: 100, notes: 2000 },
      { denomination: 50, notes: 1000 },
      { denomination: 20, notes: 300 },
    ]);
    expect(await auditsOf({ 'entityRef.entityId': planId, action: 'export' })).toHaveLength(1);
  });
});

// ── 15. Preparation ─────────────────────────────────────────────────────────────────────────────

describe('15. Preparation — bags and seals (§6.8, S-7)', () => {
  let planId = '';
  let betaPlanId = '';
  const idOf = async (code: string): Promise<string> => lineOf(await getPlan(planId), code).id;
  const markPrepared = (prep: AtmPreparationLineDto, as = 'alphaPrep'): request.Test =>
    call('post', `/atm/preparation/lines/${prep.lineId}/prepared`, as, {
      version: prep.preparation.version,
    });
  const saved = async (test: request.Test): Promise<AtmPreparationLineDto> =>
    (await okData<{ line: AtmPreparationLineDto }>(test)).line;

  beforeAll(async () => {
    const plan = await buildPlan(day(12), [
      {
        run: 1,
        rows: [
          ['BRKN9001', '01:00'],
          ['BRKN9002', '02:00'],
          ['BRKN9003', '03:00'],
          ['BRKN9004', '04:00'],
          ['BRKN9008', '05:00'],
          ['BRKN9010', '06:00'],
          ['BRKN9005', '07:00'],
        ],
      },
    ]);
    planId = plan.id;
    // The six-cassette machine's second bag holds two 0-note cassettes.
    await okData(
      patchLine(planId, lineOf(plan, 'BRKN9008'), {
        notes: [
          { slot: 5, notes: 0 },
          { slot: 6, notes: 0 },
        ],
      }),
    );
    const fresh = await getPlan(planId);
    await okData(
      issue(
        planId,
        fresh.lines.filter((l) => l.machineCode !== 'BRKN9005'),
      ),
    );
    // A Beta line, for the out-of-reach duplicate.
    betaPlanId = (await createPlan(day(12), 'orgSettle', BETA, BETA)).id;
    const added = await addOk(
      betaPlanId,
      1,
      [{ machineCode: 'BRKN9101', scheduleTime: '08:00' }],
      'orgSettle',
    );
    await okData(
      patchLine(
        betaPlanId,
        added.added[0] as AtmPlanLineDto,
        { denominationNotes: [{ denomination: 200, notes: 2000 }] },
        'orgSettle',
      ),
    );
    await issueAll(betaPlanId, 'orgSettle');
  });

  it('lists the issued lines only, in serial order; a draft is absent', async () => {
    const lines = await prepLines(planId);
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.machineCode)).not.toContain('BRKN9005');
    const serials = lines.map((l) => l.serial ?? 0);
    expect(serials).toEqual([...serials].sort((a, b) => a - b));
    expect(lines.every((l) => l.lineStatus === 'issued' && l.preparation.status === 'open')).toBe(
      true,
    );
    expect((await call('get', `/atm/preparation/plans/${planId}/lines`, 'betaPrep')).status).toBe(
      404,
    );
    const ctx = await okData<AtmPreparationContextDto>(
      call('get', `/atm/preparation/context?date=${day(12)}`, 'alphaPrep'),
    );
    expect(ctx).toMatchObject({ date: day(12), canCapture: true, branch: { id: ALPHA } });
    expect(ctx.plans).toEqual([
      { planId, bankCode: 'BRK', lines: 6, prepared: 0, complete: 0, partial: 0, none: 6 },
    ]);
  });

  it('stores values cleaned: ASCII digits, no CR or RLM; a QR keeps its case and keys upper case', async () => {
    const line = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9001')), {
        qrs: { 1: 'qr-t-abc' },
        seals: { 1: 'SEAL-T-٤٥٦٧', 2: '‏SEAL-T-2002\r' },
      }),
    );
    expect(line.preparation.bags[0]?.qr).toBe('qr-t-abc');
    expect(line.preparation.seals.slice(0, 2).map((s) => s.value)).toEqual([
      'SEAL-T-4567',
      'SEAL-T-2002',
    ]);
    expect(line.progress).toEqual({ captured: 3, required: 5 });
    const doc = await AtmLinePreparationModel.findById(line.preparation.id).lean().exec();
    expect(doc?.bags[0]?.qrKey).toBe('QR-T-ABC');
    expect(doc?.seals[0]?.key).toBe('SEAL-T-4567');
    const audit = await auditsOf({
      'entityRef.entityType': 'linePreparation',
      'entityRef.entityId': line.preparation.id,
      action: 'update',
    });
    expect(audit[0]?.changes.map((c) => c.field).sort()).toEqual([
      'bags.1.qr',
      'seals.1.value',
      'seals.2.value',
    ]);
    // A value that is not a seal is refused by field, never repeated back.
    const bad = await savePrep(await prepOf(planId, await idOf('BRKN9001')), {
      seals: { 4: 'X'.repeat(65) },
    });
    expect(bad.status).toBe(400);
    expect(detailsOf(bad)).toEqual([
      expect.objectContaining({ field: 'seals[3].value', code: 'INVALID_SEAL' }),
    ]);
    expect(JSON.stringify(bad.body)).not.toContain('X'.repeat(65));
  });

  it('the same seal on two cassettes of one line warns, and saves', async () => {
    const line = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9001')), { seals: { 3: 'seal-t-2002' } }),
    );
    const dup = line.duplicates.find((d) => d.field === 'seal' && d.slot === 3);
    expect(dup).toMatchObject({ crossKind: false });
    expect(dup?.matches).toEqual([{ sameLine: true, otherField: { field: 'seal', slot: 2 } }]);
  });

  it('a bag QR equal to a seal is cross-kind, on the same line and on another', async () => {
    const two = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9002')), {
        qrs: { 1: 'SEAL-T-2003' },
        seals: { 1: 'SEAL-T-2003' },
      }),
    );
    const bag = two.duplicates.find((d) => d.field === 'bag');
    expect(bag).toMatchObject({ crossKind: true });
    expect(bag?.matches).toEqual([{ sameLine: true, otherField: { field: 'seal', slot: 1 } }]);
    const three = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9003')), { seals: { 1: 'QR-T-ABC' } }),
    );
    const seal = three.duplicates.find((d) => d.field === 'seal' && d.slot === 1);
    const nine = lineOf(await getPlan(planId), 'BRKN9001');
    expect(seal).toMatchObject({ crossKind: true });
    expect(seal?.matches).toEqual([
      {
        replenishDate: day(12),
        bankCode: 'BRK',
        serial: nine.serial,
        machineCode: 'BRKN9001',
        spareCode: null,
        lineStatus: 'issued',
        matchedField: 'bag',
      },
    ]);
  });

  it('a seal used ten times before returns five matches at most; an Arabic-layout value warns', async () => {
    await AtmLinePreparationModel.insertMany(
      Array.from({ length: 10 }, () => ({
        lineId: new Types.ObjectId(),
        planId: new Types.ObjectId(),
        branchId: oid(ALPHA),
        bankCode: 'BRK',
        replenishDate: day(-100),
        bags: [{ bag: 1, slots: [1], qr: null, qrKey: null }],
        seals: [{ slot: 1, value: 'SEAL-T-HIST', key: 'SEAL-T-HIST' }],
        status: 'prepared',
      })),
    );
    const four = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9004')), {
        seals: { 1: 'SEAL-T-HIST', 2: 'سثشمش' },
      }),
    );
    expect(four.duplicates.find((d) => d.field === 'seal' && d.slot === 1)?.matches).toHaveLength(
      5,
    );
    expect(four.warnings).toEqual([{ field: 'seal', slot: 2, code: 'ARABIC_LETTERS' }]);
    expect(four.preparation.seals[1]?.value).toBe('سثشمش');
  });

  it('a match in another branch is outside reach; an organization viewer sees where it is', async () => {
    const beta = (await prepLines(betaPlanId, 'betaPrep'))[0] as AtmPreparationLineDto;
    await okData(savePrep(beta, { qrs: { 1: 'QR-T-BETA-1' } }, 'betaPrep'));
    const three = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9003')), { qrs: { 1: 'qr-t-beta-1' } }),
    );
    expect(three.duplicates.find((d) => d.field === 'bag')?.matches).toEqual([
      { outsideReach: true },
    ]);
    const org = (await prepLines(planId, 'orgSettle')).find((l) => l.machineCode === 'BRKN9003');
    expect(org?.duplicates.find((d) => d.field === 'bag')?.matches).toEqual([
      expect.objectContaining({
        machineCode: 'BRKN9101',
        bankCode: 'BRK',
        replenishDate: day(12),
        matchedField: 'bag',
      }),
    ]);
  });

  it('«تم التجهيز» needs every required value; a 0-note cassette and a bag of 0-note cassettes need none', async () => {
    const one = await prepOf(planId, await idOf('BRKN9001'));
    const missing = await markPrepared(one);
    expect(missing.status).toBe(422);
    expect(errorCode(missing)).toBe('ATM_PREPARATION_INCOMPLETE');
    expect(detailsOf(missing).map((d) => [d.field, d.code])).toEqual([
      ['seals[slot=4]', 'REQUIRED'],
    ]);

    const six = await prepOf(planId, await idOf('BRKN9008'));
    expect(six.preparation.bags.map((b) => b.required)).toEqual([true, false]);
    expect(six.preparation.seals.map((s) => s.required)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    const sixSaved = await saved(
      savePrep(six, {
        qrs: { 1: 'QR-T-6001' },
        seals: { 1: 'SEAL-T-6001', 2: 'SEAL-T-6002', 3: 'SEAL-T-6003', 4: 'SEAL-T-6004' },
      }),
    );
    const sixDone = await saved(markPrepared(sixSaved));
    expect(sixDone).toMatchObject({ lineStatus: 'prepared', preparation: { status: 'prepared' } });

    const twenty = await prepOf(planId, await idOf('BRKN9010'));
    expect(twenty.preparation.seals.map((s) => s.required)).toEqual([true, true, true, false]);
    const tSaved = await saved(
      savePrep(twenty, {
        qrs: { 1: 'QR-T-7001' },
        seals: { 1: 'SEAL-T-7001', 2: 'SEAL-T-7002', 3: 'SEAL-T-7003' },
      }),
    );
    expect((await saved(markPrepared(tSaved))).lineStatus).toBe('prepared');
    for (const entityType of ['linePreparation', 'planLine']) {
      const entityId = entityType === 'planLine' ? tSaved.lineId : tSaved.preparation.id;
      expect(
        await auditsOf({
          'entityRef.entityType': entityType,
          'entityRef.entityId': entityId,
          action: 'statusChange',
        }),
      ).toHaveLength(entityType === 'planLine' ? 2 : 1);
    }
    expect(lineOf(await getPlan(planId), 'BRKN9010').preparationStatus).toBe('prepared');
  });

  it('«تم التجهيز» racing a cancel answers 409 and the line stays cancelled (interleaved)', async () => {
    const two = await saved(
      savePrep(await prepOf(planId, await idOf('BRKN9002')), {
        seals: { 2: 'SEAL-T-8002', 3: 'SEAL-T-8003', 4: 'SEAL-T-8004' },
      }),
    );
    expect(lineOf(await getPlan(planId), 'BRKN9002').preparationStatus).toBe('complete');
    const line = lineOf(await getPlan(planId), 'BRKN9002');
    setSettlementHookForTests('preparation.prepared.beforeWrite', async () => {
      await okData(lineAction(planId, line, 'cancel', 'إلغاء'));
    });
    const res = await markPrepared(two);
    expect(res.status).toBe(409);
    expect(lineById(await getPlan(planId), line.id).status).toBe('cancelled');
    const prep = await AtmLinePreparationModel.findOne({ lineId: oid(line.id), isDeleted: false })
      .lean()
      .exec();
    expect(prep?.status).toBe('open');
  });

  it('a prepared line is locked until Preparation reopens it', async () => {
    const six = await prepOf(planId, await idOf('BRKN9008'));
    const locked = await savePrep(six, { seals: { 1: 'SEAL-T-6101' } });
    expect(locked.status).toBe(409);
    expect(errorCode(locked)).toBe('ATM_PREPARATION_LOCKED');
    const reopened = await saved(
      call('post', `/atm/preparation/lines/${six.lineId}/reopen`, 'alphaPrep', {
        version: six.preparation.version,
      }),
    );
    expect(reopened).toMatchObject({
      lineStatus: 'issued',
      preparation: { status: 'open', preparedAt: null },
    });
    const again = await saved(savePrep(reopened, { seals: { 1: 'SEAL-T-6101' } }));
    expect(again.preparation.seals[0]?.value).toBe('SEAL-T-6101');
  });

  it("another branch's line is not there; a department grant reads and never captures", async () => {
    const one = await prepOf(planId, await idOf('BRKN9001'));
    expect((await savePrep(one, {}, 'betaPrep')).status).toBe(404);
    expect((await savePrep(one, {}, 'deptCapture')).status).toBe(403);
    expect((await markPrepared(one, 'deptCapture')).status).toBe(403);
    expect((await prepLines(planId, 'deptCapture')).length).toBe(6);
  });

  it('without a date, the page opens on today at 00:30 Cairo when today has issued lines (DS-25)', async () => {
    const today = await buildPlan(TODAY, [{ run: 1, rows: [['BRKN9001', '08:00']] }]);
    await issueAll(today.id);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(cairoInstant(TODAY, 0, 30));
      const fresh = await login('atm-settle-alphaprep@ecms.local');
      const ctx = await okData<AtmPreparationContextDto>(
        call('get', '/atm/preparation/context', fresh),
      );
      expect(ctx.date).toBe(TODAY);
      expect(ctx.plans.map((p) => p.planId)).toEqual([today.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 16. Control & Supplies ──────────────────────────────────────────────────────────────────────

describe('16. Control & Supplies — the day, crew lines and their sheets (§6.9, S-8)', () => {
  let planId = '';
  const route: Record<string, AtmControlRouteDto> = {};
  const createRoute = (name: string, date = day(13), as = 'alphaCtl'): request.Test =>
    call('post', '/atm/control/routes', as, {
      branchId: ALPHA,
      replenishDate: date,
      name,
      leaderName: null,
    });
  const assign = (
    moves: { lineId: string; from: string | null; to: string | null }[],
    date = day(13),
    as = 'alphaCtl',
  ): request.Test =>
    call('put', '/atm/control/assignments', as, { branchId: ALPHA, replenishDate: date, moves });
  const dayOf = async (date = day(13), as = 'alphaCtl'): Promise<AtmControlDayDto> =>
    okData<AtmControlDayDto>(call('get', `/atm/control/day?date=${date}`, as));
  const lineIdOf = (dto: AtmControlDayDto, code: string, run = 1): string =>
    dto.lines.find((l) => l.machineCode === code && l.run === run)?.lineId ?? '';
  const fromZones = (date: string, as = 'alphaCtl'): request.Test =>
    call('post', '/atm/control/routes/from-zones', as, { branchId: ALPHA, replenishDate: date });
  const spare = (id: string): request.Test =>
    call('post', `/atm/settlements/plans/${id}/spare-lines`, 'alphaSettle', {
      run: 1,
      scheduleTime: '09:00',
      spareCode: 'SP-T2',
      typeLabel: 'BRK (S2)',
      slots: [W(1, 200)],
      standardLoadId: PROFILE.def,
    });

  beforeAll(async () => {
    planId = (
      await buildPlan(day(13), [
        {
          run: 1,
          rows: [
            ['BRKN9001', '01:00'],
            ['BRKN9002', '02:00'],
            ['BRKN9003', '03:00'],
            ['BRKN9004', '04:00'],
            ['BRKN9005', '05:00'],
            ['BRKN9006', '06:00'],
          ],
        },
        { run: 2, rows: [['BRKN9001', '20:00']] },
      ])
    ).id;
    await issueAll(planId);
    await prepareFully(planId, lineOf(await getPlan(planId), 'BRKN9001').id);
  });

  it('the day lists both runs of a machine as two lines, with its zone only for a map holder', async () => {
    const dto = await dayOf();
    const nine = dto.lines.filter((l) => l.machineCode === 'BRKN9001');
    expect(nine.map((l) => l.run).sort()).toEqual([1, 2]);
    expect(dto.can).toEqual({ manage: true, print: true, zones: true });
    expect(nine.map((l) => l.zoneName)).toEqual(['قطاع اختبار 1', 'قطاع اختبار 1']);
    expect(dto.unassigned).toBe(7);
    expect(dto.plans).toEqual([{ planId, bankCode: 'BRK', lines: 7, prepared: 1 }]);
    const prepared = nine.find((l) => l.run === 1);
    expect(prepared).toMatchObject({ preparationStatus: 'prepared', lineStatus: 'prepared' });
    expect(prepared?.seals.every((s) => s.value !== null)).toBe(true);
    const noMap = await dayOf(day(13), 'alphaCtlNoMap');
    expect(noMap.can.zones).toBe(false);
    expect(noMap.lines.every((l) => l.zoneName === null)).toBe(true);
  });

  it('route names are unique per branch-day, whatever the case and spacing', async () => {
    route.one = await okData<AtmControlRouteDto>(createRoute('Line One'));
    const twin = await createRoute('  line   ONE ');
    expect(twin.status).toBe(400);
    expect(detailCodes(twin)).toEqual(['DUPLICATE_NAME']);
    route.two = await okData<AtmControlRouteDto>(createRoute('Line Two'));
    expect(route.two.order).toBe(route.one.order + 1);
    // Another day may reuse the name.
    await okData(createRoute('Line One', day(42)));
    // A body branch is checked.
    const beta = await call('post', '/atm/control/routes', 'alphaCtl', {
      branchId: BETA,
      replenishDate: day(13),
      name: 'Line Beta',
      leaderName: null,
    });
    expect(beta.status).toBe(400);
    expect(detailCodes(beta)).toEqual(['BRANCH_MISMATCH']);
  });

  it("moves are checked, audited per move, and another branch's line is refused", async () => {
    const beta = await AtmPlanLineModel.findOne({ branchId: oid(BETA), isDeleted: false })
      .lean()
      .exec();
    const refused = await assign([
      { lineId: String(beta?._id), from: null, to: route.one?.id ?? null },
    ]);
    expect(refused.status).toBe(400);
    expect(detailCodes(refused)).toEqual(['LINE_STATE']);
    const two = lineIdOf(await dayOf(), 'BRKN9002');
    await okData(assign([{ lineId: two, from: null, to: route.one?.id ?? null }]));
    await okData(assign([{ lineId: two, from: route.one?.id ?? null, to: route.two?.id ?? null }]));
    const routes = await okData<AtmControlRouteDto[]>(
      assign([{ lineId: two, from: route.two?.id ?? null, to: null }]),
    );
    expect(routes.map((r) => r.lines)).toEqual([0, 0]);
    const audits = await auditsOf({
      'entityRef.entityType': 'routeAssignment',
      'entityRef.entityId': two,
    });
    expect(audits.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
  });

  it('a move whose "from" no longer holds answers 409 MOVED (interleaved)', async () => {
    const three = lineIdOf(await dayOf(), 'BRKN9003');
    await okData(assign([{ lineId: three, from: null, to: route.one?.id ?? null }]));
    setSettlementHookForTests('control.assign.beforeWrite', async () => {
      await okData(assign([{ lineId: three, from: route.one?.id ?? null, to: null }]));
    });
    const res = await assign([
      { lineId: three, from: route.one?.id ?? null, to: route.two?.id ?? null },
    ]);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('STALE_DOCUMENT');
    expect(detailsOf(res)).toEqual([expect.objectContaining({ field: 'moves[0]', code: 'MOVED' })]);
    expect(
      await AtmRouteAssignmentModel.countDocuments({ lineId: oid(three), isDeleted: false }),
    ).toBe(0);
  });

  it('a move onto a route deleted meanwhile answers ROUTE_GONE; no line is left on it (interleaved)', async () => {
    const three = await okData<AtmControlRouteDto>(createRoute('Line Three'));
    const four = lineIdOf(await dayOf(), 'BRKN9004');
    setSettlementHookForTests('control.assign.beforeWrite', async () => {
      const removed = await call(
        'delete',
        `/atm/control/routes/${three.id}?version=${String(three.version)}`,
        'alphaCtl',
      );
      expect(removed.status).toBe(204);
    });
    const res = await assign([{ lineId: four, from: null, to: three.id }]);
    expect(res.status).toBe(400);
    expect(detailCodes(res)).toEqual(['ROUTE_GONE']);
    expect(
      await AtmRouteAssignmentModel.countDocuments({ routeId: oid(three.id), isDeleted: false }),
    ).toBe(0);
  });

  it('deleting a route returns its lines to «لم يُوزّع بعد», one audit per assignment', async () => {
    const four = await okData<AtmControlRouteDto>(createRoute('Line Four'));
    const dto = await dayOf();
    const ids = [lineIdOf(dto, 'BRKN9004'), lineIdOf(dto, 'BRKN9005')];
    const routes = await okData<AtmControlRouteDto[]>(
      assign(ids.map((lineId) => ({ lineId, from: null, to: four.id }))),
    );
    const current = routes.find((r) => r.id === four.id);
    expect(current).toMatchObject({ lines: 2, machines: 2, bags: 2, notPrepared: 2 });
    const stale = await call(
      'delete',
      `/atm/control/routes/${four.id}?version=${String(four.version)}`,
      'alphaCtl',
    );
    expect(stale.status).toBe(409);
    expect(
      (
        await call(
          'delete',
          `/atm/control/routes/${four.id}?version=${String(current?.version)}`,
          'alphaCtl',
        )
      ).status,
    ).toBe(204);
    const after = await dayOf();
    expect(ids.map((id) => after.lines.find((l) => l.lineId === id)?.routeId)).toEqual([
      null,
      null,
    ]);
    expect(after.routes.some((r) => r.id === four.id)).toBe(false);
    for (const id of ids) {
      expect(
        await auditsOf({
          'entityRef.entityType': 'routeAssignment',
          'entityRef.entityId': id,
          action: 'delete',
        }),
      ).toHaveLength(1);
    }
    expect(
      await auditsOf({
        'entityRef.entityType': 'dispatchRoute',
        'entityRef.entityId': four.id,
        action: 'delete',
      }),
    ).toHaveLength(1);
    // A route edit keeps the name rule.
    const renamed = await call('put', `/atm/control/routes/${route.two?.id ?? ''}`, 'alphaCtl', {
      version: routes.find((r) => r.id === route.two?.id)?.version ?? 0,
      name: 'LINE one',
    });
    expect(renamed.status).toBe(400);
    expect(detailCodes(renamed)).toEqual(['DUPLICATE_NAME']);
  });

  it('routes from the zones: the first zone in order, review pins count, the rest stay unassigned', async () => {
    const plan = await buildPlan(day(14), [
      {
        run: 1,
        rows: [
          ['BRKN9001', '01:00'],
          ['BRKN9002', '02:00'],
          ['BRKN9003', '03:00'],
          ['BRKN9004', '04:00'],
          ['BRKN9005', '05:00'],
        ],
      },
    ]);
    await okData(spare(plan.id));
    await issueAll(plan.id);
    const result = await okData<AtmRoutesFromZonesResultDto>(fromZones(day(14)));
    expect(result).toEqual({ routesCreated: 2, assigned: 3, unlocated: 2, outsideZones: 1 });
    const dto = await dayOf(day(14));
    const routeName = (code: string | null): string | undefined =>
      dto.routes.find((r) => r.id === dto.lines.find((l) => l.machineCode === code)?.routeId)?.name;
    expect(['BRKN9001', 'BRKN9002', 'BRKN9003', 'BRKN9004', 'BRKN9005'].map(routeName)).toEqual([
      'قطاع اختبار 1',
      'قطاع اختبار 2',
      'قطاع اختبار 1',
      undefined,
      undefined,
    ]);
    expect(dto.lines.find((l) => l.kind === 'spare')?.routeId).toBeNull();
    expect(dto.routes.map((r) => r.zoneId === null)).toEqual([false, false]);
    expect(
      await auditsOf({
        'entityRef.entityType': 'dispatchRoute',
        'entityRef.entityId': { $in: dto.routes.map((r) => r.id) },
        action: 'create',
      }),
    ).toHaveLength(2);
    expect(await okData<AtmRoutesFromZonesResultDto>(fromZones(day(14)))).toEqual({
      routesCreated: 0,
      assigned: 0,
      unlocated: 2,
      outsideZones: 1,
    });
  });

  it('two zone calls at once make one set of routes', async () => {
    const plan = await buildPlan(day(16), [
      {
        run: 1,
        rows: [
          ['BRKN9001', '01:00'],
          ['BRKN9002', '02:00'],
          ['BRKN9003', '03:00'],
        ],
      },
    ]);
    await issueAll(plan.id);
    const results = await Promise.all([fromZones(day(16)), fromZones(day(16))]);
    for (const res of results) expect([200, 409], JSON.stringify(res.body)).toContain(res.status);
    expect(
      await AtmDispatchRouteModel.countDocuments({
        branchId: oid(ALPHA),
        replenishDate: day(16),
        isDeleted: false,
      }),
    ).toBe(2);
    expect(
      await AtmRouteAssignmentModel.countDocuments({
        branchId: oid(ALPHA),
        replenishDate: day(16),
        isDeleted: false,
      }),
    ).toBe(3);
  });

  it('the zones button needs the map reaching the branch', async () => {
    expect((await fromZones(day(14), 'alphaCtlNoMap')).status).toBe(403);
    expect((await fromZones(day(14), 'alphaCtlOwnMap')).status).toBe(403);
  });

  it('the zones button skips a line reopened meanwhile; a move refuses one (SEC-3, interleaved)', async () => {
    const plan = await buildPlan(day(24), [
      {
        run: 1,
        rows: [
          ['BRKN9001', '01:00'],
          ['BRKN9003', '03:00'],
          ['BRKN9004', '04:00'],
        ],
      },
    ]);
    await issueAll(plan.id);
    const idOf = (code: string): string => lineOf(plan, code).id;
    const reopen = (code: string) => async (): Promise<void> => {
      await okData(lineAction(plan.id, lineOf(await getPlan(plan.id), code), 'reopen', 'تعديل'));
    };
    const liveOf = (code: string) =>
      AtmRouteAssignmentModel.findOne({ lineId: oid(idOf(code)), isDeleted: false })
        .lean()
        .exec();

    // 9001 and 9003 are in zone 1; 9001 is reopened after the zones button read the lines.
    setSettlementHookForTests('control.zones.beforeWrite', reopen('BRKN9001'));
    const zones = await okData<AtmRoutesFromZonesResultDto>(fromZones(day(24)));
    expect(zones.assigned).toBe(1);
    expect(await liveOf('BRKN9001')).toBeNull();
    expect(await liveOf('BRKN9003')).not.toBeNull();

    // A move of the unassigned 9004 racing its reopen: refused, the draft keeps no assignment.
    const target = await okData<AtmControlRouteDto>(createRoute('Line SEC-3', day(24)));
    setSettlementHookForTests('control.assign.beforeWrite', reopen('BRKN9004'));
    const moved = await assign([{ lineId: idOf('BRKN9004'), from: null, to: target.id }], day(24));
    expect(moved.status, JSON.stringify(moved.body)).toBe(400);
    expect(detailCodes(moved)).toEqual(['LINE_STATE']);
    expect(lineById(await getPlan(plan.id), idOf('BRKN9004')).status).toBe('draft');
    expect(await liveOf('BRKN9004')).toBeNull();
  });

  it('the zones button racing a route delete leaves no line on the deleted route (SEC-2, interleaved)', async () => {
    const date = day(22);
    const plan = await buildPlan(date, [{ run: 1, rows: [['BRKN9001', '01:00']] }]);
    await issueAll(plan.id);
    const lineId = lineOf(plan, 'BRKN9001').id;
    expect((await okData<AtmRoutesFromZonesResultDto>(fromZones(date))).assigned).toBe(1);
    const zoneRoute = (await dayOf(date)).routes[0] as AtmControlRouteDto;
    // Back to «لم يُوزّع بعد», so the next zones call reuses the zone's route.
    await okData(assign([{ lineId, from: zoneRoute.id, to: null }], date));
    const routeNow = (await dayOf(date)).routes.find((r) => r.id === zoneRoute.id);

    // A second Control user deletes that route while the zones call's transaction is open.
    const original = AtmRouteAssignmentModel.exists.bind(AtmRouteAssignmentModel);
    let deleted = false;
    const spy = vi.spyOn(AtmRouteAssignmentModel, 'exists').mockImplementation(((
      ...args: Parameters<typeof original>
    ) => {
      const query = original(...args);
      const exec = query.exec.bind(query);
      (query as unknown as { exec: () => Promise<unknown> }).exec = async () => {
        if (!deleted) {
          deleted = true;
          const res = await call(
            'delete',
            `/atm/control/routes/${zoneRoute.id}?version=${String(routeNow?.version)}`,
            'alphaCtl',
          );
          expect(res.status).toBe(204);
        }
        return exec();
      };
      return query;
    }) as never);
    let res: request.Response;
    try {
      res = await fromZones(date);
    } finally {
      spy.mockRestore();
    }
    expect(deleted).toBe(true);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const live = await AtmRouteAssignmentModel.findOne({ lineId: oid(lineId), isDeleted: false })
      .lean()
      .exec();
    const route = await AtmDispatchRouteModel.findById(live?.routeId).lean().exec();
    expect(route?.isDeleted).toBe(false);
    const dto = await dayOf(date);
    expect(dto.routes.map((r) => r.id)).toContain(String(live?.routeId));
    expect(dto.unassigned).toBe(0);
  });

  it('a line left on a route that is not live counts as «لم يُوزّع بعد» and can be moved (SEC-2)', async () => {
    const date = day(23);
    const plan = await buildPlan(date, [{ run: 1, rows: [['BRKN9002', '02:00']] }]);
    await issueAll(plan.id);
    const lineId = lineOf(plan, 'BRKN9002').id;
    const gone = await okData<AtmControlRouteDto>(createRoute('Line Gone', date));
    await okData(assign([{ lineId, from: null, to: gone.id }], date));
    expect((await dayOf(date)).unassigned).toBe(0);
    // The state the C3/C5 race used to leave: the route deleted, its assignment still live.
    await AtmDispatchRouteModel.updateOne({ _id: oid(gone.id) }, { $set: { isDeleted: true } });
    const dto = await dayOf(date);
    expect(dto.routes.map((r) => r.id)).not.toContain(gone.id);
    expect(dto.unassigned).toBe(1);
    // A move from what the server holds puts it on a live route.
    const next = await okData<AtmControlRouteDto>(createRoute('Line Next', date));
    await okData(assign([{ lineId, from: gone.id, to: next.id }], date));
    const after = await dayOf(date);
    expect(after.unassigned).toBe(0);
    expect(after.lines.find((l) => l.lineId === lineId)?.routeId).toBe(next.id);
  });

  it("prints: «سيلزات» with the prepared lines' QRs; one sheet per route, cancelled lines absent", async () => {
    const handover = await okData<AtmHandoverPrintDto>(
      call('post', '/atm/control/prints', 'alphaCtl', { kind: 'handover', planId }),
    );
    expect(handover.withQr).toBe(true);
    const prepared = handover.rows.filter((r) => r.prepared);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.qrs.length).toBeGreaterThan(0);
    expect(prepared[0]?.qrs.every((q) => typeof q === 'string')).toBe(true);
    expect(handover.rows.filter((r) => !r.prepared).every((r) => r.qrs.length === 0)).toBe(true);
    expect(handover.notPrepared).toBe(handover.rows.length - 1);
    expect((await getPlan(planId)).summary.handoverPrint).not.toBeNull();
    // Settlements' print key does not print Control's sheet.
    expect(
      (await call('post', '/atm/control/prints', 'alphaSettle', { kind: 'handover', planId }))
        .status,
    ).toBe(403);

    const dto = await dayOf();
    const six = lineIdOf(dto, 'BRKN9006');
    await okData(
      assign([
        { lineId: lineIdOf(dto, 'BRKN9001'), from: null, to: route.one?.id ?? null },
        { lineId: six, from: null, to: route.one?.id ?? null },
      ]),
    );
    await okData(lineAction(planId, lineById(await getPlan(planId), six), 'cancel', 'لن تُغذّى'));
    const sheets = await okData<AtmRoutesPrintDto>(
      call('post', '/atm/control/prints', 'alphaCtl', {
        kind: 'routes',
        branchId: ALPHA,
        replenishDate: day(13),
      }),
    );
    const sheet = sheets.routes.find((r) => r.id === route.one?.id);
    expect(sheet?.rows.map((r) => r.machineCode)).toEqual(['BRKN9001']);
    expect(sheet?.rows[0]?.qrs.length).toBeGreaterThan(0);
    expect(sheets.unassigned).toBe(5);
    for (const printed of sheets.routes) {
      expect(
        await auditsOf({
          'entityRef.entityType': 'dispatchRoute',
          'entityRef.entityId': printed.id,
          action: 'atmSettlementPrint',
        }),
      ).toHaveLength(1);
    }
    const out = await call('post', '/atm/control/prints', 'alphaCtl', {
      kind: 'routes',
      branchId: BETA,
      replenishDate: day(13),
    });
    expect(out.status).toBe(400);
    expect(detailCodes(out)).toEqual(['OUT_OF_REACH']);
    // A body branch is the page's work branch: at «كل الفروع» there is none yet (§6.2).
    const body = { kind: 'routes', branchId: ALPHA, replenishDate: day(13) };
    const blocked = await call('post', '/atm/control/prints', 'orgSettle', body);
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked)).toBe('ATM_WORK_BRANCH_REQUIRED');
    // The top bar narrows an organization grant too: Alpha is then outside the reach.
    const elsewhere = await call('post', '/atm/control/prints', 'orgSettle', body, BETA);
    expect(elsewhere.status).toBe(400);
    expect(detailCodes(elsewhere)).toEqual(['OUT_OF_REACH']);
    expect((await call('post', '/atm/control/prints', 'orgSettle', body, ALPHA)).status).toBe(200);
  });
});

// ── 17. Realtime ────────────────────────────────────────────────────────────────────────────────

describe('17. realtime (§6.11, DS-26)', () => {
  const rooms = (): string[] => vi.mocked(emitToRoom).mock.calls.map(([room]) => room);

  it('each write publishes on its topic; issue, capture and moves also send the day signals with the branch', async () => {
    const emitted = vi.mocked(emitToRoom);
    emitted.mockClear();
    const plan = await createPlan(day(15));
    expect(rooms()).toContain(topicRoom(realtimeTopic('atm', 'settlementPlan')));
    await addOk(plan.id, 1, [{ machineCode: 'BRKN9001', scheduleTime: '08:00' }]);
    expect(rooms()).toContain(topicRoom('atm.planLine'));

    emitted.mockClear();
    await issueAll(plan.id);
    expect(rooms()).toEqual(
      expect.arrayContaining([
        topicRoom('atm.planLine'),
        branchTopicRoom('atm.preparationDay', ALPHA),
        branchTopicRoom('atm.controlDay', ALPHA),
      ]),
    );

    emitted.mockClear();
    const line = lineOf(await getPlan(plan.id), 'BRKN9001');
    await okData(savePrep(await prepOf(plan.id, line.id), { seals: { 1: 'SEAL-T-9001' } }));
    expect(rooms()).toEqual(
      expect.arrayContaining([
        topicRoom('atm.linePreparation'),
        branchTopicRoom('atm.controlDay', ALPHA),
      ]),
    );
    expect(rooms()).not.toContain(branchTopicRoom('atm.preparationDay', ALPHA));

    emitted.mockClear();
    const route = await okData<AtmControlRouteDto>(
      call('post', '/atm/control/routes', 'alphaCtl', {
        branchId: ALPHA,
        replenishDate: day(15),
        name: 'Line RT',
        leaderName: null,
      }),
    );
    expect(rooms()).toContain(topicRoom('atm.dispatchRoute'));
    emitted.mockClear();
    await okData(
      call('put', '/atm/control/assignments', 'alphaCtl', {
        branchId: ALPHA,
        replenishDate: day(15),
        moves: [{ lineId: line.id, from: null, to: route.id }],
      }),
    );
    expect(rooms()).toEqual(
      expect.arrayContaining([
        topicRoom('atm.routeAssignment'),
        branchTopicRoom('atm.controlDay', ALPHA),
      ]),
    );

    emitted.mockClear();
    const detail = await layoutDetail('alphaSettle', machine.A7 ?? '');
    await okData(
      putLayout('alphaSettle', machine.A7 ?? '', STD4, {
        version: detail.layout?.version ?? 0,
        typeLabel: 'BRK (S3)',
      }),
    );
    expect(rooms()).toContain(topicRoom('atm.cassetteLayout'));
    emitted.mockClear();
    await okData(
      call('post', '/atm/settlements/standard-loads', 'alphaSettle', {
        branchId: ALPHA,
        bankCode: 'BRK',
        label: 'حمولة اختبار RT',
        isDefault: false,
        notes: [{ denomination: 100, notes: 100 }],
      }),
    );
    expect(rooms()).toContain(topicRoom('atm.standardLoad'));
  });

  it('an import run publishes no topic of its own; the layouts it writes do', async () => {
    await brkMachine('RT', 'BRKN9220');
    const book = await buildMasterWorkbook({
      fullList: [fullListRow('BRKN9220', [200, 200, 100, 50])],
    });
    const preview = await previewOf(book);
    const emitted = vi.mocked(emitToRoom);
    emitted.mockClear();
    await okData(importBook('alphaSettle', book, applyFields(preview, 'newOnly')));
    expect(rooms()).not.toContain(topicRoom('atm.layoutImport'));
    expect(rooms()).toContain(topicRoom('atm.cassetteLayout'));
  });
});

// ── 18. The index builder's report ──────────────────────────────────────────────────────────────

describe("18. the index builder's report (§4.10)", () => {
  it('a duplicate on atm_line_preparations is reported by counts only', async () => {
    const collection = AtmLinePreparationModel.collection;
    await collection.dropIndex('ux_line');
    const lineId = new Types.ObjectId();
    const row = {
      planId: new Types.ObjectId(),
      branchId: oid(ALPHA),
      bankCode: 'BRK',
      replenishDate: day(-200),
      bags: [],
      seals: [],
      status: 'open',
      isDeleted: false,
    };
    const inserted = await collection.insertMany([
      { ...row, lineId },
      { ...row, lineId },
    ]);
    const errors = vi.spyOn(logger, 'error');
    try {
      await migrateAtmIndexes();
      const reported = errors.mock.calls.find((c) =>
        JSON.stringify(c[0]).includes('atm_line_preparations'),
      );
      expect(reported?.[0]).toEqual({
        collection: 'atm_line_preparations',
        index: 'ux_line',
        groups: 1,
        rows: 2,
      });
      expect(JSON.stringify(reported)).not.toContain(String(lineId));
    } finally {
      errors.mockRestore();
      await collection.deleteMany({ _id: { $in: Object.values(inserted.insertedIds) } });
      await migrateAtmIndexes();
    }
    expect((await collection.listIndexes().toArray()).map((index) => index.name)).toContain(
      'ux_line',
    );
  });
});
