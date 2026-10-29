// «نقل البيانات» — GET/POST /atm/branch-links/:sourceBranchId/move, over real HTTP, real RBAC and a
// real replica set (the move writes in transactions).
//
// The owner (2026-10-28): «أنا عايز كل ماكينه تظهر فى الفرع بتاعها طبقاً للفرع المتسجله فيه». With
// October linked to Mohandessin, everything ATM filed under October BEFORE the link — the workbook
// rows, their machines, their mail, the map, the settlements — is previewed, then moved under
// Mohandessin: every collision a branch-keyed unique index would raise is merged first (labels,
// machine twins, zone and line names, default standard loads), the setting values and the mailbox
// list are re-pointed, and not one row is left under October. A source holding what the move must
// not guess past (an active machine in both, a twin still open, colliding Note serials, a plan of
// one bank and day in both, the map caps, a running Full list import, another move) is refused 409
// with each named, and nothing moves. Only `atmSettings.manage` held company-wide may do either.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ATM_BRANCH_MOVE_COLLECTIONS,
  AtmSettingKeys,
  SettingKeys,
  emptyAtmBranchMoveCounts,
  platformPermissions,
  type AtmBranchMoveCollection,
  type AtmBranchMoveCountsDto,
  type AtmBranchMovePreviewDto,
  type AtmBranchMoveResultDto,
  type AtmMachineDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { AtmBranchMoveRunModel } from '../../src/modules/atm/branch-links/branch-move-run.model';
import {
  setBeforeSettlementsForTests,
  setBeforeTwinRetireForTests,
} from '../../src/modules/atm/branch-links/branch-move.service';
import {
  backfillAtmAreaLabels,
  ensureAreaLabels,
} from '../../src/modules/atm/catalogs/area-labels';
import { AtmRefLabelModel } from '../../src/modules/atm/catalogs/ref-label.model';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { AtmMailTicketModel } from '../../src/modules/atm/mail-tickets/mail-ticket.model';
import { AtmMailboxConfigModel } from '../../src/modules/atm/mail-tickets/mailbox-config.model';
import { AtmMaintenanceModel } from '../../src/modules/atm/maintenances/maintenance.model';
import { AtmMachineLocationModel } from '../../src/modules/atm/map/machine-location.model';
import { AtmMapZoneSetModel } from '../../src/modules/atm/map/zone-set.model';
import { AtmMapZoneModel } from '../../src/modules/atm/map/zone.model';
import { AtmRegisterEntryModel } from '../../src/modules/atm/register/register.model';
import { AtmReplenishmentModel } from '../../src/modules/atm/replenishments/replenishment.model';
import { AtmDispatchRouteModel } from '../../src/modules/atm/settlements/control/dispatch-route.model';
import { AtmRouteAssignmentModel } from '../../src/modules/atm/settlements/control/route-assignment.model';
import { AtmLayoutImportRunModel } from '../../src/modules/atm/settlements/import/layout-import-run.model';
import { AtmCassetteLayoutVersionModel } from '../../src/modules/atm/settlements/layouts/cassette-layout-version.model';
import { AtmCassetteLayoutModel } from '../../src/modules/atm/settlements/layouts/cassette-layout.model';
import { AtmPlanLineModel } from '../../src/modules/atm/settlements/plans/plan-line.model';
import { AtmReplenishmentPlanModel } from '../../src/modules/atm/settlements/plans/plan.model';
import { AtmLinePreparationModel } from '../../src/modules/atm/settlements/preparation/line-preparation.model';
import { AtmStandardLoadModel } from '../../src/modules/atm/settlements/standard-loads/standard-load.model';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminCtx: AuthContext;
let adminToken: string;
let operatorToken: string; // the operating bundle at BRANCH scope, placed in Mohandessin
let branchHolderToken: string; // atmSettings.manage at BRANCH scope

