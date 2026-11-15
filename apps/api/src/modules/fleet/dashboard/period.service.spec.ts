// R2 composition, with every owning module stubbed (plan §9 "Dashboard service unit").
//
// Pinned here: the gating matrix (each key alone ⇒ its sections, no other service asked), the echo of
// R-01 (the range and its granularity, from the request's Cairo day) and R-13 (the set as filters,
// with the reader's branches by name), the SCREEN-SHAPED calls of D9 (each module asked with the
// query its linked page sends, narrowed by the reader's branches: one, «كل فروعي», or none), the
// company view's undated note, R-19's «never added to the dealership», the overview's exit-day
// count (D6), «حسب النوع» for exactly one branch (D10), and isolation.
import {
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_PERIOD_SECTIONS,
  FleetDashboardPeriodQuerySchema,
  fleetDashboardGateKeys,
  type FleetDashboardPeriodSection,
} from '@ecms/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type AuthContext } from '../../../shared/types';

const fn = (): Mock => vi.fn();
const odometer = { kmBreakdown: fn() };
const maintenance = { visitStates: fn(), exitBreakdown: fn() };
const accidents = { summaryOver: fn(), undatedCount: fn(), list: fn() };
const receipts = { summaryOver: fn(), firstReceiptDate: fn() };
const dealership = { summaryOver: fn() };
const vehicles = { codesByIds: fn() };
const set = { vehicleSet: fn() };
const settings = { resolve: fn() };
const branches = { listAll: fn() };

vi.mock('../odometer/odometer.service', () => ({ fleetOdometerService: odometer }));
vi.mock('../maintenance/maintenance.service', () => ({ fleetMaintenanceService: maintenance }));
vi.mock('../accidents/accident.service', () => ({ fleetAccidentService: accidents }));
vi.mock('../receipts/receipt.service', () => ({ fleetReceiptService: receipts }));
vi.mock('../dealership/dealership.service', () => ({ fleetDealershipService: dealership }));
vi.mock('../vehicles/vehicle.repository', () => ({ fleetVehicleRepository: vehicles }));
vi.mock('../vehicles/vehicle-set', () => ({
  vehicleSet: (...args: unknown[]) => set.vehicleSet(...args) as unknown,
  withVehicleFilterMemo: <T>(read: () => Promise<T>): Promise<T> => read(),
}));
vi.mock('../../../platform/settings', () => ({ settingsService: settings }));
vi.mock('../../../platform/organization/branches/branch.repository', () => ({
  branchRepository: branches,
}));

const { fleetDashboardPeriodService, screenFilter } = await import('./period.service');

const NOW = new Date('2026-10-31T23:30:00.000Z');
const TODAY = '2026-11-01';
const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';
const B3 = '650000000000000000000103';
const CAIRO = { ar: 'القاهرة', en: 'Cairo' };
const GIZA = { ar: 'الجيزة', en: 'Giza' };
const T1 = '650000000000000000000201';
const OP1 = '650000000000000000000301';
const V1 = '650000000000000000000001';

const ctxWith = (
  keys: readonly string[],
  extra: Partial<AuthContext> = {},
  scope: 'organization' | 'branch' | 'own' = 'organization',
): AuthContext => ({
  userId: '650000000000000000000999',
  sessionId: 's',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: Object.fromEntries(keys.map((key) => [key, scope])),
  permissionVersion: 1,
  isPrivileged: false,
  ...extra,
});
/** A branch-scoped reader whose grants reach B1 and B2 — «كل فروعي». */
const MULTI: Partial<AuthContext> = {
  branchId: B1,
  reach: { branchIds: [B1, B2], departments: [] },
};
const ALL_KEYS = [...FLEET_DASHBOARD_PERIOD_KEYS];
const parse = (raw: Record<string, string>) => FleetDashboardPeriodQuerySchema.parse(raw);
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const KM = { total: 1200 };
const VISITS = { count: 4, closed: 3, open: 1 };
/** The exit-day breakdown as the maintenance module answers it — passed through untouched. */
const EXITS = {
  count: 37,
  avgStayDays: 2.4,
  byWorkType: [{ id: 'wt', name: { ar: 'صيانة دورية', en: 'Service' }, count: 37 }],
  byWorkshop: [{ id: 'ws', name: null, count: 37 }],
  topVehicles: [],
  unregistered: 0,
};
const NO_ECHO_BRANCHES = { scopeBranches: null };

