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
  FLEET_DASHBOARD_WORKSHOP_ROWS,
  ListFleetMaintenanceQuerySchema,
  type ListFleetMaintenanceQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { FleetMaintenanceVisitModel } from './maintenance.model';
import { fleetMaintenanceService, type MaintenanceFilterQuery } from './maintenance.service';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';

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
  // The registry: codes resolve through `liveIdsByCodes` (the screen's own way — the live cars,
  // whitespace and Latin case aside), the set through its resolvers.
  vi.spyOn(fleetVehicleRepository, 'liveIdsByCodes').mockResolvedValue([
    String(CAR1),
    String(CAR2),
  ]);
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

/** The same queries asked by EXIT day — what «الصيانة والورش» sends. */
const EXIT_QUERIES: Record<string, Record<string, unknown>> = {
  'the exit period alone': { outFrom: '2026-10-01', outTo: '2026-10-31' },
  'exit period + operation + branch': {
    outFrom: '2026-10-01',
    outTo: '2026-10-31',
    operationIds: O1,
    branchIds: B1,
  },
  'exit period + type + codes': {
    outFrom: '2026-10-01',
    outTo: '2026-10-31',
    typeIds: T1,
    vehicleCodes: '201,B-77',
  },
  'exit period + a bar (work type) + a car': {
    outFrom: '2026-10-01',
    outTo: '2026-10-31',
    workTypeIds: String(WT_OIL),
    vehicleCodes: '201',
  },
};

const EMPTY_BREAKDOWN = [{ state: [], byWorkType: [], byWorkshop: [], byVehicle: [] }];