let MOH: string; // the target
let OCT: string; // the main source
let TAN: string; // the blocked source's target
let BLK: string; // a source holding every blocker
let ZAY: string; // a second source into Mohandessin
let HEL: string; // a source whose run is cut off part-way

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-branch-move-test-${Date.now()}`;
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

const call = (
  method: 'get' | 'put' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

const preview = (source: string, token = adminToken) =>
  call('get', `/atm/branch-links/${source}/move`, token);
const move = (source: string, token = adminToken) =>
  call('post', `/atm/branch-links/${source}/move`, token);

const errorOf = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; details?: { field: string; code: string; message: string }[] };
    }
  ).error;

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const MODELS: Record<AtmBranchMoveCollection, { countDocuments: (f: object) => unknown }> = {
  machines: AtmMachineModel,
  registerEntries: AtmRegisterEntryModel,
  mailTickets: AtmMailTicketModel,
  maintenances: AtmMaintenanceModel,
  replenishments: AtmReplenishmentModel,
  refLabels: AtmRefLabelModel,
  machineLocations: AtmMachineLocationModel,
  cassetteLayouts: AtmCassetteLayoutModel,
  cassetteLayoutVersions: AtmCassetteLayoutVersionModel,
  mapZones: AtmMapZoneModel,
  dispatchRoutes: AtmDispatchRouteModel,
  routeAssignments: AtmRouteAssignmentModel,
  standardLoads: AtmStandardLoadModel,
  replenishmentPlans: AtmReplenishmentPlanModel,
  planLines: AtmPlanLineModel,
  linePreparations: AtmLinePreparationModel,
  layoutImportRuns: AtmLayoutImportRunModel,
} as unknown as Record<AtmBranchMoveCollection, { countDocuments: (f: object) => unknown }>;

/** Rows filed under the branch, read straight from the database. */
const rowsUnder = async (branchId: string): Promise<AtmBranchMoveCountsDto> => {
  const counts = emptyAtmBranchMoveCounts();
  for (const collection of ATM_BRANCH_MOVE_COLLECTIONS) {
    const query = MODELS[collection].countDocuments({ branchId: oid(branchId) }) as {
      exec: () => Promise<number>;
    };
    counts[collection] = await query.exec();
  }
  return counts;
};

// ── Seeding: rows written through the models (the migrations' way), raw where a row's other fields
//    play no part in the move ──────────────────────────────────────────────────────────────────────

const mkMachine = async (
  branchId: string,
  machineCode: string,
  over: { isActive?: boolean; isDeleted?: boolean } = {},
): Promise<string> => {
  const doc = await AtmMachineModel.create({
    branchId: oid(branchId),
    bankName: 'NBE',
    machineCode,
    name: `ATM ${machineCode}`,
    area: 'الدقي',
    isActive: over.isActive ?? true,
    isDeleted: over.isDeleted ?? false,
  });
  return String(doc._id);
};

const mkEntry = async (
  branchId: string | null,
  machineCode: string,
  machineId: string | null,
  status: 'open' | 'ended',
): Promise<string> => {
  const doc = await AtmRegisterEntryModel.create({
    branchId: branchId === null ? null : oid(branchId),
    machineCode,
    machineId: machineId === null ? null : oid(machineId),
    status,
    source: 'manual',
    bankCode: 'NBE',
    name: `ATM ${machineCode}`,
    area: 'الدقي',
  });
  return String(doc._id);
};

const mkLabel = async (
  branchId: string,
  kind: 'bank' | 'area',
  name: string,
  over: Record<string, unknown> = {},
): Promise<string> => {
  const doc = await AtmRefLabelModel.create({ branchId: oid(branchId), kind, name, ...over });
  return String(doc._id);
};

const square = [
  { lat: 30.05, lng: 31.2 },
  { lat: 30.06, lng: 31.2 },
  { lat: 30.06, lng: 31.21 },
];

const mkZone = async (
  branchId: string,
  name: string,
  order: number,
  over: Record<string, unknown> = {},
): Promise<string> => {
  const doc = await AtmMapZoneModel.create({
    branchId: oid(branchId),
    name,
    color: '#336699',
    order,
    points: square,
    ...over,
  });
  return String(doc._id);
};

const mkRoute = async (
  branchId: string,
  replenishDate: string,
  name: string,
  order: number,
): Promise<string> => {
  const doc = await AtmDispatchRouteModel.create({
    branchId: oid(branchId),
    replenishDate,
    name,
    nameKey: name.trim().replace(/\s+/g, ' ').toLowerCase(),
    order,
  });
  return String(doc._id);
};

const mkLoad = async (
  branchId: string,
  bankCode: string,
  isDefault: boolean,
  order: number,
): Promise<string> => {
  const doc = await AtmStandardLoadModel.create({
    branchId: oid(branchId),
    bankCode,
    label: null,
    isDefault,
    order,
    notes: [{ denomination: 200, notes: 1_000 }],
  });
  return String(doc._id);
};

const mkPlan = async (branchId: string, bankCode: string, replenishDate: string) => {
  const doc = await AtmReplenishmentPlanModel.create({
    branchId: oid(branchId),
    bankCode,
    replenishDate,
  });
  return String(doc._id);
};

/** A plan line with only what the move reads — the bank, the serials, the branch. */
const mkLine = async (
  branchId: string,
  planId: string,
  bankCode: string,
  serial: number | null,
  voided: number[] = [],
): Promise<string> => {
  const inserted = await AtmPlanLineModel.collection.insertOne({
    planId: oid(planId),
    branchId: oid(branchId),
    bankCode,
    replenishDate: '2026-10-30',
    kind: 'machine',
    status: serial === null ? 'draft' : 'issued',
    serial,
    voidedSerials: voided.map((value) => ({ serial: value, at: new Date() })),
    isDeleted: false,
    __v: 0,
  });
  return String(inserted.insertedId);
};

const mkLayoutRun = async (
  branchId: string,
  bankCode: string,
  state: 'running' | 'done',
  minutesAgo: number,
): Promise<string> => {
  const doc = await AtmLayoutImportRunModel.create({
    branchId: oid(branchId),
    bankCode,
    fileName: 'full-list.xlsx',
    fileSha256: 'a'.repeat(64),
    state,
    startedAt: new Date(Date.now() - minutesAgo * 60_000),
    mode: 'newOnly',
    standardLoads: false,
  });
  return String(doc._id);
};

/** What the main source holds, by name — read back after the move. */
const ids: Record<string, string> = {};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-move-admin@ecms.local');
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
  adminToken = await login('atm-move-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await call('post', '/platform/branches', adminToken, { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  MOH = await mkBranch('80', 'المهندسين', 'Mohandessin');
  OCT = await mkBranch('81', 'أكتوبر', 'October');
  TAN = await mkBranch('82', 'طنطا', 'Tanta');
  BLK = await mkBranch('83', 'بنها', 'Banha');
  ZAY = await mkBranch('84', 'الشيخ زايد', 'Sheikh Zayed');
  HEL = await mkBranch('85', 'مصر الجديدة', 'Heliopolis');

  const linked = await call('put', '/atm/branch-links', adminToken, {
    links: [
      { branchId: OCT, actsAsBranchId: MOH },
      { branchId: BLK, actsAsBranchId: TAN },
      { branchId: ZAY, actsAsBranchId: MOH },
      { branchId: HEL, actsAsBranchId: MOH },
    ],
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);

  const operatorRole = await rbacService.createRole(
    {
      name: { en: 'ATM operator', ar: 'مشغل صراف آلي' },
      permissionKeys: [
        'atmMachine.view',
        'atmReplenishment.view',
        'atmReplenishment.create',
        'atmMaintenance.view',
        'atmMaintenance.create',
      ],
    },
    adminId,
  );
  const operator = await mkUser('atm-move-operator@ecms.local', MOH);
  await rbacService.ensureAssignment(operator, String(operatorRole._id), 'branch');
  operatorToken = await login('atm-move-operator@ecms.local');

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holder = await mkUser('atm-move-holder@ecms.local', MOH);
  await rbacService.ensureAssignment(holder, String(settingsRole._id), 'branch');
  branchHolderToken = await login('atm-move-holder@ecms.local');

  // ── October (the source) and Mohandessin (the target) ──────────────────────────────────────
  // Labels: a bank spelling and an area live in both, an area Mohandessin renamed away, an area
  // only October has, an area October deleted.
  ids.tBank = await mkLabel(MOH, 'bank', 'NBE FOREX', { bankCode: null });
  ids.tDokki = await mkLabel(MOH, 'area', 'الدقي', {
    nameAr: 'الدقي',
    nameEn: null,
    formerNames: ['دقي قديم'],
  });
  ids.tGiza = await mkLabel(MOH, 'area', 'الجيزة الجديدة', { formerNames: ['جيزة'] });
  ids.sBank = await mkLabel(OCT, 'bank', 'NBE FOREX', { bankCode: 'NBE' });
  ids.sDokki = await mkLabel(OCT, 'area', 'الدقي', {
    nameAr: 'الدقي',
    nameEn: 'Dokki',
    formerNames: ['دقي'],
  });
  ids.sGiza = await mkLabel(OCT, 'area', 'جيزة');
  ids.sHaram = await mkLabel(OCT, 'area', 'الهرم');
  ids.sFaisal = await mkLabel(OCT, 'area', 'فيصل', { isDeleted: true, deletedAt: new Date() });

  // Machines: the four twin cases, a machine only October has, and a deleted master.
  ids.sB1 = await mkMachine(OCT, 'B1'); // (b) active here …
  ids.tB1 = await mkMachine(MOH, 'B1', { isActive: false }); // … archived in the target
  ids.sC1 = await mkMachine(OCT, 'C1', { isActive: false }); // (c) archived here …
  ids.tC1 = await mkMachine(MOH, 'C1'); // … active in the target
  ids.sD1 = await mkMachine(OCT, 'D1', { isActive: false }); // (d) archived in both
  ids.tD1 = await mkMachine(MOH, 'D1', { isActive: false });
  ids.sA1 = await mkMachine(OCT, 'A1'); // (a) active in both, October's holds the open period
  ids.tA1 = await mkMachine(MOH, 'A1');
  ids.sP1 = await mkMachine(OCT, 'P1');
  ids.sZ1 = await mkMachine(OCT, 'Z1-D', { isDeleted: true });

  // The register: the open periods of A1 and P1, an ended one of P1, a branch-less row (stays).
  ids.eA1 = await mkEntry(OCT, 'A1', ids.sA1, 'open');
  ids.eP1 = await mkEntry(OCT, 'P1', ids.sP1, 'open');
  ids.eP1old = await mkEntry(OCT, 'P1', ids.sP1, 'ended');
  ids.eNoBranch = await mkEntry(null, 'N1', null, 'ended');
  await mkEntry(MOH, 'C1', ids.tC1, 'open');

  // P1's mail, the maintenance opened from it, a closed replenishment, its point and layout.
  const yesterday = new Date(Date.now() - 24 * 3_600_000);
  const ticket = await AtmMailTicketModel.create({
    branchId: oid(OCT),
    machineId: oid(ids.sP1),
    machineCode: 'P1',
    bankName: 'NBE',
    machineName: 'ATM P1',
    area: 'الدقي',
    receivedAt: yesterday,
    status: 'accepted',
    issueText: 'out of cash',
    providerMessageId: 'msg-move-1',
  });
  ids.ticket = String(ticket._id);
  await AtmMaintenanceModel.create({
    branchId: oid(OCT),
    machineId: oid(ids.sP1),
    machineCode: 'P1',
    bankName: 'NBE',
    machineName: 'ATM P1',
    area: 'الدقي',
    openedAt: yesterday,
    openDay: '2026-10-27',
    closedAt: yesterday,
    source: 'mail',
    mailTicketId: ticket._id,
  });
  await AtmReplenishmentModel.create({
    branchId: oid(OCT),
    machineId: oid(ids.sP1),
    machineCode: 'P1',
    bankName: 'NBE',
    machineName: 'ATM P1',
    area: 'الدقي',
    openedAt: yesterday,
    openDay: '2026-10-27',
    closedAt: yesterday,
  });
  await AtmMachineLocationModel.collection.insertOne({
    machineId: oid(ids.sP1),
    branchId: oid(OCT),
    status: 'located',
    isDeleted: false,
  });
  await AtmCassetteLayoutModel.collection.insertOne({
    machineId: oid(ids.sP1),
    branchId: oid(OCT),
    revision: 1,
    isDeleted: false,
  });
  await AtmCassetteLayoutVersionModel.collection.insertOne({
    machineId: oid(ids.sP1),
    branchId: oid(OCT),
    revision: 1,
    isDeleted: false,
  });
  // (a)'s twin to retire, Mohandessin's A1, holds a cassette layout with two versions and a point;
  // the master that stays, October's A1, has none — so they follow it (review finding: it could
  // not be planned until the Full list was imported again).
  const insertedId = async (inserted: Promise<{ insertedId: Types.ObjectId }>) =>
    String((await inserted).insertedId);
  ids.tA1Layout = await insertedId(
    AtmCassetteLayoutModel.collection.insertOne({
      machineId: oid(ids.tA1),
      branchId: oid(MOH),
      revision: 2,
      isDeleted: false,
    }),
  );
  for (const revision of [1, 2]) {
    await AtmCassetteLayoutVersionModel.collection.insertOne({
      machineId: oid(ids.tA1),
      branchId: oid(MOH),
      revision,
      isDeleted: false,
    });
  }
  ids.tA1Location = await insertedId(
    AtmMachineLocationModel.collection.insertOne({
      machineId: oid(ids.tA1),
      branchId: oid(MOH),
      status: 'located',
      isDeleted: false,
    }),
  );

  // The map: «قطاع 1» in both; each branch's zone set; a zone October deleted.
  await mkZone(MOH, 'قطاع 1', 0);
  await mkZone(MOH, 'قطاع 2', 1);
  await AtmMapZoneSetModel.create({ branchId: oid(MOH), revision: 3 });
  ids.sZone1 = await mkZone(OCT, 'قطاع 1', 0);
  ids.sZone3 = await mkZone(OCT, 'قطاع 3', 1);
  ids.sZoneGone = await mkZone(OCT, 'قديم', 0, { isDeleted: true });
  await AtmMapZoneSetModel.create({ branchId: oid(OCT), revision: 5 });

  // Dispatch lines: «Route A» on the 28th in both; October's other line, and its line of the 29th.
  await mkRoute(MOH, '2026-10-28', 'Route A', 0);
  ids.sRouteA = await mkRoute(OCT, '2026-10-28', 'Route A', 0);
  ids.sRouteB = await mkRoute(OCT, '2026-10-28', 'Route B', 1);
  ids.sRouteE = await mkRoute(OCT, '2026-10-29', 'Route A', 0);
  await AtmRouteAssignmentModel.create({
    lineId: new Types.ObjectId(),
    routeId: oid(ids.sRouteB),
    branchId: oid(OCT),
    replenishDate: '2026-10-28',
  });

  // Standard loads: a BRK default in both.
  ids.tLoad = await mkLoad(MOH, 'BRK', true, 0);
  ids.sLoadDefault = await mkLoad(OCT, 'BRK', true, 0);
  ids.sLoadOther = await mkLoad(OCT, 'BRK', false, 1);

  // Settlements: no plan of one bank and day in both, no Note serial issued in both.
  const tPlan = await mkPlan(MOH, 'BRK', '2026-10-28');
  await mkLine(MOH, tPlan, 'BRK', 1);
  const sPlanBrk = await mkPlan(OCT, 'BRK', '2026-10-30');
  const sPlanNbe = await mkPlan(OCT, 'NBE', '2026-10-30');
  await mkLine(OCT, sPlanBrk, 'BRK', null);
  const sLine = await mkLine(OCT, sPlanNbe, 'NBE', 1);
  await AtmLinePreparationModel.collection.insertOne({
    lineId: oid(sLine),
    planId: oid(sPlanNbe),
    branchId: oid(OCT),
    bankCode: 'NBE',
    replenishDate: '2026-10-30',
    status: 'open',
    isDeleted: false,
  });
  await mkLayoutRun(OCT, 'BRK', 'done', 120);
  ids.staleRun = await mkLayoutRun(OCT, 'NBE', 'running', 40);

  // The mailbox switches October on; the settings name October.
  await AtmMailboxConfigModel.create({
    key: 'default',
    tenantId: 'tenant',
    clientId: 'client',
    clientSecretRef: null,
    userEmail: 'atm-mail@egycash.local',
    enabled: false,
    branches: [
      { branchId: oid(OCT), category: 'Orange' },
      { branchId: oid(TAN), category: null },
    ],
  });
  await settingsService.set(adminCtx, {
    key: AtmSettingKeys.MailBranchCategories,
    scope: 'organization',
    value: [{ branchId: OCT, category: 'Orange Category' }],
  });
  await settingsService.set(adminCtx, {
    key: AtmSettingKeys.RegisterBranchCodes,
    scope: 'organization',
    value: [
      { code: 'EGYCASH-5', branchId: OCT },
      { code: 'EGYCASH-2', branchId: TAN },
    ],
  });

  // ── Banha (a source holding every blocker) and Tanta ───────────────────────────────────────
  await mkMachine(BLK, 'X1'); // active in both, no open period anywhere
  await mkMachine(TAN, 'X1');
  await mkMachine(BLK, 'X2'); // the twin to retire — Tanta's archived X2 — holds an open period
  const tanX2 = await mkMachine(TAN, 'X2', { isActive: false });
  await mkEntry(TAN, 'X2', tanX2, 'open');
  const bPlan = await mkPlan(BLK, 'CIB', '2026-11-01');
  const tPlanCib = await mkPlan(TAN, 'CIB', '2026-11-01');
  await mkLine(BLK, bPlan, 'CIB', 1);
  await mkLine(TAN, tPlanCib, 'CIB', null, [1]); // Note 1 printed, then the line reopened
  // X3 and X4: Banha's are active, so Tanta's archived ones would be retired. A draft line still
  // names Tanta's X3 — it could no longer be issued once its master is retired (review finding);
  // Tanta's X4 has only a prepared line, which is history kept as its snapshot, so it goes.
  await mkMachine(BLK, 'X3');
  await mkMachine(BLK, 'X4');
  for (const [code, status, serial] of [
    ['X3', 'draft', null],
    ['X4', 'prepared', 7],
  ] as const) {
    const twin = await mkMachine(TAN, code, { isActive: false });
    await AtmPlanLineModel.collection.insertOne({
      planId: oid(tPlanCib),
      branchId: oid(TAN),
      bankCode: 'CIB',
      replenishDate: '2026-11-01',
      kind: 'machine',
      machineId: oid(twin),
      status,
      serial,
      voidedSerials: [],
      isDeleted: false,
      __v: 0,
    });
  }
  await AtmMapZoneModel.insertMany(
    Array.from({ length: 200 }, (_, i) => ({
      branchId: oid(TAN),
      name: `T${String(i)}`,
      color: '#336699',
      order: i,
      points: square,
    })),
  );
  await mkZone(BLK, 'B0', 0);
  await mkLayoutRun(BLK, 'CIB', 'running', 5);

  // ── Sheikh Zayed (a second source into Mohandessin) ────────────────────────────────────────
  ids.sQ1 = await mkMachine(ZAY, 'Q1');
  // … and Mohandessin's archived Q1, retired by that move: both hold a cassette layout, so the
  // twin's stays its own — the master that stays keeps the one it has.
  ids.tQ1 = await mkMachine(MOH, 'Q1', { isActive: false });
  for (const [key, machineId, branchId] of [
    ['sQ1Layout', ids.sQ1, ZAY],
    ['tQ1Layout', ids.tQ1, MOH],
  ] as const) {
    const inserted = await AtmCassetteLayoutModel.collection.insertOne({
      machineId: oid(machineId),
      branchId: oid(branchId),
      revision: 1,
      isDeleted: false,
    });
    ids[key] = String(inserted.insertedId);
  }

  // ── Heliopolis: a machine, and a plan for a day Mohandessin has none — yet ─────────────────
  await mkMachine(HEL, 'H1');
  await mkPlan(HEL, 'NBE', '2026-11-05');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

const EXPECTED_COUNTS: AtmBranchMoveCountsDto = {
  machines: 6,
  registerEntries: 3,
  mailTickets: 1,
  maintenances: 1,
  replenishments: 1,
  refLabels: 5,
  machineLocations: 1,
  cassetteLayouts: 1,
  cassetteLayoutVersions: 1,
  mapZones: 3,
  dispatchRoutes: 3,
  routeAssignments: 1,
  standardLoads: 2,
  replenishmentPlans: 2,
  planLines: 2,
  linePreparations: 1,
  layoutImportRuns: 2,
};

const EXPECTED_MERGES = {
  labelsMerged: 2,
  labelsRetired: 1,
  machineTwinsRetired: 4,
  zonesRenamed: 1,
  routesRenamed: 1,
  standardLoadDefaultsUnset: 1,
  layoutImportRunsAbandoned: 1,
  mailboxRepointed: 1,
  settingsRepointed: 2,
};

describe('the preview of October into Mohandessin', () => {
  it('counts what is filed under October, names what merges, and finds nothing that blocks', async () => {
    const res = await preview(OCT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<AtmBranchMovePreviewDto>(res);
    expect(dto).toEqual({
      sourceBranchId: OCT,
      sourceBranchName: { ar: 'أكتوبر', en: 'October' },
      targetBranchId: MOH,
      targetBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
      counts: EXPECTED_COUNTS,
      total: 36,
      merges: EXPECTED_MERGES,
      blockers: [],
      canMove: true,
    });
  });

  it('writes nothing', async () => {
    expect(await rowsUnder(OCT)).toEqual(EXPECTED_COUNTS);
    expect(await AtmBranchMoveRunModel.countDocuments().exec()).toBe(0);
    const stale = await AtmLayoutImportRunModel.findById(ids.staleRun).lean().exec();
    expect(stale?.state).toBe('running');
  });
});

describe('a source holding what the move must not guess past', () => {
  const ALL_KINDS = [
    'machineActiveInBoth',
    'machineTwinOpen',
    'planSerialCollision',
    'planSameDay',
    'zoneCaps',
    'layoutImportRunning',
    'moveRunning',
  ];

  it('lists every blocker with what it names', async () => {
    // Another move holding the lock — fresh, so it is no stale run to take over.
    const other = await AtmBranchMoveRunModel.create({
      sourceBranchId: oid(ZAY),
      targetBranchId: oid(MOH),
      state: 'running',
      startedAt: new Date(),
    });
    try {
      const res = await preview(BLK);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const dto = data<AtmBranchMovePreviewDto>(res);
      expect(dto.blockers).toEqual([
        { kind: 'machineActiveInBoth', codes: ['X1'] },
        { kind: 'machineTwinOpen', codes: ['X2', 'X3'] },
        { kind: 'planSerialCollision', bankCodes: ['CIB'] },
        { kind: 'planSameDay', items: [{ bankCode: 'CIB', replenishDate: '2026-11-01' }] },
        { kind: 'zoneCaps', zones: 201, points: 603 },
        { kind: 'layoutImportRunning', bankCodes: ['CIB'] },
        { kind: 'moveRunning' },
      ]);
      expect(dto.canMove).toBe(false);

      // The move is refused 409 with each one named, and nothing moves.
      const before = await rowsUnder(BLK);
      const refused = await move(BLK);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      const error = errorOf(refused);
      expect(error.code).toBe('ATM_BRANCH_MOVE_BLOCKED');
      expect(error.details?.map((detail) => detail.code)).toEqual(ALL_KINDS);
      expect(error.details?.every((detail) => detail.field === 'blockers')).toBe(true);
      expect(error.details?.[0]?.message).toContain('X1');
      expect(await rowsUnder(BLK)).toEqual(before);
      expect(await AtmBranchMoveRunModel.countDocuments().exec()).toBe(1);
      expect(await AuditLogModel.countDocuments({ action: 'atmBranchMove' }).exec()).toBe(0);
    } finally {
      await AtmBranchMoveRunModel.deleteOne({ _id: other._id }).exec();
    }
  });

  it('takes over a move left running for 30 minutes instead of waiting for it', async () => {
    const dead = await AtmBranchMoveRunModel.create({
      sourceBranchId: oid(ZAY),
      targetBranchId: oid(MOH),
      state: 'running',
      startedAt: new Date(Date.now() - 31 * 60_000),
    });
    const dto = data<AtmBranchMovePreviewDto>(await preview(BLK));
    expect(dto.blockers.map((blocker) => blocker.kind)).toEqual(ALL_KINDS.slice(0, -1));
    // The refused attempt still took the stale lock over, and left no row of its own.
    const refused = await move(BLK);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).details?.map((detail) => detail.code)).toEqual(ALL_KINDS.slice(0, -1));
    const after = await AtmBranchMoveRunModel.findById(dead._id).lean().exec();
    expect(after).toMatchObject({ state: 'failed', error: 'stale' });
    expect(await AtmBranchMoveRunModel.countDocuments().exec()).toBe(1);
    // Its request died before the end, so before its audit row: it gets that row when taken over.
    const audits = await AuditLogModel.find({
      action: 'atmBranchMove',
      'entityRef.entityId': String(dead._id),
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(1);
    const fields = new Map(audits[0]?.changes.map((change) => [change.field, change.new]));
    expect(fields.get('state')).toBe('failed');
    expect(fields.get('error')).toBe('stale');
    expect(fields.get('sourceBranchId')).toBe(ZAY);
    await AtmBranchMoveRunModel.deleteOne({ _id: dead._id }).exec();
  });

  it('refuses to file anything under a target that is no longer active', async () => {
    await BranchModel.updateOne({ _id: oid(TAN) }, { $set: { status: 'inactive' } }).exec();
    try {
      const res = await move(BLK);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    } finally {
      await BranchModel.updateOne({ _id: oid(TAN) }, { $set: { status: 'active' } }).exec();
    }
  });
});

describe('October moved into Mohandessin', () => {
  let result: AtmBranchMoveResultDto;
  let ticketBefore: { __v: number; updatedAt: Date } | null;

  beforeAll(async () => {
    ticketBefore = await AtmMailTicketModel.findById(ids.ticket)
      .lean<{ __v: number; updatedAt: Date }>()
      .exec();
    const res = await move(OCT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    result = data<AtmBranchMoveResultDto>(res);
  });

  it('answers what it moved and merged, and that nothing is left under October', async () => {
    expect(result).toMatchObject({
      sourceBranchId: OCT,
      sourceBranchName: { ar: 'أكتوبر', en: 'October' },
      targetBranchId: MOH,
      targetBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
      moved: EXPECTED_COUNTS,
      total: 36,
      merges: EXPECTED_MERGES,
      remaining: emptyAtmBranchMoveCounts(),
    });
    expect(await rowsUnder(OCT)).toEqual(emptyAtmBranchMoveCounts());
  });

  it('records the run and ONE audit row for it', async () => {
    const run = await AtmBranchMoveRunModel.findById(result.runId).lean().exec();
    expect(run).toMatchObject({
      state: 'done',
      moved: EXPECTED_COUNTS,
      merges: EXPECTED_MERGES,
      remaining: emptyAtmBranchMoveCounts(),
      error: null,
    });
    expect(String(run?.sourceBranchId)).toBe(OCT);
    expect(String(run?.targetBranchId)).toBe(MOH);
    const audits = await AuditLogModel.find({
      action: 'atmBranchMove',
      'entityRef.entityId': result.runId,
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityRef).toEqual({
      moduleId: 'atm',
      entityType: 'branchMove',
      entityId: result.runId,
    });
    const changes = new Map(audits[0]?.changes.map((change) => [change.field, change.new]));
    expect(changes.get('sourceBranchId')).toBe(OCT);
    expect(changes.get('targetBranchId')).toBe(MOH);
    expect(changes.get('moved')).toEqual(EXPECTED_COUNTS);
    expect(changes.get('merges')).toEqual(EXPECTED_MERGES);
    expect(changes.get('retiredMachines')).toHaveLength(4);

    // Each retired twin has its own `delete` row as well, written as its batch committed — the
    // legacy delete's trail — so a run cut off afterwards, which never reaches its own audit row,
    // still leaves which masters it retired and what they were (review finding).
    const retiredIds = [ids.tA1, ids.tB1, ids.sC1, ids.sD1].map(String).sort();
    const deletes = await AuditLogModel.find({
      action: 'delete',
      'entityRef.moduleId': 'atm',
      'entityRef.entityType': 'machine',
      'entityRef.entityId': { $in: retiredIds },
    })
      .lean()
      .exec();
    expect(deletes.map((row) => row.entityRef.entityId).sort()).toEqual(retiredIds);
    const b1 = deletes.find((row) => row.entityRef.entityId === ids.tB1)?.changes ?? [];
    expect(b1).toContainEqual({ field: 'machineCode', old: 'B1', new: null });
    expect(b1).toContainEqual({ field: 'branchId', old: MOH, new: null });
  });

  it('merges the labels: Mohandessin’s rows stay and take only what they left empty', async () => {
    const label = (id: string | undefined) =>
      AtmRefLabelModel.findById(id).lean().exec() as Promise<Record<string, unknown> | null>;
    expect(await label(ids.tBank)).toMatchObject({ bankCode: 'NBE', isDeleted: false });
    expect(await label(ids.tDokki)).toMatchObject({
      nameAr: 'الدقي',
      nameEn: 'Dokki',
      formerNames: ['دقي قديم', 'دقي'],
      isDeleted: false,
    });
    // October's merged and renamed-away rows: retired, and filed under Mohandessin with the rest.
    for (const id of [ids.sBank, ids.sDokki, ids.sGiza, ids.sFaisal]) {
      expect(await label(id)).toMatchObject({ branchId: oid(MOH), isDeleted: true });
    }
    expect(await label(ids.sHaram)).toMatchObject({ branchId: oid(MOH), isDeleted: false });
    // One live row per name: the unique index would hold, built or not.
    const live = await AtmRefLabelModel.aggregate<{ _id: unknown; n: number }>([
      { $match: { branchId: oid(MOH), isDeleted: false } },
      { $group: { _id: { kind: '$kind', name: '$name' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).exec();
    expect(live).toEqual([]);
  });

  it('resolves every machine twin, and leaves one live master per code', async () => {
    const machine = (id: string | undefined) => AtmMachineModel.findById(id).lean().exec();
    // (b) the target's archived twin retired the legacy way; October's active one moved.
    expect(await machine(ids.tB1)).toMatchObject({ machineCode: 'B1-D', isDeleted: true });
    expect(await machine(ids.sB1)).toMatchObject({
      branchId: oid(MOH),
      machineCode: 'B1',
      isActive: true,
      isDeleted: false,
    });
    // (c) October's archived twin retired; (d) October's retired, the target's archived one stays.
    expect(await machine(ids.sC1)).toMatchObject({ machineCode: 'C1-D', isDeleted: true });
    expect(await machine(ids.tC1)).toMatchObject({ machineCode: 'C1', isDeleted: false });
    expect(await machine(ids.sD1)).toMatchObject({ machineCode: 'D1-D', isDeleted: true });
    expect(await machine(ids.tD1)).toMatchObject({ machineCode: 'D1', isDeleted: false });
    // (a) the twin holding the open register period stays; the other is retired.
    expect(await machine(ids.tA1)).toMatchObject({ machineCode: 'A1-D', isDeleted: true });
    expect(await machine(ids.sA1)).toMatchObject({ branchId: oid(MOH), isDeleted: false });
    const twins = await AtmMachineModel.aggregate<{ _id: string }>([
      { $match: { branchId: oid(MOH), isDeleted: false } },
      { $group: { _id: '$machineCode', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).exec();
    expect(twins).toEqual([]);
  });

  it('hands a retired twin’s layout and point to the master that stays when it has none', async () => {
    const layout = await AtmCassetteLayoutModel.findById(ids.tA1Layout).lean().exec();
    expect(String(layout?.machineId)).toBe(ids.sA1);
    expect(String(layout?.branchId)).toBe(MOH);
    expect(layout?.revision).toBe(2);
    const versions = await AtmCassetteLayoutVersionModel.find({ machineId: oid(String(ids.sA1)) })
      .lean()
      .exec();
    expect(versions.map((version) => version.revision).sort()).toEqual([1, 2]);
    const point = await AtmMachineLocationModel.findById(ids.tA1Location).lean().exec();
    expect(String(point?.machineId)).toBe(ids.sA1);
    expect(
      await AtmCassetteLayoutModel.countDocuments({ machineId: oid(String(ids.tA1)) }).exec(),
    ).toBe(0);
    // The run's audit row says which master stayed and what it took.
    const audit = await AuditLogModel.findOne({
      action: 'atmBranchMove',
      'entityRef.entityId': result.runId,
    })
      .lean()
      .exec();
    const retiredRows = audit?.changes.find((change) => change.field === 'retiredMachines')?.new;
    expect(retiredRows).toContainEqual({
      machineId: ids.tA1,
      machineCode: 'A1',
      branchId: MOH,
      survivorId: ids.sA1,
      layoutAdopted: true,
      locationAdopted: true,
    });
  });

  it('moves what follows the machines — and leaves a branch-less register row alone', async () => {
    const entry = await AtmRegisterEntryModel.findById(ids.eA1).lean().exec();
    expect(String(entry?.branchId)).toBe(MOH);
    expect(String(entry?.machineId)).toBe(ids.sA1);
    const branchless = await AtmRegisterEntryModel.findById(ids.eNoBranch).lean().exec();
    expect(branchless?.branchId).toBeNull();
    // A plain move changes the branch and nothing else: an open editor of the row can still save.
    const ticket = await AtmMailTicketModel.findById(ids.ticket)
      .lean<{ branchId: Types.ObjectId; __v: number; updatedAt: Date }>()
      .exec();
    expect(String(ticket?.branchId)).toBe(MOH);
    expect(ticket?.__v).toBe(ticketBefore?.__v);
    expect(ticket?.updatedAt.getTime()).toBe(ticketBefore?.updatedAt.getTime());
  });

  it('renames a clashing zone, orders October’s after Mohandessin’s, and moves the revision on', async () => {
    const zones = await AtmMapZoneModel.find({ branchId: oid(MOH), isDeleted: false })
      .sort({ order: 1 })
      .lean()
      .exec();
    expect(zones.map((zone) => [zone.name, zone.order])).toEqual([
      ['قطاع 1', 0],
      ['قطاع 2', 1],
      ['قطاع 1 (أكتوبر)', 2],
      ['قطاع 3', 3],
    ]);
    const gone = await AtmMapZoneModel.findById(ids.sZoneGone).lean().exec();
    expect(gone).toMatchObject({ branchId: oid(MOH), isDeleted: true, name: 'قديم' });
    expect(
      (
        await AtmMapZoneSetModel.findOne({ branchId: oid(MOH) })
          .lean()
          .exec()
      )?.revision,
    ).toBe(4);
    // October's own set is never moved (one set per branch, and the index is not partial).
    expect(
      (
        await AtmMapZoneSetModel.findOne({ branchId: oid(OCT) })
          .lean()
          .exec()
      )?.revision,
    ).toBe(5);
  });

  it('renames a line Mohandessin uses that day and orders October’s after its own', async () => {
    const route = (id: string | undefined) => AtmDispatchRouteModel.findById(id).lean().exec();
    expect(await route(ids.sRouteA)).toMatchObject({
      branchId: oid(MOH),
      name: 'Route A (أكتوبر)',
      nameKey: 'route a (أكتوبر)',
      order: 1,
      __v: 1,
    });
    expect(await route(ids.sRouteB)).toMatchObject({ name: 'Route B', order: 2 });
    expect(await route(ids.sRouteE)).toMatchObject({ name: 'Route A', order: 0, __v: 0 });
    expect(await AtmRouteAssignmentModel.countDocuments({ branchId: oid(MOH) }).exec()).toBe(1);
  });

  it('keeps Mohandessin’s default standard load the default', async () => {
    const load = (id: string | undefined) => AtmStandardLoadModel.findById(id).lean().exec();
    expect(await load(ids.tLoad)).toMatchObject({ isDefault: true, order: 0 });
    expect(await load(ids.sLoadDefault)).toMatchObject({
      branchId: oid(MOH),
      isDefault: false,
      order: 1,
      __v: 1,
    });
    expect(await load(ids.sLoadOther)).toMatchObject({ isDefault: false, order: 2 });
  });

  it('abandons October’s stale Full list run before moving it', async () => {
    const run = await AtmLayoutImportRunModel.findById(ids.staleRun).lean().exec();
    expect(run).toMatchObject({ state: 'abandoned', branchId: oid(MOH) });
  });

  it('re-points the mailbox list and the settings that named October', async () => {
    const mailbox = await AtmMailboxConfigModel.findOne({ key: 'default' }).lean().exec();
    expect(mailbox?.branches.map((row) => [String(row.branchId), row.category])).toEqual([
      [MOH, 'Orange'],
      [TAN, null],
    ]);
    expect(mailbox?.__v).toBe(1);
    const mailboxAudits = await AuditLogModel.find({
      'entityRef.entityType': 'mailboxConfig',
      action: 'update',
    })
      .lean()
      .exec();
    expect(mailboxAudits).toHaveLength(1);
    expect(
      await settingsService.resolve(AtmSettingKeys.MailBranchCategories, {
        userId: null,
        branchId: null,
      }),
    ).toEqual([{ branchId: MOH, category: 'Orange Category' }]);
    expect(
      await settingsService.resolve(AtmSettingKeys.RegisterBranchCodes, {
        userId: null,
        branchId: null,
      }),
    ).toEqual([
      { code: 'EGYCASH-5', branchId: MOH },
      { code: 'EGYCASH-2', branchId: TAN },
    ]);
  });

  it('keeps the link: October’s people still work as Mohandessin', async () => {
    const res = await call('get', '/atm/branch-links', adminToken);
    expect(
      data<{ links: { branchId: string; actsAsBranchId: string }[] }>(res).links.map((link) => [
        link.branchId,
        link.actsAsBranchId,
      ]),
    ).toContainEqual([OCT, MOH]);
  });
});

describe('running it again', () => {
  it('moves nothing, merges nothing, and still finds nothing left', async () => {
    const dto = data<AtmBranchMovePreviewDto>(await preview(OCT));
    expect(dto.total).toBe(0);
    expect(Object.values(dto.merges).every((count) => count === 0)).toBe(true);
    expect(dto.canMove).toBe(true);
    const res = await move(OCT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const again = data<AtmBranchMoveResultDto>(res);
    expect(again.moved).toEqual(emptyAtmBranchMoveCounts());
    expect(again.total).toBe(0);
    expect(Object.values(again.merges).every((count) => count === 0)).toBe(true);
    expect(again.remaining).toEqual(emptyAtmBranchMoveCounts());
    expect((await AtmMailboxConfigModel.findOne({ key: 'default' }).lean().exec())?.__v).toBe(1);
  });
});

describe('the moved machines at work in Mohandessin', () => {
  it('shows them on Mohandessin’s list and opens an operation for one there', async () => {
    const list = await call('get', '/atm/machines?pageSize=100', operatorToken);
    expect(list.status).toBe(200);
    const codes = data<AtmMachineDto[]>(list).map((machine) => machine.machineCode);
    expect(codes).toEqual(expect.arrayContaining(['A1', 'B1', 'C1', 'P1']));
    expect(codes).not.toContain('B1-D');
    const opened = await call('post', '/atm/replenishments/open', operatorToken, {
      rows: [{ machineCode: 'B1', scheduleTime: null }],
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const result = data<{
      opened: { machineId: string; branchId: string }[];
      unknownCodes: string[];
    }>(opened);
    expect(result.unknownCodes).toEqual([]);
    expect(result.opened.map((row) => row.machineId)).toEqual([ids.sB1]);
  });
});

describe('a second source into the same target', () => {
  it('drops its mailbox row where the target is switched on, and leaves a setting the target answers', async () => {
    await AtmMailboxConfigModel.updateOne(
      { key: 'default' },
      { $push: { branches: { branchId: oid(ZAY), category: 'Blue' } } },
    ).exec();
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.MailBranchCategories,
      scope: 'organization',
      value: [
        { branchId: MOH, category: 'Orange Category' },
        { branchId: ZAY, category: 'Blue Category' },
      ],
    });
    const dto = data<AtmBranchMovePreviewDto>(await preview(ZAY));
    expect(dto.counts.machines).toBe(1);
    expect(dto.merges.mailboxRepointed).toBe(1);
    expect(dto.merges.settingsRepointed).toBe(0);

    const res = await move(ZAY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmBranchMoveResultDto>(res).moved.machines).toBe(1);
    // Mohandessin's archived Q1 retired; each master keeps its own layout (the survivor had one).
    expect(await AtmMachineModel.findById(ids.tQ1).lean().exec()).toMatchObject({
      machineCode: 'Q1-D',
      isDeleted: true,
    });
    const layoutOf = (id: string | undefined) => AtmCassetteLayoutModel.findById(id).lean().exec();
    expect(String((await layoutOf(ids.sQ1Layout))?.machineId)).toBe(ids.sQ1);
    expect(String((await layoutOf(ids.sQ1Layout))?.branchId)).toBe(MOH);
    expect(String((await layoutOf(ids.tQ1Layout))?.machineId)).toBe(ids.tQ1);
    const mailbox = await AtmMailboxConfigModel.findOne({ key: 'default' }).lean().exec();
    expect(mailbox?.branches.map((row) => String(row.branchId))).toEqual([MOH, TAN]);
    expect(
      await settingsService.resolve(AtmSettingKeys.MailBranchCategories, {
        userId: null,
        branchId: null,
      }),
    ).toEqual([
      { branchId: MOH, category: 'Orange Category' },
      { branchId: ZAY, category: 'Blue Category' },
    ]);
  });
});

describe('a run cut off part-way', () => {
  it('keeps what it moved, says so, and is continued by running it again', async () => {
    // Between the map and the settlements, Mohandessin plans NBE for the same day.
    let clash: string | null = null;
    setBeforeSettlementsForTests(async () => {
      clash = await mkPlan(MOH, 'NBE', '2026-11-05');
    });
    const cut = await move(HEL);
    expect(cut.status, JSON.stringify(cut.body)).toBe(409);
    // Not the refusal's «nothing was moved»: the machine already went (review finding).
    expect(errorOf(cut).code).toBe('ATM_BRANCH_MOVE_STOPPED');
    expect(errorOf(cut).details?.map((detail) => detail.code)).toEqual(['planSameDay']);

    const failed = await AtmBranchMoveRunModel.findOne({ sourceBranchId: oid(HEL) })
      .lean()
      .exec();
    expect(failed).toMatchObject({ state: 'failed', error: 'AppError ATM_BRANCH_MOVE_STOPPED' });
    expect(failed?.moved.machines).toBe(1);
    expect(failed?.remaining).toMatchObject({ machines: 0, replenishmentPlans: 1 });
    const audit = await AuditLogModel.findOne({
      action: 'atmBranchMove',
      'entityRef.entityId': String(failed?._id),
    })
      .lean()
      .exec();
    expect(audit?.changes.find((change) => change.field === 'state')?.new).toBe('failed');
    expect((await rowsUnder(HEL)).machines).toBe(0);

    // The administrator settles the clash; the next run carries on from what is still there.
    await AtmReplenishmentPlanModel.updateOne(
      { _id: oid(String(clash)) },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    ).exec();
    const res = await move(HEL);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = data<AtmBranchMoveResultDto>(res);
    expect(done.moved).toMatchObject({ machines: 0, replenishmentPlans: 1 });
    expect(done.remaining).toEqual(emptyAtmBranchMoveCounts());
    expect(await rowsUnder(HEL)).toEqual(emptyAtmBranchMoveCounts());
  });
});

describe('who may move', () => {
  it('refuses the key held for one branch, and a caller without it', async () => {
    for (const token of [branchHolderToken, operatorToken]) {
      expect((await preview(OCT, token)).status).toBe(403);
      expect((await move(OCT, token)).status).toBe(403);
    }
  });

  it('knows only the stored links’ sources', async () => {
    expect((await preview(MOH)).status).toBe(404);
    expect((await move(new Types.ObjectId().toHexString())).status).toBe(404);
    expect((await preview('not-an-id')).status).toBe(400);
  });
});

// ── Review findings on the live writers around a run ────────────────────────────────────────────

describe('the target the reader confirmed', () => {
  it('is a precondition: a link re-pointed since refuses the move, and nothing moves', async () => {
    const refused = await call('post', `/atm/branch-links/${OCT}/move`, adminToken, {
      expectedTargetBranchId: TAN,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(errorOf(refused).code).toBe('ATM_BRANCH_MOVE_TARGET_CHANGED');
    // The stored target confirmed: the move runs (October has nothing left, so it moves nothing).
    const confirmed = await call('post', `/atm/branch-links/${OCT}/move`, adminToken, {
      expectedTargetBranchId: MOH,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    // The body names the confirmed target and nothing else.
    const other = await call('post', `/atm/branch-links/${OCT}/move`, adminToken, {
      targetBranchId: MOH,
    });
    expect(other.status).toBe(400);
  });
});

describe('writes that wait while a move runs', () => {
  it('a machine add, a label save and a register link are refused 409 while a fresh run holds the lock', async () => {
    const run = await AtmBranchMoveRunModel.create({
      sourceBranchId: oid(ZAY),
      targetBranchId: oid(MOH),
      state: 'running',
      startedAt: new Date(),
    });
    const writes = () => [
      call('post', '/atm/machines', adminToken, {
        bankName: 'NBE',
        area: 'الدقي',
        machineCode: '99990001',
        name: 'ATM fence',
      }),
      call('post', '/atm/ref-labels/area', adminToken, { nameAr: 'منطقة سور', nameEn: 'Fence' }),
      call('post', `/atm/register/entries/${new Types.ObjectId().toHexString()}/link`, adminToken, {
        version: 0,
      }),
    ];
    try {
      for (const res of await Promise.all(writes())) {
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(errorOf(res).code).toBe('ATM_BRANCH_MOVE_RUNNING');
      }
      // A run left 30 minutes (its process died) no longer holds them: each answers for itself.
      await AtmBranchMoveRunModel.updateOne(
        { _id: run._id },
        { $set: { startedAt: new Date(Date.now() - 31 * 60_000) } },
      ).exec();
      for (const res of await Promise.all(writes())) {
        expect(errorOf(res)?.code ?? null).not.toBe('ATM_BRANCH_MOVE_RUNNING');
      }
    } finally {
      await AtmBranchMoveRunModel.deleteOne({ _id: run._id }).exec();
    }
  });
});

describe('a twin changed since the plan', () => {
  it('is never retired: the run stops on it, and the next run plans it again', async () => {
    const created = await call('post', '/platform/branches', adminToken, {
      code: '86',
      name: { ar: 'مدينة نصر', en: 'Nasr City' },
    });
    expect(created.status).toBe(201);
    const NAS = data<{ id: string }>(created).id;
    const current = data<{ links: { branchId: string; actsAsBranchId: string }[] }>(
      await call('get', '/atm/branch-links', adminToken),
    ).links.map((link) => ({ branchId: link.branchId, actsAsBranchId: link.actsAsBranchId }));
    const saved = await call('put', '/atm/branch-links', adminToken, {
      links: [...current, { branchId: NAS, actsAsBranchId: MOH }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await mkMachine(NAS, 'R1'); // active: the master that stays
    const twin = await mkMachine(MOH, 'R1', { isActive: false }); // archived: planned for retire

    // Reactivated after the plan was read, before its retire: the retire's own re-check stops.
    setBeforeTwinRetireForTests(async () => {
      await AtmMachineModel.updateOne({ _id: oid(twin) }, { $set: { isActive: true } }).exec();
    });
    const cut = await move(NAS);
    expect(cut.status, JSON.stringify(cut.body)).toBe(409);
    expect(errorOf(cut).details?.map((detail) => detail.code)).toEqual(['machineTwinOpen']);
    expect(await AtmMachineModel.findById(twin).lean().exec()).toMatchObject({
      machineCode: 'R1',
      isActive: true,
      isDeleted: false,
    });

    // Archived again, the next run plans it again and retires it.
    await AtmMachineModel.updateOne({ _id: oid(twin) }, { $set: { isActive: false } }).exec();
    const res = await move(NAS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await AtmMachineModel.findById(twin).lean().exec()).toMatchObject({
      machineCode: 'R1-D',
      isDeleted: true,
    });
  });
});

describe('a name a linked branch remembers', () => {
  it('is never written back by the other branch — after a write, or by the boot repair', async () => {
    const countIn = (branchId: string, name: string) =>
      AtmRefLabelModel.countDocuments({ branchId: oid(branchId), kind: 'area', name }).exec();
    // Mohandessin deleted «منطقة محذوفة»; a row filed under Sheikh Zayed, linked to it, carries it.
    await mkLabel(MOH, 'area', 'منطقة محذوفة', { isDeleted: true, deletedAt: new Date() });
    await ensureAreaLabels([{ branchId: ZAY, area: 'منطقة محذوفة' }], {
      actorId: null,
      origin: 'register',
    });
    expect(await countIn(ZAY, 'منطقة محذوفة')).toBe(0);

    // The boot repair: a live machine under Sheikh Zayed carries a name Mohandessin renamed away.
    await mkLabel(MOH, 'area', 'اسم جديد', { formerNames: ['اسم قديم'] });
    await AtmMachineModel.create({
      branchId: oid(ZAY),
      bankName: 'NBE',
      machineCode: 'Z9',
      name: 'ATM Z9',
      area: 'اسم قديم',
      isActive: true,
      isDeleted: false,
    });
    await backfillAtmAreaLabels();
    expect(await countIn(ZAY, 'اسم قديم')).toBe(0);

    // A name no linked branch remembers is still written.
    await ensureAreaLabels([{ branchId: ZAY, area: 'منطقة جديدة' }], {
      actorId: null,
      origin: 'register',
    });
    expect(await countIn(ZAY, 'منطقة جديدة')).toBe(1);
  });
});