beforeEach(() => {
  vi.clearAllMocks();
  settings.resolve.mockResolvedValue(3);
  odometer.kmBreakdown.mockResolvedValue(KM);
  maintenance.visitStates.mockResolvedValue(VISITS);
  maintenance.exitBreakdown.mockResolvedValue(EXITS);
  branches.listAll.mockResolvedValue([
    { _id: B1, name: CAIRO },
    { _id: B2, name: GIZA },
  ]);
  accidents.summaryOver.mockImplementation((q: { status?: string }) =>
    Promise.resolve(
      q.status === 'open' ? { count: 1, remaining: 700 } : { count: 3, remaining: 900 },
    ),
  );
  accidents.undatedCount.mockResolvedValue(25);
  accidents.list.mockResolvedValue({
    items: [
      {
        _id: 'a1',
        vehicleId: V1,
        vehicleCode: null,
        occurredAt: day('2026-11-01'),
        culprit: 'محمد',
        culpritEmployeeId: null,
        culpritEmployeeIds: [],
        status: 'open',
        amountCollected: 0,
        companyCost: 1000,
        paidAmount: 300,
        transferredIn: 0,
        transferredOut: 0,
      },
      {
        _id: 'a2',
        vehicleId: null,
        vehicleCode: '777',
        occurredAt: day('2026-11-01'),
        culprit: 'طرف ثالث',
        culpritEmployeeId: 'e9',
        status: 'closed',
        amountCollected: 0,
        companyCost: 0,
        paidAmount: 0,
      },
    ],
    meta: { page: 1, pageSize: 6, totalItems: 9, totalPages: 2 },
  });
  vehicles.codesByIds.mockResolvedValue(new Map([[V1, '101']]));
  receipts.summaryOver.mockResolvedValue({
    count: 7,
    cardTotal: 100.1,
    custodyTotal: 200.2,
    fuelTotal: 250.25,
  });
  receipts.firstReceiptDate.mockResolvedValue('2026-08-15');
  dealership.summaryOver.mockResolvedValue({ count: 5, pending: 2, dealershipTotal: 4000 });
  set.vehicleSet.mockImplementation(
    (
      f: { typeIds?: string[]; operationIds?: string[]; vehicleCodes?: string[] },
      branchIds: readonly string[] | null,
      opts: { branchId?: string | null } = {},
    ) => {
      const narrows =
        branchIds !== null ||
        f.typeIds !== undefined ||
        f.operationIds !== undefined ||
        f.vehicleCodes !== undefined;
      return Promise.resolve({
        ids: narrows ? [V1] : undefined,
        scope: {
          count: narrows ? 1 : null,
          typeIds: f.typeIds ?? [],
          operationIds: f.operationIds ?? [],
          vehicleCodes: f.vehicleCodes ?? [],
          branchId: opts.branchId ?? null,
        },
      });
    },
  );
});

const USES: Record<FleetDashboardPeriodSection, readonly Mock[]> = {
  km: [odometer.kmBreakdown],
  visits: [maintenance.visitStates],
  exits: [maintenance.exitBreakdown],
  accidents: [accidents.summaryOver, accidents.undatedCount],
  accidentList: [accidents.list, vehicles.codesByIds],
  opex: [receipts.summaryOver, receipts.firstReceiptDate],
  dealership: [dealership.summaryOver],
};
const EVERY_STUB = [...new Set(Object.values(USES).flat())];

describe('R2 — the gating matrix', () => {
  it.each(ALL_KEYS)('with only %s, exactly its sections answer', async (key) => {
    const dto = await fleetDashboardPeriodService.read(ctxWith([key]), NOW, parse({}));
    const covered = FLEET_DASHBOARD_PERIOD_SECTIONS.filter((s) =>
      fleetDashboardGateKeys(s).every((k) => k === key),
    );
    expect(covered.length).toBeGreaterThan(0);
    for (const s of FLEET_DASHBOARD_PERIOD_SECTIONS) {
      if (covered.includes(s)) expect(dto[s], s).not.toBeNull();
      else expect(dto[s], s).toBeNull();
    }
    const asked = new Set(covered.flatMap((s) => USES[s]));
    for (const stub of EVERY_STUB) expect(stub.mock.calls.length > 0).toBe(asked.has(stub));
  });
});

