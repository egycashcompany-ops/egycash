// R1 composition, with every owning module stubbed (plan §9 "Dashboard service unit").
//
// What only a stubbed spec can pin, because each claim is about which service is ASKED:
//   · the gating matrix — each key alone ⇒ exactly the sections whose WHOLE gate it covers are
//     non-null, and no service behind another section is ever called (R-28: the API key without the
//     linked screen's guard is not enough);
//   · the data scope (R-27) — the branch-scoped screens get the reader's `scopeSelector`, the rest no
//     permission scope at all, so an `own` grant never turns into `createdBy` on a company source;
//     and what the figures cover (`branchIds`, D9): the whole company for organization and `own`,
//     the reader's branches for a branch grant (one, or «كل فروعي»), the switcher's branch only
//     inside them — a stale header is ignored — and `[]` narrows to nothing;
//   · isolation — one section that throws is `null` + named in `unavailable`, the rest still answer;
//   · one clock — 2026-10-31T23:30Z is Cairo's 2026-11-01 everywhere, and that instant (not another)
//     reaches the fuel summary's «شُحن اليوم» (its Cairo day, batch 3's D5).
// The figures themselves are proved against real endpoints by the integration specs.
import {
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_TODAY_ROWS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_NOW_SECTIONS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  fleetDashboardGateKeys,
  type FleetDashboardNowSection,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
} from '@ecms/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';

const fn = (): Mock => vi.fn();
const vehicles = {
  statusCounts: fn(),
  outOfServiceList: fn(),
  activeByTypeAndBranch: fn(),
  countListed: fn(),
  nearestLicences: fn(),
  countLive: fn(),
  codesByIds: fn(),
};
const roster = { boardWithCrews: fn() };
const crews = { findAll: fn() };
const maintenance = { openNow: fn(), recentWritten: fn() };
const alarms = { computeAlarms: fn() };
const odometer = { noReadingDigest: fn() };
const set = { vehicleSet: fn() };
const types = { listAll: fn() };
const branches = { listAll: fn() };
const catalog = { listKind: fn(), namesByIds: fn() };
const drivers = { registryDigest: fn() };
const licensing = { openPaperCounts: fn() };
const fuel = { summary: fn() };
const accidents = { recentWritten: fn(), summaryOver: fn() };
const notices = { summary: fn(), missingAnyCount: fn() };
const dealership = { summaryOver: fn() };
const violations = { yearDigest: fn(), openDigest: fn() };
const settings = { resolve: fn() };

vi.mock('../vehicles/vehicle.repository', () => ({ fleetVehicleRepository: vehicles }));
vi.mock('../roster/roster.service', () => ({ fleetRosterService: roster }));
vi.mock('../fixed-roster/fixed-crew.repository', () => ({ fleetFixedCrewRepository: crews }));
vi.mock('../maintenance/maintenance.service', () => ({ fleetMaintenanceService: maintenance }));
vi.mock('../maintenance/maintenance-alarm', () => ({
  computeAlarms: () => alarms.computeAlarms() as unknown,
}));
vi.mock('../odometer/odometer.service', () => ({ fleetOdometerService: odometer }));
vi.mock('../vehicles/vehicle-set', () => ({
  vehicleSet: (...args: unknown[]) => set.vehicleSet(...args) as unknown,
  withVehicleFilterMemo: <T>(read: () => Promise<T>): Promise<T> => read(),
}));
vi.mock('../vehicle-types/vehicle-type.repository', () => ({ fleetVehicleTypeRepository: types }));
vi.mock('../../../platform/organization/branches/branch.repository', () => ({
  branchRepository: branches,
}));
vi.mock('../catalogs/catalog-item.repository', () => ({ fleetCatalogItemRepository: catalog }));
vi.mock('../driver-profiles/driver-profile.service', () => ({
  fleetDriverProfileService: drivers,
}));
vi.mock('../licensing/licensing.service', () => ({ fleetLicensingService: licensing }));
vi.mock('../fuel-cards/fuel-card.service', () => ({ fleetFuelCardService: fuel }));
vi.mock('../accidents/accident.service', () => ({ fleetAccidentService: accidents }));
vi.mock('../notices/notice.service', () => ({ fleetNoticeService: notices }));
vi.mock('../dealership/dealership.service', () => ({ fleetDealershipService: dealership }));
vi.mock('../violations/violation.service', () => ({ fleetViolationService: violations }));
vi.mock('../../../platform/settings', () => ({ settingsService: settings }));

const {
  fleetDashboardNowService,
  NOW_SECTIONS,
  rosterDigest,
  rosterLists,
  distributionMatrix,
  unmannedClassOf,
} = await import('./now.service');
const { dashboardBranches } = await import('./dashboard-context');
const { selectorBranches } = await import('../../../shared/types');

const NOW = new Date('2026-10-31T23:30:00.000Z');
const TODAY = '2026-11-01';
const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';
const B3 = '650000000000000000000103';
const T1 = '650000000000000000000201';
const OP_CASH = '650000000000000000000301';
const OP_ATM = '650000000000000000000302';
const SP_CASH = '650000000000000000000401';
const MISSION = '650000000000000000000501';
const CAIRO = { ar: 'القاهرة', en: 'Cairo' };
const GIZA = { ar: 'الجيزة', en: 'Giza' };

const ctxWith = (
  keys: readonly string[],
  extra: Partial<AuthContext> = {},
  scope: 'organization' | 'branch' | 'own' = 'organization',
): AuthContext => ({
  userId: '650000000000000000000999',
  sessionId: 's',
  branchId: B1,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: Object.fromEntries(keys.map((key) => [key, scope])),
  permissionVersion: 1,
  isPrivileged: false,
  ...extra,
});

const ALL_KEYS = [...FLEET_DASHBOARD_NOW_KEYS];
/** A branch-scoped reader whose grants reach B1 and B2 — «كل فروعي». */
const MULTI: Partial<AuthContext> = { reach: { branchIds: [B1, B2], departments: [] } };

const SETTINGS: Record<string, number | boolean> = {
  'fleet.license.vehicleWarnDays': 30,
  'fleet.license.driverWarnDays': 30,
  'fleet.fuelCard.expiryWarnDays': 30,
  'fleet.fuelCard.balanceYellow': 300,
  'fleet.fuelCard.balanceRed': 100,
  'fleet.odometer.missingReadingDays': 3,
};

const row = (over: Partial<FleetRosterRowDto>): FleetRosterRowDto => ({
  vehicleId: 'v',
  code: '1',
  plateNumber: 'p',
  typeId: T1,
  inMaintenance: false,
  planned: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  assignable: true,
  licenceExpired: false,
  manned: false,
  crewGaps: [],
  crewCovered: 0,
  stalePlan: false,
  ...over,
});

const BOARD: FleetRosterDayDto = {
  date: TODAY,
  rows: [row({ vehicleId: 'v1', manned: true, driver1EmployeeId: 'e1' })],
  availableDrivers: [{ employeeId: 'e1', assignedVehicleId: 'v1', licence: 'valid' }],
  unavailableDrivers: [],
  licenceRule: 'flag',
};

