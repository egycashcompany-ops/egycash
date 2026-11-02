// The maintenance module's dashboard reads (P1-05; R-09, R-12, R-17, R-18, R-26).
//
// Each read is the LIST's own filter: these specs capture the filter `/fleet/maintenance` counts
// with for a query and the filter each read sends for the same query, and require them to be the
// same object — equal filters are equal numbers, by construction. The arithmetic (state, facets,
// ties, the oldest stay, the business date) is pinned on stubbed facets; the integration spec
// `fleet-maintenance-breakdown.spec.ts` proves the sums on real rows.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLEET_DASHBOARD_RANK_ROWS,
  ListFleetMaintenanceQuerySchema,
  type FleetDashboardPeriodVisitsDto,
  type ListFleetMaintenanceQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { FleetMaintenanceVisitModel } from './maintenance.model';
import { fleetMaintenanceService, type MaintenanceFilterQuery } from './maintenance.service';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';

const oid = (): Types.ObjectId => new Types.ObjectId();
const [CAR1, CAR2, CAR3, CAR4, CAR_GONE] = [oid(), oid(), oid(), oid(), oid()];
const [WT_OIL, WT_BRAKES, WT_TYRES, WS_A, WS_B] = [oid(), oid(), oid(), oid(), oid()];
const T1 = String(oid());
const O1 = String(oid());
const B1 = String(oid());

const NAMES = new Map<string, LocalizedString>([
  [String(WT_OIL), { ar: 'تغيير زيت', en: 'Oil' }],
  [String(WT_BRAKES), { ar: 'فرامل', en: 'Brakes' }],
  [String(WT_TYRES), { ar: 'إطارات', en: 'Tyres' }],
  [String(WS_A), { ar: 'ورشة التوكيل', en: 'Dealer' }],
  // WS_B has no catalog row any more — it reads `null` and sorts last.
]);
/** The registry, deleted cars included (`findByIdsSystem`); CAR_GONE has left it. */
const CARS = new Map<string, { _id: Types.ObjectId; code: string; isDeleted: boolean }>(
  (
    [
      [CAR1, '201', false],
      [CAR2, '202', false],
      [CAR3, '203', false],
      [CAR_GONE, '204', true],
      [CAR4, '205', false],
    ] as const
  ).map(([_id, code, isDeleted]) => [String(_id), { _id, code, isDeleted }]),
);

/** The list's query exactly as the HTTP layer parses it. */
const parse = (raw: Record<string, unknown>): ListFleetMaintenanceQuery =>
  ListFleetMaintenanceQuerySchema.parse(raw);
/** The query less its page and order — what the dashboard's reads are asked. */
const filterPart = (q: ListFleetMaintenanceQuery): MaintenanceFilterQuery => {
  const rest: Partial<ListFleetMaintenanceQuery> = { ...q };
  for (const key of ['page', 'pageSize', 'sort', 'sortBy', 'sortDir'] as const) delete rest[key];
  return rest as MaintenanceFilterQuery;
};

let aggregates: unknown[][] = [];
let facets: unknown[] = [];
let counted: unknown[] = [];

