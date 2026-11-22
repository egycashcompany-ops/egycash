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
import { fleetMaintenanceRepository } from './maintenance.repository';
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

describe('exitBreakdown — the list’s own filter (R-18)', () => {
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

describe('the check-in day count is retired (the dashboard’s `period` tab)', () => {
  it('the module serves no visits-by-check-in read any more: no `visitStates`, no `stateCounts`', () => {
    expect('visitStates' in fleetMaintenanceService).toBe(false);
    expect('stateCounts' in fleetMaintenanceRepository).toBe(false);
    // The exit-day breakdown «الصيانة والورش» and the overview read stays.
    expect(typeof fleetMaintenanceService.exitBreakdown).toBe('function');
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

  it('an old-book exit is not in the registry cars’ facet (it is grouped by its code apart)', async () => {
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

describe('exitBreakdown — the old book folded into the live car of its code (D20)', () => {
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  /** An id that sorts after every id made so far — a visit recorded later. */
  const later = (): Types.ObjectId => new Types.ObjectId();
  const [V_CAR1_LAST, V_CAR2_LAST] = [oid(), oid()];
  beforeEach(() => {
    vi.spyOn(fleetVehicleTypeRepository, 'listAll').mockResolvedValue([]);
    // The list's code match: the LIVE cars carrying a code, whitespace and Latin case aside.
    vi.mocked(fleetVehicleRepository.liveIdsByCodes).mockImplementation(
      async (codes: readonly string[]) =>
        [...CARS.values()]
          .filter(
            (car) =>
              !car.isDeleted && codes.some((code) => code.trim().replace(/\s+/g, ' ') === car.code),
          )
          .map((car) => String(car._id)),
    );
  });

  const exits = (byBook: unknown[], raw: Record<string, unknown> = {}) => {
    facets = [
      {
        state: [{ count: 14, open: 0, unregistered: 6, staySum: 14 }],
        byWorkType: [],
        byWorkshop: [],
        byVehicle: [
          {
            _id: CAR1,
            visits: 3,
            lastInDate: day('2026-10-09'),
            lastWorkTypeId: WT_BRAKES,
            lastVisitId: V_CAR1_LAST,
          },
          {
            _id: CAR2,
            visits: 3,
            lastInDate: day('2026-10-20'),
            lastWorkTypeId: WT_OIL,
            lastVisitId: V_CAR2_LAST,
          },
          {
            _id: CAR_GONE,
            visits: 2,
            lastInDate: day('2026-10-20'),
            lastWorkTypeId: WT_OIL,
            lastVisitId: oid(),
          },
        ],
        byBook,
      },
    ];
    return fleetMaintenanceService.exitBreakdown(
      filterPart(parse({ outFrom: '2026-10-01', outTo: '2026-10-31', ...raw })),
    );
  };
  const book = (
    code: string,
    visits: number,
    lastIn: string,
    over: Record<string, unknown> = {},
  ) => ({
    _id: code,
    visits,
    lastInDate: day(lastIn),
    lastWorkTypeId: WT_TYRES,
    lastVisitId: later(),
    ...over,
  });

  it('a book visit under a live car’s code joins that car: its exits, its later check-in, its work type', async () => {
    // MT-3: «194» said 2 while its «فتح» (vehicleCodes=194) listed 3 — the car’s 2 and the book’s 1.
    const out = await exits([book('201', 2, '2026-10-12')]);
    expect(out.topVehicles[0]).toEqual({
      vehicleId: String(CAR1),
      code: '201',
      typeName: null,
      visits: 5,
      lastInDate: '2026-10-12',
      lastWorkType: { ar: 'إطارات', en: 'Tyres' },
    });
    // Folded visits are the car’s now, no longer «غير مسجّلة»: 6 − 2.
    expect(out.unregistered).toBe(4);
    // One read of the live registry by the book’s codes — the list’s own code match.
    expect(fleetVehicleRepository.liveIdsByCodes).toHaveBeenCalledTimes(1);
    expect(fleetVehicleRepository.liveIdsByCodes).toHaveBeenCalledWith(['201']);
  });

  it('the code matches as the list matches it — whitespace aside — and the earlier book check-in keeps the car’s', async () => {
    const out = await exits([book(' 202 ', 1, '2026-10-02')]);
    expect(out.topVehicles.find((row) => row.code === '202')).toMatchObject({
      visits: 4,
      lastInDate: '2026-10-20',
      lastWorkType: { ar: 'تغيير زيت', en: 'Oil' },
    });
    expect(out.unregistered).toBe(5);
  });

  it('on the same check-in day the later recorded visit names the last work type', async () => {
    // The car’s visit was recorded before the book’s (a later id): the book’s work type.
    let out = await exits([book('202', 1, '2026-10-20')]);
    expect(out.topVehicles.find((row) => row.code === '202')).toMatchObject({
      visits: 4,
      lastInDate: '2026-10-20',
      lastWorkType: { ar: 'إطارات', en: 'Tyres' },
    });
    // A book visit recorded BEFORE the car’s (an older id): the car’s own work type stays.
    out = await exits([
      book('202', 1, '2026-10-20', { lastVisitId: new Types.ObjectId('000000000000000000000001') }),
    ]);
    expect(out.topVehicles.find((row) => row.code === '202')).toMatchObject({
      visits: 4,
      lastWorkType: { ar: 'تغيير زيت', en: 'Oil' },
    });
  });

  it('a live car whose only exits are the book’s is ranked by them', async () => {
    const out = await exits([book('205', 4, '2026-10-25')]);
    expect(out.topVehicles[0]).toEqual({
      vehicleId: String(CAR4),
      code: '205',
      typeName: null,
      visits: 4,
      lastInDate: '2026-10-25',
      lastWorkType: { ar: 'إطارات', en: 'Tyres' },
    });
    expect(out.unregistered).toBe(2);
  });

  it('a code no live car carries — a deleted car’s, or none — stays «غير مسجّلة», never ranked', async () => {
    const out = await exits([book('204', 1, '2026-10-25'), book('B-77', 2, '2026-10-26')]);
    expect(out.topVehicles.map((row) => [row.code, row.visits])).toEqual([
      ['202', 3],
      ['201', 3],
    ]);
    expect(out.unregistered).toBe(6);
  });

  it('a type, operation or branch narrows the old book out: nothing is folded, no extra read', async () => {
    for (const raw of [{ operationIds: O1 }, { typeIds: T1 }, { branchIds: B1 }]) {
      vi.mocked(fleetVehicleRepository.liveIdsByCodes).mockClear();
      const out = await exits([book('201', 2, '2026-10-12')], raw);
      expect(out.topVehicles.find((row) => row.code === '201')?.visits, JSON.stringify(raw)).toBe(
        3,
      );
      expect(out.unregistered).toBeNull();
    }
  });

  it('typed codes keep the old book (the list’s `byVehicleOrBookCode`): it is folded there too', async () => {
    const out = await exits([book('201', 2, '2026-10-12')], { vehicleCodes: '201' });
    expect(out.topVehicles.find((row) => row.code === '201')?.visits).toBe(5);
    // A vehicle clause applies: «غير مسجّلة» is not reported (R-13).
    expect(out.unregistered).toBeNull();
  });

  it('no book visit in the view: the registry is not read again', async () => {
    vi.mocked(fleetVehicleRepository.liveIdsByCodes).mockClear();
    const out = await exits([]);
    expect(out.unregistered).toBe(6);
    expect(fleetVehicleRepository.liveIdsByCodes).not.toHaveBeenCalled();
  });

  it('the facet groups the old book’s rows by the code it wrote, in the same `$facet`', async () => {
    await exits([]);
    expect(aggregates).toHaveLength(1);
    const facet = (aggregates[0]?.[1] as { $facet: Record<string, unknown[]> }).$facet;
    expect(facet['byBook']?.[0]).toEqual({
      $match: { vehicleId: null, vehicleCode: { $type: 'string' } },
    });
    const group = JSON.stringify(facet['byBook']?.[1]);
    expect(group).toContain('"_id":"$vehicleCode"');
    expect(group).toContain(
      '"lastVisitId":{"$top":{"sortBy":{"inDate":-1,"_id":-1},"output":"$_id"}}',
    );
    // The registry cars’ facet carries the same tie-break id.
    expect(JSON.stringify(facet['byVehicle']?.[1])).toContain(
      '"lastVisitId":{"$top":{"sortBy":{"inDate":-1,"_id":-1},"output":"$_id"}}',
    );
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

  it('is the list with state=open&to=<today>, over the same vehicle filter (D07)', async () => {
    facets = [{ total: [], longest: [], cars: [] }];
    const listed = await listCountFilter({ open: 'true', to: '2026-11-01', branchIds: B1 });
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: { branchIds: [B1] } });
    expect(matchOf(aggregates[0])).toEqual(listed);
    // The check-in day is bounded by the end of Cairo today: a visit recorded for tomorrow is not
    // in the workshop yet (the roster's covering-day rule), so no stay reads «منذ -1 يومًا».
    expect(JSON.stringify(matchOf(aggregates[0]))).toContain(
      '"inDate":{"$lt":"2026-11-02T00:00:00.000Z"}',
    );
  });

  it('the company view is bounded by the same day — the list with to=<today>, no vehicle clause', async () => {
    facets = [{ total: [], longest: [], cars: [] }];
    const listed = await listCountFilter({ open: 'true', to: '2026-11-01' });
    await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(matchOf(aggregates[0])).toEqual(listed);
    // …and NOT the unbounded open list any more.
    expect(matchOf(aggregates[0])).not.toEqual(await listCountFilter({ open: 'true' }));
  });

  it('splits by the car’s status now into four parts that add up to `open` (D06)', async () => {
    const visit = oid();
    const CAR_DISPOSED = oid();
    const CAR_MISSING = oid();
    facets = [
      {
        // 2 old-book visits (no `vehicleId`, so outside `cars`) + 7 registry-car visits.
        total: [{ n: 9 }],
        longest: [stay({ _id: visit, vehicleId: CAR2 })],
        cars: [
          { _id: CAR1, visits: 1 },
          { _id: CAR2, visits: 1 },
          { _id: CAR3, visits: 1 },
          { _id: CAR_GONE, visits: 1 },
          { _id: CAR4, visits: 1 },
          { _id: CAR_DISPOSED, visits: 1 },
          // A car the registry does not answer for at all.
          { _id: CAR_MISSING, visits: 1 },
        ],
      },
    ];
    vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockResolvedValue([
      { _id: CAR1, code: '201', status: 'active', isDeleted: false },
      { _id: CAR2, code: '202', status: 'outOfService', isDeleted: false, typeId: T_MERC },
      { _id: CAR3, code: '203', status: 'active', isDeleted: false },
      // Soft-deleted while in the workshop: no live car — whatever status it had.
      { _id: CAR_GONE, code: '204', status: 'active', isDeleted: true },
      { _id: CAR4, code: '205', status: 'disposed', isDeleted: false },
      { _id: CAR_DISPOSED, code: '206', status: 'disposed', isDeleted: false },
    ] as never);
    const out = await fleetMaintenanceService.openNow({ today: '2026-11-01', filter: {} });
    expect(out).toEqual({
      open: 9,
      openActive: 2,
      openOutOfService: 1,
      // «مكهنة»: live cars disposed of while in the workshop.
      openDisposed: 2,
      // «بلا سيارة في السجل»: the deleted car, the missing car and the two old-book visits.
      openNoCar: 4,
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
    // 3 live active cars; the deleted car and the 5 visits outside `cars` have no live car.
    expect([out.openActive, out.openOutOfService, out.openDisposed, out.openNoCar]).toEqual([
      3, 0, 0, 6,
    ]);
    expect(out.openActive + out.openOutOfService + out.openDisposed + out.openNoCar).toBe(out.open);
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
      openDisposed: 0,
      // The old book's visit has no registry car: its own part, so the parts still add up.
      openNoCar: 1,
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
      openDisposed: 0,
      openNoCar: 0,
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