const totals = (over: Record<string, number>) => ({
  wataniyaBalance: 0,
  chilloutBalance: 0,
  requestedCount: 0,
  requestedAmount: 0,
  chargedTodayAmount: 0,
  cardCount: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.resolve.mockImplementation((key: string) => Promise.resolve(SETTINGS[key]));
  vehicles.statusCounts.mockResolvedValue({ active: 5, outOfService: 1, disposed: 2 });
  vehicles.outOfServiceList.mockResolvedValue([{ vehicleId: 'v9', code: '9', reason: null }]);
  vehicles.activeByTypeAndBranch.mockResolvedValue([
    { typeId: T1, branchId: B1, count: 3 },
    { typeId: T1, branchId: null, count: 2 },
  ]);
  vehicles.countListed.mockResolvedValue(1);
  vehicles.nearestLicences.mockResolvedValue({
    rows: [{ vehicleId: 'v3', code: '3', expiresAt: '2026-10-30T00:00:00.000Z' }],
    total: 4,
  });
  roster.boardWithCrews.mockImplementation(async () => ({
    board: BOARD,
    fixedCrews: await crews.findAll(),
    branchOf: new Map([['v1', B1]]),
    driverCodes: new Map([['e1', '1001']]),
  }));
  crews.findAll.mockResolvedValue([]);
  maintenance.openNow.mockResolvedValue({
    open: 0,
    openActive: 0,
    openOutOfService: 0,
    oldest: null,
  });
  maintenance.recentWritten.mockResolvedValue([]);
  vehicles.countLive.mockResolvedValue(2);
  alarms.computeAlarms.mockResolvedValue([
    { vehicleId: 'v1', code: '1', level: 'red', remainingKm: -10 },
    { vehicleId: 'v2', code: '2', level: 'red', remainingKm: 50 },
    { vehicleId: 'v3', code: '3', level: 'yellow', remainingKm: 400 },
  ]);
  odometer.noReadingDigest.mockResolvedValue({ stale: [], neverRead: [] });
  set.vehicleSet.mockImplementation(
    (_f: unknown, branchIds: readonly string[] | null, opts: { branchId?: string | null } = {}) =>
      Promise.resolve({
        ids: branchIds === null ? undefined : ['v1', 'v3'],
        scope: {
          count: branchIds === null ? null : 2,
          typeIds: [],
          operationIds: [],
          vehicleCodes: [],
          branchId: opts.branchId ?? null,
        },
      }),
  );
  types.listAll.mockResolvedValue([{ _id: T1, name: { ar: 'مرسيدس', en: 'Mercedes' } }]);
  branches.listAll.mockResolvedValue([
    { _id: B1, name: CAIRO },
    { _id: B2, name: GIZA },
  ]);
  catalog.namesByIds.mockImplementation((ids: readonly string[]) =>
    Promise.resolve(
      new Map(ids.includes(MISSION) ? [[MISSION, { ar: 'نقل أموال', en: 'Cash run' }]] : []),
    ),
  );
  vehicles.codesByIds.mockImplementation((ids: readonly string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, `C-${id}`]))),
  );
  catalog.listKind.mockImplementation((kind: string) =>
    Promise.resolve(
      kind === 'operation'
        ? [
            { _id: OP_CASH, name: { ar: 'نقل أموال', en: 'Cash transport' } },
            { _id: OP_ATM, name: { ar: 'ATM', en: 'ATM' } },
          ]
        : [{ _id: SP_CASH, name: { ar: 'نقل اموال', en: 'Cash' } }],
    ),
  );
  drivers.registryDigest.mockResolvedValue({
    total: 7,
    licence: { expired: 1, expiring: 2, soon: 0, notRecorded: 1, unregistered: 1 },
    cash: { drivers: 3, legacy: 1 },
    atm: { drivers: 0, legacy: 0 },
  });
  licensing.openPaperCounts.mockResolvedValue({ insurance: 2, tax: 1 });
  fuel.summary.mockImplementation((query: Record<string, unknown>) =>
    Promise.resolve(
      'balanceBelow' in query
        ? totals({ cardCount: query['balanceBelow'] === 300 ? 4 : 1 })
        : 'expiresBefore' in query
          ? totals({ cardCount: 'expiresFrom' in query ? 2 : 1 })
          : totals({
              wataniyaBalance: 900,
              chilloutBalance: 50,
              requestedCount: 3,
              requestedAmount: 600,
            }),
    ),
  );
  accidents.recentWritten.mockResolvedValue([]);
  accidents.summaryOver.mockResolvedValue({ count: 2, remaining: 1500 });
  notices.summary.mockResolvedValue({ open: 4, missingLicences: 2, missingCheckImage: 2 });
  notices.missingAnyCount.mockResolvedValue(3);
  dealership.summaryOver.mockResolvedValue({ count: 5, pending: 5, dealershipTotal: 0 });
  violations.yearDigest.mockResolvedValue({
    year: 2026,
    company: 0,
    drivers: {
      total: 0,
      attributed: 0,
      unknown: { amount: 0, count: 0 },
      unlinked: { amount: 0, count: 0 },
    },
    total: 0,
  });
  violations.openDigest.mockResolvedValue({
    company: { amount: 1200, count: 4 },
    drivers: { total: { amount: 300, count: 2 } },
    total: { amount: 1500, count: 6 },
  });
});

/** The stubs each section — and ONLY that section among the R1 sections — reads through. */
const USES: Record<FleetDashboardNowSection, readonly Mock[]> = {
  vehicles: [vehicles.statusCounts, vehicles.outOfServiceList],
  // The standing crews come WITH the board (one read): the stub stands for the board's own.
  roster: [roster.boardWithCrews, crews.findAll],
  workshop: [maintenance.openNow],
  maintenanceAlarm: [alarms.computeAlarms, set.vehicleSet],
  noReading: [odometer.noReadingDigest, set.vehicleSet],
  distributionVehicles: [
    vehicles.activeByTypeAndBranch,
    types.listAll,
    branches.listAll,
    vehicles.countListed,
  ],
  distributionDrivers: [drivers.registryDigest],
  licenceVehicles: [vehicles.countListed, vehicles.nearestLicences],
  licenceDrivers: [drivers.registryDigest],
  papers: [licensing.openPaperCounts],
  fuelCards: [fuel.summary],
  fuelCharging: [fuel.summary],
  recentWorkshop: [maintenance.recentWritten],
  recentAccidents: [accidents.recentWritten],
  notices: [notices.summary, notices.missingAnyCount],
  dealershipPending: [dealership.summaryOver],
  accidentsOpen: [accidents.summaryOver],
  violationsYear: [violations.yearDigest],
  violationsOpen: [violations.openDigest],
};
const EVERY_STUB = [...new Set(Object.values(USES).flat())];

describe('R1 — the gating matrix (R-28: the API key AND the linked screen guard)', () => {
  it.each(ALL_KEYS)('with only %s, exactly the sections its key covers answer', async (key) => {
    const dto = await fleetDashboardNowService.read(ctxWith([key]), NOW);
    const covered = FLEET_DASHBOARD_NOW_SECTIONS.filter((s) =>
      fleetDashboardGateKeys(s).every((k) => k === key),
    );
    for (const s of FLEET_DASHBOARD_NOW_SECTIONS) {
      if (covered.includes(s)) expect(dto[s], s).not.toBeNull();
      else expect(dto[s], s).toBeNull();
    }
    const asked = new Set(covered.flatMap((s) => USES[s]));
    for (const stub of EVERY_STUB) {
      expect(stub.mock.calls.length > 0, stub.getMockName()).toBe(asked.has(stub));
    }
    expect(dto.unavailable).toEqual([]);
  });

  it('fleetMaintenance.view alone gets no alarm line — the alarms screen is fleetOdometer.view', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetMaintenance.view']), NOW);
    expect(dto.maintenanceAlarm).toBeNull();
    expect(alarms.computeAlarms).not.toHaveBeenCalled();
    expect(dto.workshop).not.toBeNull();
    expect(dto.alerts.map((a) => a.id)).not.toContain('maintenanceRed');
  });

  it('fleetFuelCard.view alone gets the expired cards but no balances, requests or low cards', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetFuelCard.view']), NOW);
    expect(dto.fuelCards).toEqual({ warnDays: 30, expired: 1, expiring: 2 });
    expect(dto.fuelCharging).toBeNull();
    // Only the two expiry questions — never the balances' three.
    expect(fuel.summary).toHaveBeenCalledTimes(2);
    expect(dto.alerts.map((a) => a.id)).toEqual(['fuelCardExpired']);
  });

  it('fleetFuelCharge.view alone opens the door and nothing behind it', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetFuelCharge.view']), NOW);
    expect(dto.fuelCharging).toBeNull();
    expect(fuel.summary).not.toHaveBeenCalled();
    expect(dto.alerts).toEqual([]);
  });

  it('with every key, every section answers', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS), NOW);
    for (const s of FLEET_DASHBOARD_NOW_SECTIONS) expect(dto[s], s).not.toBeNull();
  });
});