beforeEach(() => {
  aggregates = [];
  counted = [];
  vi.spyOn(FleetMaintenanceVisitModel, 'aggregate').mockImplementation(((pipeline: unknown[]) => {
    aggregates.push(pipeline);
    return Promise.resolve(facets);
  }) as unknown as typeof FleetMaintenanceVisitModel.aggregate);
  vi.spyOn(FleetMaintenanceVisitModel, 'countDocuments').mockImplementation(((f: unknown) => {
    counted.push(f);
    return { exec: async () => 0 };
  }) as unknown as typeof FleetMaintenanceVisitModel.countDocuments);
  // The list's page itself — empty; the COUNT filter beside it is what these specs compare.
  vi.spyOn(FleetMaintenanceVisitModel, 'find').mockImplementation((() => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: () => chain,
      exec: async () => [],
    };
    return chain;
  }) as unknown as typeof FleetMaintenanceVisitModel.find);
  // The registry: codes resolve through `list` (the screen's own way), the set through its resolvers.
  vi.spyOn(fleetVehicleRepository, 'list').mockImplementation((async () => ({
    items: [{ _id: CAR1 }, { _id: CAR2 }],
    meta: { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 },
  })) as unknown as typeof fleetVehicleRepository.list);
  vi.spyOn(fleetVehicleRepository, 'idsWithTypes').mockResolvedValue([
    String(CAR1),
    String(CAR_GONE),
  ]);
  vi.spyOn(fleetVehicleRepository, 'idsWithOperations').mockResolvedValue([
    String(CAR1),
    String(CAR2),
    String(CAR_GONE),
  ]);
  vi.spyOn(fleetVehicleRepository, 'idsInBranches').mockResolvedValue([
    String(CAR1),
    String(CAR3),
    String(CAR_GONE),
  ]);
  vi.spyOn(fleetVehicleRepository, 'codesByIds').mockImplementation(
    async (ids: readonly string[]) =>
      new Map(ids.flatMap((id) => (CARS.has(id) ? [[id, CARS.get(id)?.code ?? '']] : []))),
  );
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation((async (
    ids: readonly string[],
  ) => ids.flatMap((id) => (CARS.has(id) ? [CARS.get(id)] : []))) as never);
  vi.spyOn(fleetCatalogItemRepository, 'namesByIds').mockImplementation(
    async (ids: readonly string[]) =>
      new Map(ids.flatMap((id) => (NAMES.has(id) ? [[id, NAMES.get(id) as LocalizedString]] : []))),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The filter `/fleet/maintenance` counts its `totalItems` with, for this query. */
const listCountFilter = async (raw: Record<string, unknown>): Promise<unknown> => {
  await fleetMaintenanceService.list(parse(raw));
  expect(counted).toHaveLength(1);
  const filter = counted[0];
  counted = [];
  return filter;
};

const matchOf = (pipeline: unknown[] | undefined): unknown =>
  (pipeline?.[0] as { $match?: unknown } | undefined)?.$match;

const QUERIES: Record<string, Record<string, unknown>> = {
  'the period alone': { from: '2026-10-01', to: '2026-10-31' },
  'period + operation + branch': {
    from: '2026-10-01',
    to: '2026-10-31',
    operationIds: O1,
    branchIds: B1,
  },
  'period + type + codes': {
    from: '2026-10-01',
    to: '2026-10-31',
    typeIds: T1,
    vehicleCodes: '201,B-77',
  },
  'codes alone (the old book’s code still matches)': { vehicleCodes: '201,B-77' },
  'every bar control': {
    from: '2026-10-01',
    to: '2026-10-31',
    workTypeIds: String(WT_OIL),
    workshopIds: String(WS_A),
    open: 'false',
    outTo: '2026-11-01',
    driverEmployeeIds: String(oid()),
  },
};

describe('visitBreakdown — the list’s own filter (R-18)', () => {
  beforeEach(() => {
    facets = [{ state: [], byWorkType: [], byWorkshop: [], byVehicle: [] }];
  });

  for (const [name, raw] of Object.entries(QUERIES)) {
    it(`matches exactly the rows /fleet/maintenance counts — ${name}`, async () => {
      const listed = await listCountFilter(raw);
      await fleetMaintenanceService.visitBreakdown(filterPart(parse(raw)));
      expect(aggregates).toHaveLength(1);
      expect(matchOf(aggregates[0])).toEqual(listed);
      // One `$facet` over that match — one round trip for the whole breakdown.
      expect(aggregates[0]).toHaveLength(2);
      expect(aggregates[0]?.[1]).toHaveProperty('$facet');
    });
  }

  it('the type narrows like the operation — and drops the old book’s typed code', async () => {
    const listed = (await listCountFilter({ typeIds: T1, vehicleCodes: '201,B-77' })) as {
      $and: unknown[];
    };
    const text = JSON.stringify(listed);
    // CAR1 is the only car that is both one of the codes and of the type.
    expect(text).toContain(String(CAR1));
    expect(text).not.toContain(String(CAR2));
    expect(text).not.toContain('B-77');
    expect(fleetVehicleRepository.idsWithTypes).toHaveBeenCalledWith([T1]);
  });

  it('a type nobody has narrows to NOTHING, not to every visit', async () => {
    vi.mocked(fleetVehicleRepository.idsWithTypes).mockResolvedValueOnce([]);
    const listed = JSON.stringify(await listCountFilter({ typeIds: T1 }));
    expect(listed).toContain('"$in":[]');
  });
});

describe('visitBreakdown — the figures (R-17, R-18, R-26)', () => {
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  beforeEach(() => {
    facets = [
      {
        state: [{ count: 12, open: 3, unregistered: 1 }],
        byWorkType: [
          { _id: WT_BRAKES, count: 4 },
          { _id: WT_OIL, count: 4 },
          { _id: WT_TYRES, count: 4 },
        ],
        byWorkshop: [
          { _id: WS_B, count: 6 },
          { _id: WS_A, count: 6 },
        ],
        byVehicle: [
          { _id: { vehicleId: CAR3, vehicleCode: null }, visits: 2, lastInDate: day('2026-10-20') },
          { _id: { vehicleId: CAR2, vehicleCode: null }, visits: 3, lastInDate: day('2026-10-05') },
          { _id: { vehicleId: CAR1, vehicleCode: null }, visits: 3, lastInDate: day('2026-10-09') },
          {
            _id: { vehicleId: null, vehicleCode: 'B-77' },
            visits: 1,
            lastInDate: day('2026-10-02'),
          },
          {
            _id: { vehicleId: CAR_GONE, vehicleCode: null },
            visits: 2,
            lastInDate: day('2026-10-20'),
          },
          { _id: { vehicleId: CAR4, vehicleCode: null }, visits: 2, lastInDate: day('2026-10-20') },
          {
            _id: { vehicleId: oid(), vehicleCode: null },
            visits: 1,
            lastInDate: day('2026-10-01'),
          },
        ],
      },
    ];
  });

  const breakdown = (raw: Record<string, unknown> = {}): Promise<FleetDashboardPeriodVisitsDto> =>
    fleetMaintenanceService.visitBreakdown(filterPart(parse(raw)));

  it('count, and the state NOW: closed + open = count', async () => {
    const out = await breakdown({ from: '2026-10-01', to: '2026-10-31' });
    expect(out.count).toBe(12);
    expect(out.open).toBe(3);
    expect(out.closed).toBe(9);
    expect(out.closed + out.open).toBe(out.count);
  });

  it('Σ byWorkType = Σ byWorkshop = count', async () => {
    const out = await breakdown();
    const sum = (rows: { count: number }[]) => rows.reduce((s, row) => s + row.count, 0);
    expect(sum(out.byWorkType)).toBe(out.count);
    expect(sum(out.byWorkshop)).toBe(out.count);
  });

  it('bars: count desc, then the name (Arabic order), and a nameless item last', async () => {
    const out = await breakdown();
    expect(out.byWorkType.map((row) => row.name?.ar)).toEqual(['إطارات', 'تغيير زيت', 'فرامل']);
    expect(out.byWorkshop).toEqual([
      { id: String(WS_A), name: { ar: 'ورشة التوكيل', en: 'Dealer' }, count: 6 },
      { id: String(WS_B), name: null, count: 6 },
    ]);
  });

  it('most-visited: visits desc, then the latest check-in desc, then the code — at most five', async () => {
    const out = await breakdown();
    expect(out.topVehicles).toHaveLength(FLEET_DASHBOARD_RANK_ROWS);
    // 203 and 205 tie on visits and day: the fleet's code order decides. The deleted car (204, the
    // same two visits) is not ranked — its row would open an empty register.
    expect(out.topVehicles.map((row) => row.code)).toEqual(['201', '202', '203', '205', 'B-77']);
    expect(out.topVehicles[0]).toEqual({
      vehicleId: String(CAR1),
      code: '201',
      visits: 3,
      lastInDate: '2026-10-09',
    });
    // A visit from the old book is ranked under the code the book wrote, with no car.
    expect(out.topVehicles[4]).toEqual({
      vehicleId: null,
      code: 'B-77',
      visits: 1,
      lastInDate: '2026-10-02',
    });
  });

  it('«سيارات غير مسجّلة» only when no vehicle clause applies (R-13)', async () => {
    expect((await breakdown({ from: '2026-10-01' })).unregistered).toBe(1);
    expect((await breakdown({ operationIds: O1 })).unregistered).toBeNull();
    expect((await breakdown({ typeIds: T1 })).unregistered).toBeNull();
    expect((await breakdown({ vehicleCodes: '201' })).unregistered).toBeNull();
    expect((await breakdown({ vehicleId: String(CAR1) })).unregistered).toBeNull();
  });

  it('carries no money: visits have no amount (R-26)', async () => {
    expect(Object.keys(await breakdown()).sort()).toEqual(
      ['byWorkType', 'byWorkshop', 'closed', 'count', 'open', 'topVehicles', 'unregistered'].sort(),
    );
  });

  it('an empty period is zeros, not an error', async () => {
    facets = [{ state: [], byWorkType: [], byWorkshop: [], byVehicle: [] }];
    expect(await breakdown({ from: '2026-10-01' })).toEqual({
      count: 0,
      closed: 0,
      open: 0,
      byWorkType: [],
      byWorkshop: [],
      topVehicles: [],
      unregistered: 0,
    });
  });

  it('a field ABSENT on an old row counts as null, as the list’s `outDate: null` does', async () => {
    await breakdown();
    // The `$facet` reads `$ifNull`, never a bare `$eq: ['$outDate', null]` (missing ≠ null there).
    const facet = (aggregates[0]?.[1] as { $facet: Record<string, unknown> }).$facet;
    const state = JSON.stringify(facet['state']);
    expect(state).toContain('{"$eq":[{"$ifNull":["$outDate",null]},null]}');
    expect(state).toContain('{"$eq":[{"$ifNull":["$vehicleId",null]},null]}');
    expect(JSON.stringify(facet)).not.toContain('{"$eq":["$outDate",null]}');
  });
});

describe('openNow — «في الورشة الآن» (R-09)', () => {
  it('is the list with state=open, over the same vehicle filter', async () => {
    facets = [{ total: [], oldest: [], cars: [] }];
    const listed = await listCountFilter({ open: 'true', branchIds: B1 });
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: { branchIds: [B1] } });
    expect(matchOf(aggregates[0])).toEqual(listed);
  });

  it('splits by the car’s status now; a deleted car or a book row is in neither part', async () => {
    facets = [
      {
        total: [{ n: 5 }],
        oldest: [{ vehicleId: CAR2, vehicleCode: null, inDate: new Date('2026-10-25T00:00:00Z') }],
        cars: [
          { _id: CAR1, visits: 1 },
          { _id: CAR2, visits: 1 },
          { _id: CAR3, visits: 1 },
          { _id: CAR_GONE, visits: 1 },
        ],
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([
      { _id: CAR1, code: '201', status: 'active', isDeleted: false },
      { _id: CAR2, code: '202', status: 'outOfService', isDeleted: false },
      { _id: CAR3, code: '203', status: 'active', isDeleted: false },
      { _id: CAR_GONE, code: '204', status: 'active', isDeleted: true },
    ] as never);
    const out = await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(out).toEqual({
      open: 5,
      openActive: 2,
      openOutOfService: 1,
      oldest: { vehicleId: String(CAR2), code: '202', inDate: '2026-10-25', days: 7 },
    });
  });

  it('the oldest from the old book is named by the book’s code; checked in today = 0 days', async () => {
    facets = [
      {
        total: [{ n: 1 }],
        oldest: [
          { vehicleId: null, vehicleCode: 'B-77', inDate: new Date('2026-11-01T00:00:00Z') },
        ],
        cars: [],
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    expect(await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} })).toEqual({
      open: 1,
      openActive: 0,
      openOutOfService: 0,
      oldest: { vehicleId: null, code: 'B-77', inDate: '2026-11-01', days: 0 },
    });
  });

  it('nothing open: zeros and no oldest', async () => {
    facets = [{ total: [], oldest: [], cars: [] }];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    expect(await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} })).toEqual({
      open: 0,
      openActive: 0,
      openOutOfService: 0,
      oldest: null,
    });
  });

  it('sorts the oldest by check-in day, the earlier-recorded first (a total order)', async () => {
    facets = [{ total: [], oldest: [], cars: [] }];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    const facet = (aggregates[0]?.[1] as { $facet: { oldest: unknown[] } }).$facet;
    expect(facet.oldest[0]).toEqual({ $sort: { inDate: 1, _id: 1 } });
  });
});