describe('R2 — the echo (R-01, R-13)', () => {
  it('this month on Cairo 2026-11-01 (the clock at 2026-10-31T23:30Z) is one day, by the day', async () => {
    const dto = await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS), NOW, parse({}));
    expect(dto.today).toBe(TODAY);
    expect(dto.asOf).toBe(NOW.toISOString());
    expect(dto.range).toEqual({
      preset: 'thisMonth',
      from: TODAY,
      to: TODAY,
      days: 1,
      granularity: 'day',
    });
    expect(dto.vehicleScope).toEqual({
      count: null,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
      branchId: null,
      ...NO_ECHO_BRANCHES,
    });
    // The whole company names no branch: the branch list is not read.
    expect(branches.listAll).not.toHaveBeenCalled();
  });

  it('last month is October; this year goes by the month', async () => {
    const last = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS),
      NOW,
      parse({ preset: 'lastMonth' }),
    );
    expect(last.range).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      days: 31,
      granularity: 'day',
    });
    const year = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS),
      NOW,
      parse({ preset: 'thisYear' }),
    );
    expect(year.range).toMatchObject({
      from: '2026-01-01',
      to: TODAY,
      days: 305,
      granularity: 'month',
    });
  });

  it('a custom range is taken as given', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS),
      NOW,
      parse({ preset: 'custom', from: '2026-09-01', to: '2026-09-30' }),
    );
    expect(dto.range).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
      days: 30,
      granularity: 'day',
    });
  });

  it('echoes the set as FILTERS, with the switcher branch; the car count for a registry reader', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith([...ALL_KEYS, 'fleetVehicle.view'], { activeBranchId: B2 }),
      NOW,
      parse({ typeIds: T1, vehicleCodes: '101' }),
    );
    expect(set.vehicleSet).toHaveBeenCalledWith(
      { vehicleCodes: ['101'], typeIds: [T1], operationIds: undefined },
      [B2],
      { count: true, branchId: B2 },
    );
    expect(dto.vehicleScope).toEqual({
      count: 1,
      typeIds: [T1],
      operationIds: [],
      vehicleCodes: ['101'],
      branchId: B2,
      scopeBranches: [{ id: B2, name: GIZA }],
    });
  });

  it('«كل فروعي» — a reader reaching two branches: both narrow the set, both are echoed by name, no switcher', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith([...ALL_KEYS, 'fleetVehicle.view'], MULTI, 'branch'),
      NOW,
      parse({}),
    );
    expect(set.vehicleSet).toHaveBeenCalledWith(
      { vehicleCodes: undefined, typeIds: undefined, operationIds: undefined },
      [B1, B2],
      { count: true, branchId: null },
    );
    expect(dto.vehicleScope.branchId).toBeNull();
    expect(dto.vehicleScope.scopeBranches).toEqual([
      { id: B1, name: CAIRO },
      { id: B2, name: GIZA },
    ]);
    // The list is read once for the whole read.
    expect(branches.listAll).toHaveBeenCalledTimes(1);
  });

  it('a branch the list no longer holds stays in the echo under «—», never named by a guess', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { activeBranchId: B3 }),
      NOW,
      parse({}),
    );
    expect(dto.vehicleScope.branchId).toBe(B3);
    // The echo is what the figures cover: one branch, so the web's one-branch layout and its
    // `branch=` links agree with the server's (`km.byType` is drawn for exactly one branch).
    expect(dto.vehicleScope.scopeBranches).toEqual([{ id: B3, name: { ar: '—', en: '—' } }]);
  });

  it('a failure to read the branch names costs the names, never the read: the ids stay, «—» each', async () => {
    branches.listAll.mockRejectedValueOnce(new Error('branches down'));
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, MULTI, 'branch'),
      NOW,
      parse({}),
    );
    expect(dto.vehicleScope.scopeBranches).toEqual([
      { id: B1, name: { ar: '—', en: '—' } },
      { id: B2, name: { ar: '—', en: '—' } },
    ]);
    expect(dto.unavailable).toEqual([]);
  });

  it('without fleetVehicle.view the set’s car count is not asked for (the filters still echo)', async () => {
    await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { activeBranchId: B2 }),
      NOW,
      parse({ vehicleCodes: '101' }),
    );
    expect(set.vehicleSet).toHaveBeenCalledWith(
      { vehicleCodes: ['101'], typeIds: undefined, operationIds: undefined },
      [B2],
      { count: false, branchId: B2 },
    );
  });

  it('a failure resolving the set costs the count, never the read: every section still computes', async () => {
    set.vehicleSet.mockRejectedValueOnce(new Error('fleet_vehicles down'));
    const dto = await fleetDashboardPeriodService.read(
      ctxWith([...ALL_KEYS, 'fleetVehicle.view']),
      NOW,
      parse({ typeIds: T1 }),
    );
    expect(dto.vehicleScope).toEqual({
      count: null,
      typeIds: [T1],
      operationIds: [],
      vehicleCodes: [],
      branchId: null,
      ...NO_ECHO_BRANCHES,
    });
    expect(dto.unavailable).toEqual([]);
    expect(dto.km).not.toBeNull();
    // A set narrows (from the query): the company-only «حوادث بلا تاريخ» is not read.
    expect(dto.accidents?.undated).toBeNull();
  });
});