describe('R1 — data scope (R-27)', () => {
  const SCREEN: FleetDashboardNowSection[] = [
    'vehicles',
    'roster',
    'distributionVehicles',
    'licenceVehicles',
    'papers',
  ];

  it('declares the branch-scoped screens as `screen` and every other section as `company+set`', () => {
    const declared = Object.fromEntries(NOW_SECTIONS.map((s) => [s.key, s.scope]));
    for (const s of FLEET_DASHBOARD_NOW_SECTIONS) {
      expect(declared[s], s).toBe(SCREEN.includes(s) ? 'screen' : 'company+set');
    }
    expect(NOW_SECTIONS.map((s) => s.key)).toEqual([...FLEET_DASHBOARD_NOW_SECTIONS]);
  });

  it('an `own` grant reaches the screen sections as its own selector and never the company ones', async () => {
    const ctx = ctxWith(ALL_KEYS, {}, 'own');
    await fleetDashboardNowService.read(ctx, NOW);
    const own = expect.objectContaining({ scope: 'own', userId: ctx.userId });
    expect(vehicles.statusCounts).toHaveBeenCalledWith(own);
    expect(roster.boardWithCrews).toHaveBeenCalledWith(new Date(`${TODAY}T00:00:00.000Z`), own);
    expect(crews.findAll).toHaveBeenCalledTimes(1); // the board's read, never a second one
    expect(licensing.openPaperCounts).toHaveBeenCalledWith(own);
    // The company sources: no scope argument at all, nothing that could become `createdBy`.
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open' });
    expect(dealership.summaryOver).toHaveBeenCalledWith({ pending: true });
    expect(maintenance.openNow).toHaveBeenCalledWith({ today: TODAY, filter: {} });
    expect(violations.yearDigest).toHaveBeenCalledWith({ year: 2026, filter: {} });
    expect(violations.openDigest).toHaveBeenCalledWith({ filter: {} });
    expect(JSON.stringify(accidents.summaryOver.mock.calls)).not.toContain('createdBy');
  });

  it('the switcher branch narrows the company sources through branchIds and echoes the set', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS, { activeBranchId: B2 }), NOW);
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [B2] });
    expect(maintenance.openNow).toHaveBeenCalledWith({ today: TODAY, filter: { branchIds: [B2] } });
    expect(drivers.registryDigest).toHaveBeenCalledWith(
      expect.objectContaining({ branchIds: [B2] }),
    );
    expect(violations.openDigest).toHaveBeenCalledWith({ filter: { branchIds: [B2] } });
    expect(odometer.noReadingDigest).toHaveBeenCalledWith({
      today: TODAY,
      days: 3,
      vehicleIds: ['v1', 'v3'],
    });
    expect(dto.vehicleScope).toEqual({
      count: 2,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
      branchId: B2,
      scopeBranches: [{ id: B2, name: GIZA }],
    });
    expect(dto.branchId).toBe(B2);
    expect(dto.scopeBranches).toEqual([{ id: B2, name: GIZA }]);
    // The alarm projection, narrowed AFTER computing: v2 is not the branch's.
    expect(dto.maintenanceAlarm).toEqual({
      red: 1,
      overdue: 1,
      yellow: 1,
      codes: { red: ['1'], yellow: ['3'] },
    });
  });

  it('the echo’s car count is the registry’s live cars, and only for a reader of the registry', async () => {
    vehicles.countLive.mockResolvedValue(1); // v3 was soft-deleted: the set keeps it, the count not
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS, { activeBranchId: B2 }), NOW);
    expect(vehicles.countLive).toHaveBeenCalledWith(['v1', 'v3']);
    expect(dto.vehicleScope?.count).toBe(1);
    vehicles.countLive.mockClear();
    const noRegistry = ALL_KEYS.filter((key) => key !== 'fleetVehicle.view');
    const blind = await fleetDashboardNowService.read(
      ctxWith(noRegistry, { activeBranchId: B2 }),
      NOW,
    );
    expect(vehicles.countLive).not.toHaveBeenCalled();
    expect(blind.vehicleScope).toEqual({
      count: null,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
      branchId: B2,
      scopeBranches: [{ id: B2, name: GIZA }],
    });
  });

  it('the echo is asked BESIDE the sections, not after the slowest of them', async () => {
    // The echo reads the branch's car set (memoised, shared with the sections) and the registry's
    // count — nothing a section computes. Awaited after them, it was one more round trip on the end
    // of every narrowed read.
    let release: (value: unknown) => void = () => undefined;
    roster.boardWithCrews.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = fleetDashboardNowService.read(ctxWith(ALL_KEYS, { activeBranchId: B2 }), NOW);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(vehicles.countLive, 'counted while the roster is still answering').toHaveBeenCalledWith([
      'v1',
      'v3',
    ]);
    release({ board: BOARD, fixedCrews: [], branchOf: new Map(), driverCodes: new Map() });
    const dto = await pending;
    expect(dto.vehicleScope?.count).toBe(2);
    expect(dto.roster).not.toBeNull();
  });

  it('the home branch alone is the whole company: no set, no echo', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS, { branchId: B1 }), NOW);
    expect(dto.vehicleScope).toBeNull();
    expect(dto.scopeBranches).toBeNull();
    expect(dto.branchId).toBeNull();
    expect(dto.maintenanceAlarm).toEqual({ red: 2, overdue: 1, yellow: 1, codes: null });
    // The company asks the set with no branch at all: no vehicle clause.
    expect(set.vehicleSet).toHaveBeenCalledWith({}, null, { branchId: null });
  });

  it('«كل فروعي» — a reader reaching two branches: every company+set source narrows to BOTH', async () => {
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: B1, ...MULTI }, 'branch'),
      NOW,
    );
    const both = [B1, B2];
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: both });
    expect(dealership.summaryOver).toHaveBeenCalledWith({ pending: true, branchIds: both });
    expect(maintenance.openNow).toHaveBeenCalledWith({ today: TODAY, filter: { branchIds: both } });
    expect(maintenance.recentWritten).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { branchIds: both } }),
    );
    expect(violations.yearDigest).toHaveBeenCalledWith({ year: 2026, filter: { branchIds: both } });
    expect(violations.openDigest).toHaveBeenCalledWith({ filter: { branchIds: both } });
    expect(drivers.registryDigest).toHaveBeenCalledWith(
      expect.objectContaining({ branchIds: both }),
    );
    expect(set.vehicleSet).toHaveBeenCalledWith({}, both, { branchId: null });
    // No switcher named: the echo carries both branches by name, and no single branch.
    expect(dto.branchId).toBeNull();
    expect(dto.scopeBranches).toEqual([
      { id: B1, name: CAIRO },
      { id: B2, name: GIZA },
    ]);
    expect(dto.vehicleScope).not.toBeNull();
    expect(dto.vehicleScope?.scopeBranches).toEqual(dto.scopeBranches);
    expect(dto.vehicleScope?.branchId).toBeNull();
    // The branch list is read ONCE per request (the matrix, the echo).
    expect(branches.listAll).toHaveBeenCalledTimes(1);
  });

  it('«كل فروعي» with a soft-deleted branch in reach: the echo keeps it («—»), as the figures count it', async () => {
    // B3 is not in the live branch list (`isDeleted`), yet the reader's grant reaches it and its
    // cars are counted: the echo must name what the figures cover, or the web's `branch=` links and
    // one-branch layout would read one branch where the server counted two.
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { reach: { branchIds: [B1, B3], departments: [] } }, 'branch'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [B1, B3] });
    expect(dto.scopeBranches).toEqual([
      { id: B1, name: CAIRO },
      { id: B3, name: { ar: '—', en: '—' } },
    ]);
    expect(dto.scopeBranches?.map((b) => b.id)).toEqual([B1, B3]);
    expect(dto.vehicleScope?.scopeBranches).toEqual(dto.scopeBranches);
  });

  it('«كل فروعي» with the switcher on one of them: that one branch, honoured', async () => {
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: B1, activeBranchId: B2, ...MULTI }, 'branch'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [B2] });
    expect(dto.branchId).toBe(B2);
    expect(dto.scopeBranches).toEqual([{ id: B2, name: GIZA }]);
  });

  it('a single-branch reader (a branch grant, home only) is narrowed to that branch — not the company', async () => {
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: B1 }, 'branch'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [B1] });
    expect(maintenance.openNow).toHaveBeenCalledWith({ today: TODAY, filter: { branchIds: [B1] } });
    expect(dto.branchId).toBeNull();
    expect(dto.scopeBranches).toEqual([{ id: B1, name: CAIRO }]);
    expect(dto.vehicleScope?.scopeBranches).toEqual([{ id: B1, name: CAIRO }]);
  });

  it('a stale switcher header on a home-only reader is ignored: the home branch, never the header', async () => {
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: B1, activeBranchId: B2 }, 'branch'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [B1] });
    expect(JSON.stringify(accidents.summaryOver.mock.calls)).not.toContain(B2);
    expect(dto.branchId).toBeNull();
    expect(dto.scopeBranches).toEqual([{ id: B1, name: CAIRO }]);
  });

  it('a branch grant with no branch at all (`[]`) narrows every company+set source to NOTHING', async () => {
    const dto = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: null }, 'branch'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open', branchIds: [] });
    expect(maintenance.openNow).toHaveBeenCalledWith({ today: TODAY, filter: { branchIds: [] } });
    expect(drivers.registryDigest).toHaveBeenCalledWith(expect.objectContaining({ branchIds: [] }));
    expect(set.vehicleSet).toHaveBeenCalledWith({}, [], { branchId: null });
    expect(dto.scopeBranches).toEqual([]);
  });

  it('an `own` grant keeps the company figures; an organization grant with a home branch too', async () => {
    const own = await fleetDashboardNowService.read(
      ctxWith(ALL_KEYS, { branchId: B1 }, 'own'),
      NOW,
    );
    expect(accidents.summaryOver).toHaveBeenCalledWith({ status: 'open' });
    expect(own.scopeBranches).toBeNull();
    expect(own.vehicleScope).toBeNull();
    const org = await fleetDashboardNowService.read(ctxWith(ALL_KEYS, { branchId: B2 }), NOW);
    expect(org.scopeBranches).toBeNull();
    expect(org.vehicleScope).toBeNull();
  });

  it('the widest grant decides: one organization key among branch keys is the company', async () => {
    const ctx = ctxWith(ALL_KEYS, { branchId: B1 }, 'branch');
    ctx.permissions['fleetAccident.view'] = 'organization';
    const dto = await fleetDashboardNowService.read(ctx, NOW);
    expect(dto.scopeBranches).toBeNull();
    expect(dealership.summaryOver).toHaveBeenCalledWith({ pending: true });
  });

  it('equal grants reaching different branches per key: the LAST such key decides, one list for all (D9)', () => {
    // The known limit of one answer per request: the figures are narrowed by ONE key's reach. Two
    // branch grants of the same rank tie, and the last of them in the two reads' key order wins —
    // pinned so the choice cannot drift silently (exact per-key narrowing is a later hand-off).
    const keys = [...new Set([...FLEET_DASHBOARD_NOW_KEYS, ...FLEET_DASHBOARD_PERIOD_KEYS])];
    const first = keys[0] ?? '';
    const last = keys[keys.length - 1] ?? '';
    const ctx = ctxWith([first, last], { branchId: B1 }, 'branch');
    ctx.keyReach = {
      [first]: { branchIds: [B1], departments: [] },
      [last]: { branchIds: [B1, B2], departments: [] },
    };
    expect(dashboardBranches(ctx)).toEqual([B1, B2]);
    ctx.keyReach = {
      [first]: { branchIds: [B1, B2], departments: [] },
      [last]: { branchIds: [B3], departments: [] },
    };
    expect(dashboardBranches(ctx)).toEqual([B3]);
  });

  it('the custody fund’s key (a browser read) never decides what the figures cover', () => {
    const ctx = ctxWith(['fleetVehicle.view'], { branchId: B1 }, 'branch');
    ctx.permissions['fleetCustody.view'] = 'organization';
    expect(dashboardBranches(ctx)).toEqual([B1]);
  });

  it('each alarm level carries its own codes, capped on its own: 70 green cars never hide 3 red ones', async () => {
    const ids = Array.from({ length: 73 }, (_, i) => `g${i}`);
    alarms.computeAlarms.mockResolvedValue(
      ids.map((vehicleId, i) => ({
        vehicleId,
        code: String(100 + i),
        level: i < 3 ? 'red' : 'none',
        remainingKm: i < 3 ? -1 : 5000,
      })),
    );
    set.vehicleSet.mockResolvedValue({
      ids,
      scope: { count: 73, typeIds: [], operationIds: [], vehicleCodes: [], branchId: B2 },
    });
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS, { activeBranchId: B2 }), NOW);
    expect(dto.maintenanceAlarm?.codes).toEqual({ red: ['100', '101', '102'], yellow: [] });
  });
});