describe('recentWritten — the recent workshop records (R-12)', () => {
  const visit = (over: Record<string, unknown>) => ({
    _id: oid(),
    vehicleId: CAR1,
    vehicleCode: null,
    inDate: new Date('2026-10-20T00:00:00Z'),
    outDate: null,
    workshopId: WS_A,
    workTypeId: WT_OIL,
    createdAt: new Date('2026-10-20T08:15:00Z'),
    ...over,
  });

  it('the list’s filter AND a business date on or after the window’s first day', async () => {
    facets = [];
    const listed = await listCountFilter({ branchIds: B1 });
    await fleetMaintenanceService.recentWritten({
      sinceYmd: '2026-10-03',
      limit: 8,
      filter: { branchIds: [B1] },
    });
    const since = new Date('2026-10-03T00:00:00.000Z');
    const pipeline = aggregates[0] ?? [];
    expect(pipeline[0]).toEqual({
      $match: {
        $and: [
          { isDeleted: false },
          {
            $and: [
              (listed as { $and: unknown[] }).$and[1],
              { $or: [{ inDate: { $gte: since } }, { outDate: { $gte: since } }] },
            ],
          },
        ],
      },
    });
    // The most recently WRITTEN first, `_id` breaking the tie; a deleted car's visit dropped
    // BEFORE the limit, so the list still holds `limit` rows when there are that many.
    expect(pipeline[1]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
    expect(pipeline[2]).toMatchObject({
      $lookup: { from: 'fleet_vehicles', localField: 'vehicleId', foreignField: '_id' },
    });
    expect(pipeline[3]).toEqual({ $match: { 'registryCar.isDeleted': { $ne: true } } });
    expect(pipeline[4]).toEqual({ $limit: 8 });
  });

  it('a row: the later of the two days, the recording instant, the names', async () => {
    facets = [
      visit({ outDate: new Date('2026-10-22T00:00:00Z') }),
      visit({ vehicleId: null, vehicleCode: 'B-77', workshopId: WS_B }),
    ];
    const rows = await fleetMaintenanceService.recentWritten({
      sinceYmd: '2026-10-03',
      limit: 8,
      filter: {},
    });
    expect(rows[0]).toMatchObject({
      vehicleId: String(CAR1),
      code: '201',
      date: '2026-10-22',
      recordedAt: '2026-10-20T08:15:00.000Z',
      workshop: { ar: 'ورشة التوكيل', en: 'Dealer' },
      workType: { ar: 'تغيير زيت', en: 'Oil' },
      open: false,
    });
    expect(rows[1]).toMatchObject({
      vehicleId: null,
      code: 'B-77',
      date: '2026-10-20',
      workshop: null,
      open: true,
    });
  });

  it('asks nothing for no rows — `$limit: 0` is refused by Mongo', async () => {
    expect(
      await fleetMaintenanceService.recentWritten({ sinceYmd: '2026-10-03', limit: 0, filter: {} }),
    ).toEqual([]);
    expect(aggregates).toEqual([]);
  });
});
