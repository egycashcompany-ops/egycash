// R2 composition, with every owning module stubbed (plan §9 "Dashboard service unit").
//
// Pinned here: the gating matrix (each key alone ⇒ its sections, no other service asked), the echo of
// R-01 (the range and its granularity, from the request's Cairo day) and R-13 (the set as filters),
// the SCREEN-SHAPED calls of D9 (each module asked with the query its linked page sends), the company
// view's undated note, R-19's «never added to the dealership», and isolation.
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
const maintenance = { visitBreakdown: fn() };
const accidents = { summaryOver: fn(), undatedCount: fn(), list: fn() };
const receipts = { summaryOver: fn(), firstReceiptDate: fn() };
const dealership = { summaryOver: fn() };
const vehicles = { codesByIds: fn() };
const set = { vehicleSet: fn() };
const settings = { resolve: fn() };

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

const { fleetDashboardPeriodService, screenFilter } = await import('./period.service');

const NOW = new Date('2026-10-31T23:30:00.000Z');
const TODAY = '2026-11-01';
const B2 = '650000000000000000000102';
const T1 = '650000000000000000000201';
const OP1 = '650000000000000000000301';
const V1 = '650000000000000000000001';

const ctxWith = (keys: readonly string[], extra: Partial<AuthContext> = {}): AuthContext => ({
  userId: '650000000000000000000999',
  sessionId: 's',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: Object.fromEntries(keys.map((key) => [key, 'organization'])),
  permissionVersion: 1,
  isPrivileged: false,
  ...extra,
});
const ALL_KEYS = [...FLEET_DASHBOARD_PERIOD_KEYS];
const parse = (raw: Record<string, string>) => FleetDashboardPeriodQuerySchema.parse(raw);
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const KM = { total: 1200 };
const VISITS = { count: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  settings.resolve.mockResolvedValue(3);
  odometer.kmBreakdown.mockResolvedValue(KM);
  maintenance.visitBreakdown.mockResolvedValue(VISITS);
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
  receipts.summaryOver.mockResolvedValue({ count: 7, cardTotal: 100.1, custodyTotal: 200.2 });
  receipts.firstReceiptDate.mockResolvedValue('2026-08-15');
  dealership.summaryOver.mockResolvedValue({ count: 5, pending: 2, dealershipTotal: 4000 });
  set.vehicleSet.mockImplementation(
    (
      f: { typeIds?: string[]; operationIds?: string[]; vehicleCodes?: string[] },
      branchId: string | null,
    ) => {
      const narrows =
        branchId !== null ||
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
          branchId,
        },
      });
    },
  );
});

const USES: Record<FleetDashboardPeriodSection, readonly Mock[]> = {
  km: [odometer.kmBreakdown],
  visits: [maintenance.visitBreakdown],
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
    });
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
      B2,
      { count: true },
    );
    expect(dto.vehicleScope).toEqual({
      count: 1,
      typeIds: [T1],
      operationIds: [],
      vehicleCodes: ['101'],
      branchId: B2,
    });
  });

  it('without fleetVehicle.view the set’s car count is not asked for (the filters still echo)', async () => {
    await fleetDashboardPeriodService.read(
      ctxWith(ALL_KEYS, { activeBranchId: B2 }),
      NOW,
      parse({ vehicleCodes: '101' }),
    );
    expect(set.vehicleSet).toHaveBeenCalledWith(
      { vehicleCodes: ['101'], typeIds: undefined, operationIds: undefined },
      B2,
      { count: false },
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
    expect(maintenance.visitBreakdown).toHaveBeenCalledWith(shaped);
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
      { today: TODAY, staleDays: 3, branchId: B2, setNarrows: true },
    );
  });

  it('the company view adds no vehicle clause and names the undated files', async () => {
    const dto = await read({}, {});
    expect(accidents.summaryOver).toHaveBeenCalledWith({ from: day(TODAY), to: day(TODAY) });
    expect(odometer.kmBreakdown).toHaveBeenCalledWith(
      { from: TODAY, to: TODAY },
      { today: TODAY, staleDays: 3, branchId: null, setNarrows: false },
    );
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

  it('screenFilter leaves out every key nobody asked', () => {
    expect(screenFilter({}, null)).toEqual({});
    expect(screenFilter({ vehicleCodes: ['1'] }, B2)).toEqual({
      vehicleCodes: ['1'],
      branchIds: [B2],
    });
  });
});

describe('R2 — the figures as their modules give them', () => {
  it('opex is card + custody, never the dealership; each money card names its first day', async () => {
    const dto = await fleetDashboardPeriodService.read(ctxWith(ALL_KEYS), NOW, parse({}));
    expect(dto.opex).toEqual({
      card: 100.1,
      custody: 200.2,
      total: 300.3,
      count: 7,
      dataFrom: '2026-08-15',
    });
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