describe('R1 — one clock, Cairo day', () => {
  it('2026-10-31T23:30Z is 2026-11-01 for every figure, and the instant reaches the fuel summary', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS), NOW);
    expect(dto.today).toBe(TODAY);
    expect(dto.asOf).toBe(NOW.toISOString());
    for (const call of fuel.summary.mock.calls) expect(call[1]).toBe(NOW);
    expect(fuel.summary).toHaveBeenCalledWith(
      { expiresBefore: new Date(`${TODAY}T23:59:59.999Z`) },
      NOW,
    );
    expect(fuel.summary).toHaveBeenCalledWith(
      {
        expiresFrom: new Date('2026-11-02T00:00:00.000Z'),
        expiresBefore: new Date('2026-12-01T23:59:59.999Z'),
      },
      NOW,
    );
    expect(maintenance.recentWritten).toHaveBeenCalledWith({
      sinceYmd: '2026-10-03',
      limit: 8,
      filter: {},
    });
    expect(accidents.recentWritten).toHaveBeenCalledWith({
      sinceYmd: '2026-10-03',
      limit: 8,
      filter: {},
    });
    expect(drivers.registryDigest).toHaveBeenCalledWith({
      today: TODAY,
      warnDays: 30,
      branchIds: null,
      cashSpecIds: [SP_CASH],
      atmSpecIds: [],
    });
  });

  it('counts the licence windows of R-10 through the list filter, active cars only (Q-15)', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetVehicle.view']), NOW);
    const before = (ymd: string) => new Date(`${ymd}T23:59:59.999Z`);
    const from = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    const own = expect.anything();
    expect(vehicles.countListed).toHaveBeenCalledWith(
      { status: ['active'], licenseExpiresBefore: before(TODAY) },
      own,
    );
    expect(vehicles.countListed).toHaveBeenCalledWith(
      {
        status: ['active'],
        licenseExpiresFrom: from('2026-11-02'),
        licenseExpiresBefore: before('2026-12-01'),
      },
      own,
    );
    expect(vehicles.countListed).toHaveBeenCalledWith(
      {
        status: ['active'],
        licenseExpiresFrom: from('2026-12-02'),
        licenseExpiresBefore: before('2026-12-31'),
      },
      own,
    );
    expect(vehicles.countListed).toHaveBeenCalledWith(
      { status: ['outOfService'], licenseExpiresBefore: before(TODAY) },
      own,
    );
    expect(vehicles.nearestLicences).toHaveBeenCalledWith(own, '2026-12-31', 6);
    expect(dto.licenceVehicles?.list).toEqual([
      { vehicleId: 'v3', code: '3', expiresAt: '2026-10-30T00:00:00.000Z', days: -2 },
    ]);
    expect(dto.licenceVehicles?.more).toBe(3);
  });
});