describe('R2 — screen-shaped calls (D9)', () => {
  const read = (extra: Partial<AuthContext>, raw: Record<string, string>) =>
    fleetDashboardPeriodService.read(ctxWith(ALL_KEYS, extra), NOW, parse(raw));

  it('every module gets the linked page’s own query: the days, the filters, the branch', async () => {
    await read(
      { activeBranchId: B2 },
      {
        preset: 'custom',
        from: '2026-10-01',
        to: '2026-10-15',
        typeIds: T1,
        operationIds: OP1,
      },
    );
    const shaped = {
      from: day('2026-10-01'),
      to: day('2026-10-15'),
      typeIds: [T1],
      operationIds: [OP1],
      branchIds: [B2],
    };
    // «أرقام الفترة»: the CHECK-IN day, exactly as the maintenance list's `from`/`to`.
    expect(maintenance.visitStates).toHaveBeenCalledWith(shaped);
    expect(accidents.summaryOver).toHaveBeenCalledWith(shaped);
    expect(accidents.summaryOver).toHaveBeenCalledWith({ ...shaped, status: 'open' });
    expect(receipts.summaryOver).toHaveBeenCalledWith(shaped);
    expect(dealership.summaryOver).toHaveBeenCalledWith(shaped);
    expect(accidents.list).toHaveBeenCalledWith({
      ...shaped,
      page: 1,
      pageSize: 6,
      sortBy: 'occurredAt',
      sortDir: 'desc',
    });
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: '2026-10-01', to: '2026-10-15', typeIds: [T1], operationIds: [OP1], branchIds: [B2] },
      { today: TODAY, staleDays: 3, byType: true, setNarrows: true },
    );
    // «الصيانة والورش»: the same set, bounded by the EXIT day — never by `from`/`to`.
    expect(maintenance.exitBreakdown).toHaveBeenCalledWith({
      outFrom: day('2026-10-01'),
      outTo: day('2026-10-15'),
      typeIds: [T1],
      operationIds: [OP1],
      branchIds: [B2],
    });
    const [exitQuery] = maintenance.exitBreakdown.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(exitQuery)).not.toContain('from');
    expect(Object.keys(exitQuery)).not.toContain('to');
  });

  it('«كل فروعي» narrows every module to BOTH branches — the list the links carry as `branch=a,b`', async () => {
    await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS, MULTI, 'branch'), NOW, parse({}));
    const both = { from: day(TODAY), to: day(TODAY), branchIds: [B1, B2] };
    expect(maintenance.visitStates).toHaveBeenCalledWith(both);
    expect(maintenance.exitBreakdown).toHaveBeenCalledWith({
      outFrom: day(TODAY),
      outTo: day(TODAY),
      branchIds: [B1, B2],
    });
    expect(accidents.summaryOver).toHaveBeenCalledWith(both);
    expect(receipts.summaryOver).toHaveBeenCalledWith(both);
    expect(dealership.summaryOver).toHaveBeenCalledWith(both);
    // Two branches are not «a branch»: the km come by branch, not by type.
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: TODAY, to: TODAY, branchIds: [B1, B2] },
      { today: TODAY, staleDays: 3, byType: false, setNarrows: true },
    );
    // A set narrows (from the reader's branches): the company-only undated note is not read.
    expect(accidents.undatedCount).not.toHaveBeenCalled();
  });

  it('a reader whose only branch is the home branch: one branch in scope ⇒ «حسب النوع», as a switcher would', async () => {
    // An ORGANIZATION grant with a home branch is the company (below); a BRANCH grant is its branch.
    await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { branchId: B1 }, 'branch'),
      NOW,
      parse({}),
    );
    expect(dealership.summaryOver).toHaveBeenCalledWith({
      from: day(TODAY),
      to: day(TODAY),
      branchIds: [B1],
    });
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: TODAY, to: TODAY, branchIds: [B1] },
      { today: TODAY, staleDays: 3, byType: true, setNarrows: true },
    );
  });

  it('a stale switcher header (a branch outside a home-only reader’s grant) is ignored, never followed', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { branchId: B1, activeBranchId: B2 }, 'branch'),
      NOW,
      parse({}),
    );
    expect(dealership.summaryOver).toHaveBeenCalledWith({
      from: day(TODAY),
      to: day(TODAY),
      branchIds: [B1],
    });
    expect(dto.vehicleScope.branchId).toBeNull();
    expect(dto.vehicleScope.scopeBranches).toEqual([{ id: B1, name: CAIRO }]);
  });

  it('a branch grant with no branch at all (`[]`) narrows every module to NOTHING', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, {}, 'branch'),
      NOW,
      parse({}),
    );
    expect(dealership.summaryOver).toHaveBeenCalledWith({
      from: day(TODAY),
      to: day(TODAY),
      branchIds: [],
    });
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: TODAY, to: TODAY, branchIds: [] },
      { today: TODAY, staleDays: 3, byType: false, setNarrows: true },
    );
    expect(dto.vehicleScope.scopeBranches).toEqual([]);
  });

  it('an `own` grant keeps the company figures (own is not narrowed by branch)', async () => {
    const dto = await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { branchId: B1 }, 'own'),
      NOW,
      parse({}),
    );
    expect(dealership.summaryOver).toHaveBeenCalledWith({ from: day(TODAY), to: day(TODAY) });
    expect(dto.vehicleScope.scopeBranches).toBeNull();
  });

  it('the company view adds no vehicle clause and names the undated files', async () => {
    const dto = await read({}, {});
    expect(accidents.summaryOver).toHaveBeenCalledWith({ from: day(TODAY), to: day(TODAY) });
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: TODAY, to: TODAY },
      { today: TODAY, staleDays: 3, byType: false, setNarrows: false },
    );
    expect(maintenance.exitBreakdown).toHaveBeenCalledWith({
      outFrom: day(TODAY),
      outTo: day(TODAY),
    });
    expect(accidents.undatedCount).toHaveBeenCalledWith({});
    expect(dto.accidents).toEqual({ count: 3, open: 1, openRemaining: 700, undated: 25 });
  });

  it('a narrowed view leaves the undated note out (it belongs to no set)', async () => {
    const dto = await read({}, { vehicleCodes: '101' });
    expect(accidents.undatedCount).not.toHaveBeenCalled();
    expect(dto.accidents?.undated).toBeNull();
  });

  it('the home branch is not a narrowing: only the switcher is', async () => {
    await read({ branchId: B2 }, {});
    expect(dealership.summaryOver).toHaveBeenCalledWith({ from: day(TODAY), to: day(TODAY) });
  });

  it('screenFilter leaves out every key nobody asked; the branches travel as the list', () => {
    expect(screenFilter({}, null)).toEqual({});
    expect(screenFilter({ vehicleCodes: ['1'] }, [B2])).toEqual({
      vehicleCodes: ['1'],
      branchIds: [B2],
    });
    expect(screenFilter({}, [B1, B2])).toEqual({ branchIds: [B1, B2] });
    // `[]` is a real answer — no branch — and narrows to nothing; it is not dropped.
    expect(screenFilter({}, [])).toEqual({ branchIds: [] });
  });
});