describe('exitBreakdown / visitStates — the list’s own filter (R-18)', () => {
  beforeEach(() => {
    vi.spyOn(fleetVehicleTypeRepository, 'listAll').mockResolvedValue([]);
  });

  for (const [name, raw] of Object.entries({ ...QUERIES, ...EXIT_QUERIES })) {
    it(`exitBreakdown matches exactly the rows /fleet/maintenance counts — ${name}`, async () => {
      facets = EMPTY_BREAKDOWN;
      const listed = await listCountFilter(raw);
      await fleetMaintenanceService.exitBreakdown(filterPart(parse(raw)));
      expect(aggregates).toHaveLength(1);
      expect(matchOf(aggregates[0])).toEqual(listed);
      // One `$facet` over that match — one round trip for the whole breakdown.
      expect(aggregates[0]).toHaveLength(2);
      expect(aggregates[0]?.[1]).toHaveProperty('$facet');
    });

    it(`visitStates matches exactly the rows /fleet/maintenance counts — ${name}`, async () => {
      facets = [];
      const listed = await listCountFilter(raw);
      await fleetMaintenanceService.visitStates(filterPart(parse(raw)));
      expect(aggregates).toHaveLength(1);
      expect(matchOf(aggregates[0])).toEqual(listed);
      // ONE `$group` — the check-in figures need no facet, no names, no cars.
      expect(aggregates[0]).toHaveLength(2);
      expect(aggregates[0]?.[1]).toHaveProperty('$group');
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

  it('the exit day reads `outDate`, never the check-in day', async () => {
    facets = EMPTY_BREAKDOWN;
    await fleetMaintenanceService.exitBreakdown(
      filterPart(parse({ outFrom: '2026-10-01', outTo: '2026-10-31' })),
    );
    const match = JSON.stringify(matchOf(aggregates[0]));
    expect(match).toContain('"outDate":{"$gte":"2026-10-01T00:00:00.000Z"}');
    expect(match).toContain('"outDate":{"$lt":"2026-11-01T00:00:00.000Z"}');
    expect(match).not.toContain('"inDate"');
  });
});

describe('visitStates — «أرقام الفترة» (check-in day)', () => {
  it('count, and the state NOW: closed + open = count', async () => {
    facets = [{ count: 12, open: 3 }];
    const out = await fleetMaintenanceService.visitStates(
      filterPart(parse({ from: '2026-10-01', to: '2026-10-31' })),
    );
    expect(out).toEqual({ count: 12, closed: 9, open: 3 });
  });

  it('an empty period is zeros; an old row with no `outDate` at all is open', async () => {
    facets = [];
    expect(await fleetMaintenanceService.visitStates(filterPart(parse({})))).toEqual({
      count: 0,
      closed: 0,
      open: 0,
    });
    const group = JSON.stringify(aggregates[0]?.[1]);
    expect(group).toContain('{"$eq":[{"$ifNull":["$outDate",null]},null]}');
  });
});

describe('exitBreakdown — the figures (R-17, R-18, R-26)', () => {
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  const T_MERC = oid();
  const T_GONE = oid();
  beforeEach(() => {
    facets = [
      {
        state: [{ count: 12, open: 0, unregistered: 1, staySum: 29 }],
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
          { _id: CAR3, visits: 2, lastInDate: day('2026-10-20'), lastWorkTypeId: WT_OIL },
          { _id: CAR2, visits: 3, lastInDate: day('2026-10-05'), lastWorkTypeId: WT_TYRES },
          { _id: CAR1, visits: 3, lastInDate: day('2026-10-09'), lastWorkTypeId: WT_BRAKES },
          { _id: CAR_GONE, visits: 2, lastInDate: day('2026-10-20'), lastWorkTypeId: WT_OIL },
          { _id: CAR4, visits: 2, lastInDate: day('2026-10-20'), lastWorkTypeId: null },
          // A car the registry no longer answers for at all: code «—», still ranked by its id.
          { _id: oid(), visits: 1, lastInDate: day('2026-10-01'), lastWorkTypeId: WS_B },
        ],
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation((async (
      ids: readonly string[],
    ) =>
      ids.flatMap((id) => {
        const car = CARS.get(id);
        if (car === undefined) return [];
        // CAR1/CAR2 are Mercedes; CAR3's make was deleted (no name); CAR4 has no make.
        const typeId =
          id === String(CAR1) || id === String(CAR2) ? T_MERC : id === String(CAR3) ? T_GONE : null;
        return [{ ...car, typeId }];
      })) as never);
    vi.spyOn(fleetVehicleTypeRepository, 'listAll').mockResolvedValue([
      { _id: T_MERC, name: { ar: 'مرسيدس', en: 'Mercedes' } },
    ] as never);
  });

  const breakdown = (raw: Record<string, unknown> = {}) =>
    fleetMaintenanceService.exitBreakdown(
      filterPart(parse({ outFrom: '2026-10-01', outTo: '2026-10-31', ...raw })),
    );

  it('count, and the mean stay over the exits to one decimal', async () => {
    const out = await breakdown();
    expect(out.count).toBe(12);
    // 29 whole days over 12 exits = 2.4166… → 2.4.
    expect(out.avgStayDays).toBe(2.4);
  });

  it('the mean rounds half up at one decimal; the same-day exit counts 0', async () => {
    facets = [
      {
        state: [{ count: 4, open: 0, unregistered: 0, staySum: 1 }],
        byWorkType: [],
        byWorkshop: [],
        byVehicle: [],
      },
    ];
    expect((await breakdown()).avgStayDays).toBe(0.3); // 0.25 → 0.3
    facets = [
      {
        state: [{ count: 3, open: 0, unregistered: 0, staySum: 0 }],
        byWorkType: [],
        byWorkshop: [],
        byVehicle: [],
      },
    ];
    expect((await breakdown()).avgStayDays).toBe(0);
  });

  it('the stay is whole days check-in → check-out over the CLOSED visits ($dateDiff, day)', async () => {
    await breakdown();
    const facet = (aggregates[0]?.[1] as { $facet: Record<string, unknown> }).$facet;
    const state = JSON.stringify(facet['state']);
    expect(state).toContain(
      '{"$dateDiff":{"startDate":"$inDate","endDate":"$outDate","unit":"day"}}',
    );
    // An open visit (none among exits, but the read never assumes it) adds no stay.
    expect(state).toContain(
      '"staySum":{"$sum":{"$cond":[{"$eq":[{"$ifNull":["$outDate",null]},null]},0,',
    );
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

  it('most-visited: exits desc, then the latest check-in desc, then the code — at most five', async () => {
    const out = await breakdown();
    expect(out.topVehicles).toHaveLength(FLEET_DASHBOARD_RANK_ROWS);
    // 203 and 205 tie on exits and day: the fleet's code order decides. The deleted car (204, the
    // same two exits) is not ranked — its row would open an empty register.
    expect(out.topVehicles.map((row) => row.code)).toEqual(['201', '202', '203', '205', '—']);
    expect(out.topVehicles[0]).toEqual({
      vehicleId: String(CAR1),
      code: '201',
      typeName: { ar: 'مرسيدس', en: 'Mercedes' },
      visits: 3,
      lastInDate: '2026-10-09',
      lastWorkType: { ar: 'فرامل', en: 'Brakes' },
    });
    // A deleted make has no name; a car with no make neither; a missing work type is null.
    expect(out.topVehicles[2]).toMatchObject({ code: '203', typeName: null });
    expect(out.topVehicles[3]).toMatchObject({ code: '205', typeName: null, lastWorkType: null });
    // An unnamed catalog id (WS_B) as the last work type reads null, never an id.
    expect(out.topVehicles[4]).toMatchObject({ lastWorkType: null });
  });

  it('an old-book exit with no registry car is never ranked (the facet groups registry cars only)', async () => {
    await breakdown();
    const facet = (aggregates[0]?.[1] as { $facet: Record<string, unknown[]> }).$facet;
    expect(facet['byVehicle']?.[0]).toEqual({ $match: { vehicleId: { $type: 'objectId' } } });
    // Its latest check-in's work type: the later recorded of two on one day.
    expect(JSON.stringify(facet['byVehicle']?.[1])).toContain(
      '"lastWorkTypeId":{"$top":{"sortBy":{"inDate":-1,"_id":-1}',
    );
  });

  it('«سيارات غير مسجّلة» only when no vehicle clause applies (R-13)', async () => {
    expect((await breakdown()).unregistered).toBe(1);
    expect((await breakdown({ operationIds: O1 })).unregistered).toBeNull();
    expect((await breakdown({ typeIds: T1 })).unregistered).toBeNull();
    expect((await breakdown({ vehicleCodes: '201' })).unregistered).toBeNull();
    expect((await breakdown({ vehicleId: String(CAR1) })).unregistered).toBeNull();
  });

  it('carries no money: visits have no amount (R-26)', async () => {
    expect(Object.keys(await breakdown()).sort()).toEqual(
      ['avgStayDays', 'byWorkType', 'byWorkshop', 'count', 'topVehicles', 'unregistered'].sort(),
    );
  });

  it('an empty period is zeros and no mean — not an error, and no make is read', async () => {
    facets = EMPTY_BREAKDOWN;
    expect(await breakdown()).toEqual({
      count: 0,
      avgStayDays: null,
      byWorkType: [],
      byWorkshop: [],
      topVehicles: [],
      unregistered: 0,
    });
    expect(fleetVehicleTypeRepository.listAll).not.toHaveBeenCalled();
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
  const T_MERC = oid();
  const stay = (over: Record<string, unknown>) => ({
    _id: oid(),
    vehicleId: null,
    vehicleCode: null,
    inDate: new Date('2026-10-25T00:00:00Z'),
    workshopId: WS_A,
    workTypeId: WT_OIL,
    ...over,
  });
  beforeEach(() => {
    vi.spyOn(fleetVehicleTypeRepository, 'listAll').mockResolvedValue([
      { _id: T_MERC, name: { ar: 'مرسيدس', en: 'Mercedes' } },
    ] as never);
  });

  it('is the list with state=open, over the same vehicle filter', async () => {
    facets = [{ total: [], longest: [], cars: [] }];
    const listed = await listCountFilter({ open: 'true', branchIds: B1 });
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: { branchIds: [B1] } });
    expect(matchOf(aggregates[0])).toEqual(listed);
  });

  it('splits by the car’s status now; a deleted car or a book row is in neither part', async () => {
    const visit = oid();
    facets = [
      {
        total: [{ n: 5 }],
        longest: [stay({ _id: visit, vehicleId: CAR2 })],
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
      { _id: CAR2, code: '202', status: 'outOfService', isDeleted: false, typeId: T_MERC },
      { _id: CAR3, code: '203', status: 'active', isDeleted: false },
      { _id: CAR_GONE, code: '204', status: 'active', isDeleted: true },
    ] as never);
    const out = await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(out).toEqual({
      open: 5,
      openActive: 2,
      openOutOfService: 1,
      oldest: {
        vehicleId: String(CAR2),
        code: '202',
        inDate: '2026-10-25',
        days: 7,
        deleted: false,
      },
      longest: [
        {
          visitId: String(visit),
          vehicleId: String(CAR2),
          code: '202',
          deleted: false,
          typeName: { ar: 'مرسيدس', en: 'Mercedes' },
          inDate: '2026-10-25',
          days: 7,
          workshop: { ar: 'ورشة التوكيل', en: 'Dealer' },
          workType: { ar: 'تغيير زيت', en: 'Oil' },
        },
      ],
    });
  });

  it('the longest stays: the facet’s order kept, `oldest` = the first, names from ONE catalog read', async () => {
    facets = [
      {
        total: [{ n: 9 }],
        longest: [
          stay({ vehicleId: CAR1, inDate: new Date('2026-10-02T00:00:00Z') }),
          stay({ vehicleCode: 'B-77', inDate: new Date('2026-10-02T00:00:00Z'), workshopId: WS_B }),
          stay({ vehicleId: CAR_GONE, inDate: new Date('2026-10-20T00:00:00Z') }),
          stay({ vehicleId: CAR3, inDate: new Date('2026-10-30T00:00:00Z'), workTypeId: null }),
          stay({ vehicleId: CAR4, inDate: new Date('2026-11-01T00:00:00Z') }),
        ],
        cars: [CAR1, CAR_GONE, CAR3, CAR4].map((_id) => ({ _id, visits: 1 })),
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation((async (
      ids: readonly string[],
    ) =>
      ids.flatMap((id) => {
        const car = CARS.get(id);
        return car === undefined ? [] : [{ ...car, status: 'active', typeId: T_MERC }];
      })) as never);
    const out = await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(out.longest.map((row) => [row.code, row.inDate, row.days, row.deleted])).toEqual([
      ['201', '2026-10-02', 30, false],
      ['B-77', '2026-10-02', 30, false],
      // CAR_GONE left the registry while in the workshop: still listed and named by its code, but
      // flagged — no live car carries that code, so the web opens the open list, not the car.
      ['204', '2026-10-20', 12, true],
      ['203', '2026-10-30', 2, false],
      ['205', '2026-11-01', 0, false],
    ]);
    expect(out.oldest).toEqual({
      vehicleId: String(CAR1),
      code: '201',
      inDate: '2026-10-02',
      days: 30,
      deleted: false,
    });
    // The old book's row has no car, so no make; an unnamed workshop and a missing work type null.
    expect(out.longest[1]).toMatchObject({ vehicleId: null, typeName: null, workshop: null });
    expect(out.longest[3]).toMatchObject({ workType: null });
    expect(out.longest.length).toBeLessThanOrEqual(out.open);
    expect(fleetCatalogItemRepository.namesByIds).toHaveBeenCalledTimes(1);
    expect(fleetVehicleTypeRepository.listAll).toHaveBeenCalledTimes(1);
  });

  it('the oldest from the old book is named by the book’s code; checked in today = 0 days', async () => {
    const visit = oid();
    facets = [
      {
        total: [{ n: 1 }],
        longest: [
          stay({
            _id: visit,
            vehicleCode: 'B-77',
            inDate: new Date('2026-11-01T00:00:00Z'),
          }),
        ],
        cars: [],
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    const out = await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(out).toMatchObject({
      open: 1,
      openActive: 0,
      openOutOfService: 0,
      oldest: { vehicleId: null, code: 'B-77', inDate: '2026-11-01', days: 0, deleted: false },
    });
    expect(out.longest).toEqual([
      {
        visitId: String(visit),
        vehicleId: null,
        code: 'B-77',
        // The old book's code finds the book's row: not a deleted car.
        deleted: false,
        typeName: null,
        inDate: '2026-11-01',
        days: 0,
        workshop: { ar: 'ورشة التوكيل', en: 'Dealer' },
        workType: { ar: 'تغيير زيت', en: 'Oil' },
      },
    ]);
    // No registry car among the stays: no make is read.
    expect(fleetVehicleTypeRepository.listAll).not.toHaveBeenCalled();
  });

  it('nothing open: zeros, no oldest, no stays — and no name is read', async () => {
    facets = [{ total: [], longest: [], cars: [] }];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    expect(await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} })).toEqual({
      open: 0,
      openActive: 0,
      openOutOfService: 0,
      oldest: null,
      longest: [],
    });
    expect(fleetCatalogItemRepository.namesByIds).not.toHaveBeenCalled();
    expect(fleetVehicleTypeRepository.listAll).not.toHaveBeenCalled();
  });

  it(`sorts the stays by check-in day, the earlier-recorded first, at most ${String(FLEET_DASHBOARD_WORKSHOP_ROWS)}`, async () => {
    facets = [{ total: [], longest: [], cars: [] }];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([]);
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    const facet = (aggregates[0]?.[1] as { $facet: { longest: unknown[] } }).$facet;
    expect(facet.longest[0]).toEqual({ $sort: { inDate: 1, _id: 1 } });
    expect(facet.longest[1]).toEqual({ $limit: FLEET_DASHBOARD_WORKSHOP_ROWS });
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