describe('R1 — isolation and alerts', () => {
  it('a section that throws is null and named; the others still answer', async () => {
    notices.summary.mockRejectedValueOnce(new Error('boom'));
    alarms.computeAlarms.mockRejectedValueOnce(new Error('boom'));
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS), NOW);
    expect(dto.notices).toBeNull();
    expect(dto.maintenanceAlarm).toBeNull();
    expect(dto.unavailable).toEqual(['maintenanceAlarm', 'notices']);
    expect(dto.vehicles).not.toBeNull();
    expect(dto.alerts.map((a) => a.id)).not.toContain('noticesMissing');
    expect(dto.alerts.map((a) => a.id)).not.toContain('maintenanceRed');
  });

  it('derives the lines from the section values, red first, count > 0 only', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(ALL_KEYS), NOW);
    expect(dto.alerts).toEqual([
      { id: 'maintenanceRed', level: 'red', count: 2 },
      { id: 'vehicleLicenceExpired', level: 'red', count: 1 },
      { id: 'driverLicenceExpired', level: 'red', count: 1 },
      { id: 'fuelCardExpired', level: 'red', count: 1 },
      { id: 'fuelRequests', level: 'orange', count: 3 },
      { id: 'fuelLow', level: 'orange', count: 4 },
      { id: 'dealershipPending', level: 'orange', count: 5 },
      { id: 'noticesMissing', level: 'orange', count: 3 },
    ]);
    expect(dto.notices).toEqual({
      open: 4,
      missingAny: 3,
      missingLicences: 2,
      missingCheckImage: 2,
    });
    expect(dto.fuelCharging).toEqual({
      wataniya: 900,
      chillout: 50,
      requested: { count: 3, amount: 600 },
      low: { belowYellow: 4, belowRed: 1, yellowAt: 300, redAt: 100 },
      charged24h: 0,
      cards: 0,
    });
  });

  it('«موزعة على N كارتًا» is the same summary’s card count — no other question asked', async () => {
    fuel.summary.mockImplementation((query: Record<string, unknown>) =>
      Promise.resolve(totals({ cardCount: Object.keys(query).length === 0 ? 12 : 1 })),
    );
    const dto = await fleetDashboardNowService.read(
      ctxWith(['fleetFuelCharge.view', 'fleetFuelCard.view']),
      NOW,
    );
    expect(dto.fuelCharging?.cards).toBe(12);
    expect(fuel.summary).toHaveBeenCalledWith({}, NOW);
  });

  it('«مخالفات قائمة» is the violations module’s every-year digest, as it answers', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetViolation.view']), NOW);
    expect(dto.violationsOpen).toEqual({
      company: { amount: 1200, count: 4 },
      drivers: { total: { amount: 300, count: 2 } },
      total: { amount: 1500, count: 6 },
    });
    // The year's digest beside it is untouched: «ملخصات» still reads it.
    expect(dto.violationsYear).not.toBeNull();
    expect(violations.openDigest).toHaveBeenCalledTimes(1);
  });

  it('every gate it reads is the contracts table', () => {
    for (const s of NOW_SECTIONS) expect(FLEET_DASHBOARD_GATES[s.key].read).toBe('now');
  });
});