describe('R2 — the figures as their modules give them', () => {
  it('opex is card + custody, never the dealership; each money card names its first day', async () => {
    const dto = await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS), NOW, parse({}));
    expect(dto.opex).toEqual({
      card: 100.1,
      custody: 200.2,
      // «مصروف الوقود»: the receipts' own fuel total (kind=fuel, either payer), never re-added here.
      fuel: 250.25,
      total: 300.3,
      count: 7,
      dataFrom: '2026-08-15',
    });
    // «الصيانة والورش» (exit day) and «أرقام الفترة» (check-in day): each as its module answers.
    expect(dto.exits).toBe(EXITS);
    expect(dto.dealership).toEqual({ amount: 4000, rows: 5, pending: 2, dataFrom: '2026-09-01' });
    expect(dto.km).toBe(KM);
    expect(dto.visits).toBe(VISITS);
  });

  it('the accident list: date only, the code (a legacy row’s own), the culprit ids, what is left', async () => {
    const dto = await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS), NOW, parse({}));
    expect(dto.accidentList).toEqual({
      rows: [
        {
          accidentId: 'a1',
          vehicleId: V1,
          code: '101',
          date: TODAY,
          culprit: 'محمد',
          culpritEmployeeIds: [],
          status: 'open',
          remaining: 700,
        },
        {
          accidentId: 'a2',
          vehicleId: null,
          code: '777',
          date: TODAY,
          culprit: 'طرف ثالث',
          culpritEmployeeIds: ['e9'],
          status: 'closed',
          remaining: 0,
        },
      ],
      more: 7,
    });
  });

  it('a section that throws is null and named; the rest answer', async () => {
    odometer.kmBreakdown.mockRejectedValueOnce(new Error('boom'));
    const dto = await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS), NOW, parse({}));
    expect(dto.km).toBeNull();
    expect(dto.unavailable).toEqual(['km']);
    expect(dto.visits).not.toBeNull();
    expect(dto.opex).not.toBeNull();
  });
});