describe('rosterDigest — T2.3–T2.7, T1.6 from one board', () => {
  const absent = { seat: 1 as const, employeeId: 'f1', reason: 'fleetUnavailability' as const };
  const board: FleetRosterDayDto = {
    date: TODAY,
    licenceRule: 'flag',
    rows: [
      row({ vehicleId: 'a', manned: true, driver1EmployeeId: 'e1' }),
      row({ vehicleId: 'b', inMaintenance: true, assignable: false }),
      row({ vehicleId: 'c', licenceExpired: true, assignable: false }),
      // An absent fixed driver, the seat still naming him (planned before the absence).
      row({ vehicleId: 'd', planned: true, driver1EmployeeId: 'f1', crewGaps: [absent] }),
      // A gap for another reason (a suspended crew member).
      row({ vehicleId: 'e', crewGaps: [{ seat: 1, employeeId: 'f2', reason: 'notEmployed' }] }),
      // No crew, no plan.
      row({ vehicleId: 'f' }),
      // A covered seat: manned by a substitute.
      row({ vehicleId: 'g', manned: true, driver1EmployeeId: 'e2', crewCovered: 1 }),
      // A stale plan on a workshop car does not count (not ready).
      row({
        vehicleId: 'h',
        inMaintenance: true,
        assignable: false,
        planned: true,
        stalePlan: true,
      }),
      // A stale plan on a ready car, manned by its other seat.
      row({ vehicleId: 'i', planned: true, manned: true, stalePlan: true, driver1EmployeeId: 'x' }),
      // A car with a standing crew whose drivers are planned elsewhere: empty, but not «no crew».
      row({ vehicleId: 'j' }),
    ],
    availableDrivers: [
      { employeeId: 'e1', assignedVehicleId: 'a', licence: 'valid' },
      { employeeId: 'e2', assignedVehicleId: 'g', licence: 'notRecorded' },
      { employeeId: 'e3', assignedVehicleId: null, licence: 'noProfile' },
      { employeeId: 'e4', assignedVehicleId: null, licence: 'expired' },
    ],
    unavailableDrivers: [
      { employeeId: 'f1', reason: 'fleetUnavailability' },
      { employeeId: 'f3', reason: 'hrLeave' },
      { employeeId: 'f2', reason: 'notEmployed' },
      { employeeId: 'f4', reason: 'profileInactive' },
    ],
  };
  const digest = rosterDigest(board, new Set(['d', 'e', 'j']));

  it('ready = rows − in the workshop − licence expired', () => {
    expect(digest.rows).toBe(10);
    expect(digest.inWorkshop).toBe(2);
    expect(digest.licenceExpired).toBe(1);
    expect(digest.ready).toBe(7);
    expect(digest.ready).toBe(digest.rows - digest.inWorkshop - digest.licenceExpired);
  });

  it('a ready car is unmanned unless a seat names a driver available today', () => {
    expect(digest.readyManned).toBe(3);
    expect(digest.unmanned).toBe(4);
    expect(digest.unmannedCrewGap).toBe(2);
    expect(digest.unmannedStalePlan).toBe(0);
    expect(digest.unmannedNoCrew).toBe(1);
    // 'j' — a standing crew planned elsewhere — is none of the three: «لم يُعيَّن لها سائق».
    expect(digest.unmannedUnassigned).toBe(1);
    expect(
      digest.unmannedCrewGap +
        digest.unmannedStalePlan +
        digest.unmannedNoCrew +
        digest.unmannedUnassigned,
    ).toBe(digest.unmanned);
  });

  it('«أسباب عدم التعيين» are disjoint parts of unmanned: a stale plan counts only when unmanned', () => {
    const stale = rosterDigest(
      {
        ...board,
        rows: [
          // Manned by its other seat: a ready stale plan, but not unmanned.
          row({
            vehicleId: 'm',
            planned: true,
            manned: true,
            stalePlan: true,
            driver1EmployeeId: 'x',
          }),
          // Unmanned, its planned driver unavailable today.
          row({ vehicleId: 'n', planned: true, stalePlan: true, driver1EmployeeId: 'y' }),
          // Unmanned with a crew gap AND a stale plan: counted once, as the crew gap.
          row({
            vehicleId: 'o',
            planned: true,
            stalePlan: true,
            driver1EmployeeId: 'f1',
            crewGaps: [absent],
          }),
          // Unmanned, no crew, no plan.
          row({ vehicleId: 'p' }),
        ],
      },
      new Set(),
    );
    expect(stale.unmanned).toBe(3);
    expect(stale.crewGap.stalePlan).toBe(3);
    expect([stale.unmannedCrewGap, stale.unmannedStalePlan, stale.unmannedNoCrew]).toEqual([
      1, 1, 1,
    ]);
    expect(
      stale.unmannedCrewGap + stale.unmannedStalePlan + stale.unmannedNoCrew,
    ).toBeLessThanOrEqual(stale.unmanned);
  });

  it('T1.6 counts absence gaps; other reasons, covered seats and ready stale plans apart', () => {
    expect(digest.crewGap).toEqual({ vehicles: 1, otherReasons: 1, covered: 1, stalePlan: 1 });
  });

  it('registry = available + absent + inactive + not employed (suspended) + licence expired', () => {
    expect(digest.available).toBe(3);
    expect(digest.availableWithoutVehicle).toBe(1);
    expect(digest.availableLicenceNotRecorded).toBe(1);
    expect(digest.availableNoProfile).toBe(1);
    expect(digest.absent).toEqual({ attendance: 1, leave: 1 });
    expect(digest.notEmployed).toBe(1);
    expect(digest.profileInactive).toBe(1);
    expect(digest.licenceExpiredDrivers).toBe(1);
    expect(digest.registry).toBe(
      digest.available +
        digest.absent.attendance +
        digest.absent.leave +
        digest.profileInactive +
        digest.notEmployed +
        digest.licenceExpiredDrivers,
    );
  });

  it('with the refusal on, the expired drivers are counted from their reason', () => {
    const refused = rosterDigest(
      {
        ...board,
        licenceRule: 'refuse',
        availableDrivers: board.availableDrivers.filter((d) => d.licence !== 'expired'),
        unavailableDrivers: [
          ...board.unavailableDrivers,
          { employeeId: 'e4', reason: 'licenceExpired' },
        ],
      },
      new Set(),
    );
    expect(refused.licenceRule).toBe('refuse');
    expect(refused.licenceExpiredDrivers).toBe(1);
    expect(refused.available).toBe(3);
    expect(refused.registry).toBe(digest.registry);
  });
});

describe('distributionMatrix — T3.1–T3.3', () => {
  const branchList = [
    { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } },
    { id: B2, name: { ar: 'الجيزة', en: 'Giza' } },
  ];

  it('rows sum their cells and «بلا فرع»; the grand total is every active car', () => {
    const m = distributionMatrix({
      cells: [
        { typeId: T1, branchId: B1, count: 3 },
        { typeId: T1, branchId: null, count: 2 },
        { typeId: 'T2', branchId: B2, count: 4 },
      ],
      typeNames: new Map([[T1, { ar: 'مرسيدس', en: 'Mercedes' }]]),
      branches: branchList,
      scopeBranches: null,
    });
    expect(m.branches.map((b) => b.id)).toEqual([B1, B2]);
    expect(m.rows.map((r) => [r.typeId, r.total, r.noBranch])).toEqual([
      [T1, 5, 2],
      ['T2', 4, 0],
    ]);
    expect(m.totals).toEqual({ counts: { [B1]: 3, [B2]: 4 }, noBranch: 2, total: 9 });
    // «بلا فرع» is no branch: two branches hold the cars.
    expect(m.branchCount).toBe(2);
  });

  it('branchCount counts the branches holding a car — never «بلا فرع», never an empty column', () => {
    const m = distributionMatrix({
      cells: [
        { typeId: T1, branchId: B1, count: 3 },
        { typeId: 'T2', branchId: B1, count: 1 },
        { typeId: T1, branchId: null, count: 5 },
        // A zero cell (a grouped answer that cancelled out) adds no branch.
        { typeId: 'T2', branchId: B2, count: 0 },
      ],
      typeNames: new Map(),
      branches: branchList,
      scopeBranches: null,
    });
    // B2 is still a column (every branch is, for the company) — but it holds no car.
    expect(m.branches.map((b) => b.id)).toEqual([B1, B2]);
    expect(m.branchCount).toBe(1);
    expect(
      distributionMatrix({
        cells: [],
        typeNames: new Map(),
        branches: branchList,
        scopeBranches: null,
      }).branchCount,
    ).toBe(0);
  });

  it('a branch-scoped reader gets their branch as the only column', () => {
    const m = distributionMatrix({
      cells: [{ typeId: T1, branchId: B2, count: 1 }],
      typeNames: new Map(),
      branches: branchList,
      scopeBranches: new Set([B2]),
    });
    expect(m.branches.map((b) => b.id)).toEqual([B2]);
  });

  it('the distribution section counts the cash and ATM cars through the vehicles list', async () => {
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetVehicle.view']), NOW);
    expect(vehicles.countListed).toHaveBeenCalledWith(
      { status: ['active'], operationId: [OP_CASH] },
      expect.anything(),
    );
    expect(dto.distributionVehicles?.cash).toEqual({ vehicles: 1, operationIds: [OP_CASH] });
    expect(dto.distributionVehicles?.atm).toEqual({ vehicles: 1, operationIds: [OP_ATM] });
    expect(dto.distributionVehicles?.totals.total).toBe(5);
    // B1 holds 3 active cars; the 2 without a branch are no branch.
    expect(dto.distributionVehicles?.branchCount).toBe(1);
  });
});

describe('selectorBranches / dashboardBranches — what the figures cover (D9)', () => {
  const sel = (over: Partial<ScopeSelector>): ScopeSelector => ({
    scope: 'branch',
    userId: 'u',
    branchId: null,
    departmentId: null,
    sectionId: null,
    ...over,
  });

  it('the rule of the register: organization and own are everything; a reach its branches; else home', () => {
    expect(selectorBranches(sel({ scope: 'organization', branchId: B1 }))).toBe('all');
    expect(selectorBranches(sel({ scope: 'own', branchId: B1 }))).toBe('all');
    expect(selectorBranches(sel({ branchId: B1 }))).toEqual([B1]);
    expect(selectorBranches(sel({ branchId: B1, branchIds: [B1, B2] }))).toEqual([B1, B2]);
    // A department reach covers the branches its copies sit in, beside the whole branches.
    expect(
      selectorBranches(
        sel({
          scope: 'department',
          branchId: B1,
          branchIds: [B1],
          departmentIds: ['d'],
          departmentBranchIds: [B2],
        }),
      ),
    ).toEqual([B1, B2]);
    // A section is finer than a branch: it narrows to its branch.
    expect(selectorBranches(sel({ scope: 'section', branchId: B2 }))).toEqual([B2]);
    // A branch grant with no branch at all covers none.
    expect(selectorBranches(sel({}))).toEqual([]);
  });

  it('the switcher narrows inside the grant: an organization reader to its branch, a reach to one of its own', () => {
    expect(dashboardBranches(ctxWith(ALL_KEYS, { activeBranchId: B2 }))).toEqual([B2]);
    expect(dashboardBranches(ctxWith(ALL_KEYS, { branchId: B1 }))).toBeNull();
    expect(
      dashboardBranches(
        ctxWith(ALL_KEYS, { branchId: B1, activeBranchId: B2, ...MULTI }, 'branch'),
      ),
    ).toEqual([B2]);
    expect(dashboardBranches(ctxWith(ALL_KEYS, { branchId: B1, ...MULTI }, 'branch'))).toEqual([
      B1,
      B2,
    ]);
    // A header outside the reach is no narrowing: the whole reach.
    expect(
      dashboardBranches(
        ctxWith(ALL_KEYS, { branchId: B1, activeBranchId: B3, ...MULTI }, 'branch'),
      ),
    ).toEqual([B1, B2]);
  });
});

describe('rosterLists — «الحركة اليوم»: the rows the tiles count, and the absent drivers', () => {
  const gap = (employeeId: string, reason: 'fleetUnavailability' | 'hrLeave' | 'notEmployed') => ({
    seat: 1 as const,
    employeeId,
    reason,
  });
  const board: FleetRosterDayDto = {
    date: TODAY,
    licenceRule: 'flag',
    rows: [
      row({ vehicleId: 'm1', code: '101', manned: true, driver1EmployeeId: 'e1' }),
      // Not ready: never listed, whatever its seats say.
      row({ vehicleId: 'w1', code: '102', inMaintenance: true, assignable: false }),
      // crewGap — the fixed driver f1 on «تمام: غير متاح».
      row({
        vehicleId: 'g2',
        code: '120',
        driver1EmployeeId: 'f1',
        crewGaps: [gap('f1', 'fleetUnavailability')],
      }),
      row({
        vehicleId: 'g1',
        code: '110',
        crewGaps: [gap('f2', 'notEmployed')],
        missionTypeId: MISSION,
      }),
      // stalePlan — the planned x1 (not of the crew) is on leave.
      row({
        vehicleId: 's1',
        code: '130',
        planned: true,
        stalePlan: true,
        driver1EmployeeId: 'x1',
      }),
      // noCrew — no standing crew, nothing planned.
      row({ vehicleId: 'n1', code: '140', typeId: 'T-unknown' }),
      // unassigned — a standing crew whose drivers are taken elsewhere.
      row({ vehicleId: 'u1', code: '150' }),
    ],
    availableDrivers: [{ employeeId: 'e1', assignedVehicleId: 'm1', licence: 'valid' }],
    unavailableDrivers: [
      { employeeId: 'f1', reason: 'fleetUnavailability' },
      { employeeId: 'f2', reason: 'notEmployed' },
      { employeeId: 'x1', reason: 'hrLeave' },
      { employeeId: 'z9', reason: 'hrLeave' },
      { employeeId: 'z8', reason: 'fleetUnavailability' },
      { employeeId: 'p1', reason: 'profileInactive' },
    ],
  };
  const fixedCrews = [
    { vehicleId: 'g2', driver1EmployeeId: 'f1', driver2EmployeeId: null },
    { vehicleId: 'g1', driver1EmployeeId: 'f2', driver2EmployeeId: null },
    { vehicleId: 'u1', driver1EmployeeId: 'e7', driver2EmployeeId: null },
    // z9's standing car is OUTSIDE the board (another branch, or in the workshop): still named.
    { vehicleId: 'far', driver1EmployeeId: null, driver2EmployeeId: 'z9' },
  ];
  const names = {
    branchOf: new Map<string, string | null>([
      ['g1', B1],
      ['g2', B2],
      ['s1', B1],
      ['n1', null],
      ['u1', 'gone-branch'],
    ]),
    typeNames: new Map([[T1, { ar: 'مصفحة', en: 'Armoured' }]]),
    branchNames: new Map([
      [B1, CAIRO],
      [B2, GIZA],
    ]),
    missionNames: new Map([[MISSION, { ar: 'نقل أموال', en: 'Cash run' }]]),
    codesOf: new Map([
      ['g2', '120'],
      ['g1', '110'],
      ['u1', '150'],
      ['far', '999'],
    ]),
    driverCodes: new Map([
      ['f1', '20'],
      ['x1', '5'],
      ['z9', '30'],
      ['z8', '1'],
    ]),
  };
  const lists = rosterLists(board, fixedCrews, names);
  const digest = rosterDigest(board, new Set(['g1', 'g2', 'u1']));

  it('(a) the rows are exactly the ready, unmanned cars: class order, then code', () => {
    expect(lists.unmannedRows.map((r) => [r.code, r.why])).toEqual([
      ['110', 'crewGap'],
      ['120', 'crewGap'],
      ['130', 'stalePlan'],
      ['140', 'noCrew'],
      ['150', 'unassigned'],
    ]);
    expect(lists.unmannedRows).toHaveLength(digest.unmanned);
  });

  it('(b) each row’s class is the tile its count went to: per class, the rows ARE the tiles', () => {
    const per = (why: string) => lists.unmannedRows.filter((r) => r.why === why).length;
    expect(per('crewGap')).toBe(digest.unmannedCrewGap);
    expect(per('stalePlan')).toBe(digest.unmannedStalePlan);
    expect(per('noCrew')).toBe(digest.unmannedNoCrew);
    expect(per('unassigned')).toBe(digest.unmannedUnassigned);
    for (const r of board.rows.filter((x) => x.assignable && !x.manned)) {
      expect(unmannedClassOf(r, new Set(['g1', 'g2', 'u1']))).toBe(
        lists.unmannedRows.find((l) => l.vehicleId === r.vehicleId)?.why,
      );
    }
  });

  it('(c) the absent driver: the first gap seat (crew gap), the planned unavailable seat (stale plan)', () => {
    const of = (code: string) => lists.unmannedRows.find((r) => r.code === code)?.absent;
    expect(of('120')).toEqual({ employeeId: 'f1', reason: 'fleetUnavailability' });
    expect(of('110')).toEqual({ employeeId: 'f2', reason: 'notEmployed' });
    expect(of('130')).toEqual({ employeeId: 'x1', reason: 'hrLeave' });
    expect(of('140')).toBeNull();
    expect(of('150')).toBeNull();
  });

  it('(c) a stale plan names the planned seat that is NOT of the standing crew, even with the crew seated beside it', () => {
    const own = rosterLists(
      {
        ...board,
        rows: [
          row({
            vehicleId: 'g1',
            code: '110',
            planned: true,
            stalePlan: true,
            driver1EmployeeId: 'f2',
            driver2EmployeeId: 'x1',
          }),
        ],
      },
      fixedCrews,
      names,
    );
    expect(own.unmannedRows[0]?.absent).toEqual({ employeeId: 'x1', reason: 'hrLeave' });
  });

  it('(d) the absent drivers: «تمام» and leave only, crew members first, then «تمام», then the employee code', () => {
    expect(lists.absentDrivers).toEqual([
      // Crew members (their standing car named — z9's is off the board, still named).
      {
        employeeId: 'f1',
        reason: 'fleetUnavailability',
        crewVehicle: { vehicleId: 'g2', code: '120' },
      },
      { employeeId: 'z9', reason: 'hrLeave', crewVehicle: { vehicleId: 'far', code: '999' } },
      // Then «تمام» before leave.
      { employeeId: 'z8', reason: 'fleetUnavailability', crewVehicle: null },
      { employeeId: 'x1', reason: 'hrLeave', crewVehicle: null },
    ]);
    // notEmployed / profileInactive are not «غائبون»: they are the tiles' other reasons.
    expect(lists.absentDrivers.map((d) => d.employeeId)).not.toContain('f2');
    expect(lists.absentDrivers.map((d) => d.employeeId)).not.toContain('p1');
    expect(lists.absentDrivers).toHaveLength(digest.absent.attendance + digest.absent.leave);
  });

  it('(d) the crew car is the STANDING crew’s, even when that car is in the workshop or the seat is covered', () => {
    const covered = rosterLists(
      {
        ...board,
        rows: [row({ vehicleId: 'g2', code: '120', inMaintenance: true, assignable: false })],
      },
      fixedCrews,
      names,
    );
    expect(covered.absentDrivers[0]).toEqual({
      employeeId: 'f1',
      reason: 'fleetUnavailability',
      crewVehicle: { vehicleId: 'g2', code: '120' },
    });
  });

  it('(e) branch, type and mission are resolved; a missing one is null, never invented', () => {
    const of = (code: string) => lists.unmannedRows.find((r) => r.code === code);
    expect(of('110')).toMatchObject({
      branch: { id: B1, name: CAIRO },
      typeName: { ar: 'مصفحة', en: 'Armoured' },
      mission: { ar: 'نقل أموال', en: 'Cash run' },
    });
    expect(of('120')?.branch).toEqual({ id: B2, name: GIZA });
    expect(of('120')?.mission).toBeNull();
    // «بلا فرع» is null; an unknown type is null.
    expect(of('140')?.branch).toBeNull();
    expect(of('140')?.typeName).toBeNull();
    // A branch the list no longer holds keeps its id, with no made-up name.
    expect(of('150')?.branch).toEqual({ id: 'gone-branch', name: { ar: '—', en: '—' } });
  });

  it('both lists are capped at FLEET_DASHBOARD_TODAY_ROWS — the digest keeps the full counts', () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      row({ vehicleId: `n${i}`, code: String(300 - i) }),
    );
    const absent = Array.from({ length: 10 }, (_, i) => ({
      employeeId: `a${i}`,
      reason: 'hrLeave',
    }));
    const big = { ...board, rows: many, unavailableDrivers: absent };
    const capped = rosterLists(big, [], { ...names, driverCodes: new Map() });
    expect(capped.unmannedRows).toHaveLength(FLEET_DASHBOARD_TODAY_ROWS);
    // Code order: the lowest codes are the ones listed.
    expect(capped.unmannedRows[0]?.code).toBe('290');
    expect(capped.absentDrivers).toHaveLength(FLEET_DASHBOARD_TODAY_ROWS);
    expect(rosterDigest(big, new Set()).unmanned).toBe(11);
  });

  it('the roster section names its rows with ONE read each, and only what the rows need', async () => {
    roster.boardWithCrews.mockResolvedValueOnce({
      board,
      fixedCrews,
      branchOf: names.branchOf,
      driverCodes: names.driverCodes,
    });
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetRoster.view']), NOW);
    expect(dto.roster?.unmannedRows.map((r) => r.code)).toEqual([
      '110',
      '120',
      '130',
      '140',
      '150',
    ]);
    expect(dto.roster?.unmannedUnassigned).toBe(1);
    // The listed rows' missions only.
    expect(catalog.namesByIds).toHaveBeenCalledTimes(1);
    expect(catalog.namesByIds).toHaveBeenCalledWith([MISSION]);
    // One codes lookup — the crew car off the board only.
    expect(vehicles.codesByIds).toHaveBeenCalledTimes(1);
    expect(vehicles.codesByIds).toHaveBeenCalledWith(['far']);
    expect(dto.roster?.absentDrivers[1]?.crewVehicle).toEqual({ vehicleId: 'far', code: 'C-far' });
    expect(types.listAll).toHaveBeenCalledTimes(1);
    expect(branches.listAll).toHaveBeenCalledTimes(1);
  });

  it('a board with nobody to list asks for no names at all', async () => {
    await fleetDashboardNowService.read(ctxWith(['fleetRoster.view']), NOW);
    expect(catalog.namesByIds).not.toHaveBeenCalled();
    expect(vehicles.codesByIds).not.toHaveBeenCalled();
    expect(types.listAll).not.toHaveBeenCalled();
    expect(branches.listAll).not.toHaveBeenCalled();
  });

  it('the type and branch lists are read once when the matrix and the rows both name them', async () => {
    roster.boardWithCrews.mockResolvedValueOnce({
      board,
      fixedCrews,
      branchOf: names.branchOf,
      driverCodes: names.driverCodes,
    });
    await fleetDashboardNowService.read(ctxWith(['fleetRoster.view', 'fleetVehicle.view']), NOW);
    expect(types.listAll).toHaveBeenCalledTimes(1);
    expect(branches.listAll).toHaveBeenCalledTimes(1);
  });

  it('a naming lookup that fails costs the names, never the roster: the counts and the rows stay', async () => {
    roster.boardWithCrews.mockResolvedValueOnce({
      board,
      fixedCrews,
      branchOf: names.branchOf,
      driverCodes: names.driverCodes,
    });
    branches.listAll.mockRejectedValueOnce(new Error('branches down'));
    types.listAll.mockRejectedValueOnce(new Error('types down'));
    catalog.namesByIds.mockRejectedValueOnce(new Error('catalog down'));
    vehicles.codesByIds.mockRejectedValueOnce(new Error('codes down'));
    const dto = await fleetDashboardNowService.read(ctxWith(['fleetRoster.view']), NOW);
    expect(dto.unavailable).not.toContain('roster');
    expect(dto.roster?.unmanned).toBe(digest.unmanned);
    expect(dto.roster?.unmannedRows.map((r) => r.code)).toEqual([
      '110',
      '120',
      '130',
      '140',
      '150',
    ]);
    const first = dto.roster?.unmannedRows[0];
    expect(first?.branch).toEqual({ id: B1, name: { ar: '—', en: '—' } });
    expect(first?.typeName).toBeNull();
    expect(first?.mission).toBeNull();
    // The crew car off the board loses its code, so it is not named; the driver stays listed.
    expect(dto.roster?.absentDrivers.map((a) => a.employeeId)).toEqual(
      lists.absentDrivers.map((a) => a.employeeId),
    );
    expect(dto.roster?.absentDrivers[1]?.crewVehicle).toBeNull();
  });
});
