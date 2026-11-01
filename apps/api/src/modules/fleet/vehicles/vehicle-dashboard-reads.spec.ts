// The fleet dashboard's vehicle figures are the REGISTRY LIST's own numbers (P1-03, R-27).
//
// Each read goes through the same base filter the list applies — soft delete and the reader's
// `scopeSelector(ctx, 'fleetVehicle.view')` — and, where a bar control is involved, the list's
// own `vehicleListFilter`. So this drives the real repository against stubbed model calls and
// compares the filter each dashboard read sends with the one the LIST sends for the same link:
// equal filters are equal numbers, under any grant, by construction.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ListFleetVehiclesQuery } from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { FleetVehicleModel } from './vehicle.model';
import {
  fleetVehicleRepository,
  intersectVehicleIds,
  vehicleListFilter,
  vehicleSetPart,
} from './vehicle.repository';

const BRANCH = new Types.ObjectId().toString();
const USER = new Types.ObjectId().toString();
const branchScope: ScopeSelector = {
  scope: 'branch',
  userId: USER,
  branchId: BRANCH,
  departmentId: null,
  sectionId: null,
} as ScopeSelector;
const ownScope: ScopeSelector = { ...branchScope, scope: 'own' } as ScopeSelector;
const orgScope: ScopeSelector = { ...branchScope, scope: 'organization' } as ScopeSelector;

const json = (value: unknown): string => JSON.stringify(value);

/** A `find()` chain that records what it was asked and answers `rows`. */
const findChain = (rows: unknown[]) => {
  const seen: { filter?: unknown; sort?: unknown; limit?: number; select?: unknown } = {};
  const chain = {
    select: (s: unknown) => ((seen.select = s), chain),
    sort: (s: unknown) => ((seen.sort = s), chain),
    limit: (n: number) => ((seen.limit = n), chain),
    skip: () => chain,
    lean: () => chain,
    exec: async () => rows,
  };
  const spy = vi.spyOn(FleetVehicleModel, 'find').mockImplementation(((filter: unknown) => {
    seen.filter = filter;
    return chain;
  }) as unknown as typeof FleetVehicleModel.find);
  return { seen, spy };
};

/** What the LIST counts with — the `countDocuments` filter `listVehicles` sends for a query. */
const listCountFilter = async (
  query: Partial<ListFleetVehiclesQuery>,
  scope: ScopeSelector,
): Promise<unknown> => {
  let filter: unknown;
  vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation(((f: unknown) => {
    filter = f;
    return { exec: async () => 0 };
  }) as unknown as typeof FleetVehicleModel.countDocuments);
  findChain([]);
  await fleetVehicleRepository.listVehicles({
    filter: vehicleListFilter(query),
    page: 1,
    pageSize: 25,
    scope,
  });
  vi.restoreAllMocks();
  return filter;
};

afterEach(() => vi.restoreAllMocks());

describe('countListed — the list total, without the page', () => {
  const last = new Date('2026-11-01T23:59:59.999Z');
  const cases: [string, Partial<ListFleetVehiclesQuery>][] = [
    ['status only', { status: ['active'] }],
    ['the expired window (T1.2)', { status: ['active'], licenseExpiresBefore: last }],
    [
      'a window with both bounds (T4.2)',
      {
        status: ['active'],
        licenseExpiresFrom: new Date('2026-11-02T00:00:00.000Z'),
        licenseExpiresBefore: new Date('2026-12-01T23:59:59.999Z'),
      },
    ],
    [
      'a type × branch cell (T3.1)',
      { status: ['active'], typeId: [BRANCH], branchId: [new Types.ObjectId().toString()] },
    ],
  ];

  for (const [name, query] of cases) {
    for (const scope of [branchScope, ownScope, orgScope]) {
      it(`${name}, ${scope.scope} scope: the same filter the list counts with`, async () => {
        const expected = await listCountFilter(query, scope);
        let sent: unknown;
        vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation(((f: unknown) => {
          sent = f;
          return { exec: async () => 7 };
        }) as unknown as typeof FleetVehicleModel.countDocuments);
        expect(await fleetVehicleRepository.countListed(query, scope)).toBe(7);
        expect(json(sent)).toBe(json(expected));
      });
    }
  }

  it('counts live cars only — the soft-delete gate is on every read', async () => {
    let sent: unknown;
    vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation(((f: unknown) => {
      sent = f;
      return { exec: async () => 0 };
    }) as unknown as typeof FleetVehicleModel.countDocuments);
    await fleetVehicleRepository.countListed({}, orgScope);
    expect(json(sent)).toContain('"isDeleted":false');
  });
});

describe('statusCounts — T2.1/T2.2, one $group in the reader scope', () => {
  it('matches what the list matches and names every status', async () => {
    let pipeline: Record<string, unknown>[] = [];
    vi.spyOn(FleetVehicleModel, 'aggregate').mockImplementation(((sent: never[]) => {
      pipeline = sent;
      return {
        exec: async () => [
          { _id: 'active', count: 5 },
          { _id: 'disposed', count: 1 },
        ],
      };
    }) as unknown as typeof FleetVehicleModel.aggregate);
    const counts = await fleetVehicleRepository.statusCounts(branchScope);
    // A status no car is in is a zero, not a missing key.
    expect(counts).toEqual({ active: 5, outOfService: 0, disposed: 1 });
    const match = json(pipeline[0]?.['$match']);
    expect(match).toContain('"isDeleted":false');
    expect(match, 'the branch grant narrows it as it narrows the list').toContain(BRANCH);
  });
});

describe('outOfServiceList — T2.2', () => {
  it('lists the cars out of service in the fleet code order, reasons as written', async () => {
    const { seen } = findChain([
      { _id: new Types.ObjectId(), code: '61', statusReason: 'حادث' },
      { _id: new Types.ObjectId(), code: '150', statusReason: null },
      { _id: new Types.ObjectId(), code: 'ملاكي', statusReason: '  انتظار قطع  ' },
      { _id: new Types.ObjectId(), code: '213' },
    ]);
    const rows = await fleetVehicleRepository.outOfServiceList(branchScope);
    // The working fleet first (150 up), then the cars named in words, then «الملاكى» below 150.
    expect(rows.map((row) => row.code)).toEqual(['150', '213', 'ملاكي', '61']);
    expect(rows.map((row) => row.reason)).toEqual([null, null, '  انتظار قطع  ', 'حادث']);
    expect(json(seen.filter)).toContain('"status":"outOfService"');
    expect(json(seen.filter)).toContain(BRANCH);
  });
});

describe('nearestLicences — T4.4', () => {
  it('reads active cars up to the LAST instant of the day, the longest-expired first', async () => {
    const expires = new Date('2026-10-09T00:00:00.000Z');
    const id = new Types.ObjectId();
    const { seen } = findChain([{ _id: id, code: '249', licenseExpiresAt: expires }]);
    vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation((() => ({
      exec: async () => 8,
    })) as unknown as typeof FleetVehicleModel.countDocuments);
    const out = await fleetVehicleRepository.nearestLicences(branchScope, '2026-12-31', 6);
    expect(out).toEqual({
      rows: [{ vehicleId: String(id), code: '249', expiresAt: expires.toISOString() }],
      total: 8,
    });
    const filter = json(seen.filter);
    expect(filter).toContain('"status":"active"');
    expect(filter).toContain('"$lte":"2026-12-31T23:59:59.999Z"');
    expect(filter).toContain(BRANCH);
    expect(seen.sort).toEqual({ licenseExpiresAt: 1, _id: 1 });
    expect(seen.limit).toBe(6);
  });

  it('a request for no rows asks only for the count (Mongo reads limit(0) as «all»)', async () => {
    const { spy } = findChain([]);
    vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation((() => ({
      exec: async () => 3,
    })) as unknown as typeof FleetVehicleModel.countDocuments);
    expect(await fleetVehicleRepository.nearestLicences(orgScope, '2026-12-31', 0)).toEqual({
      rows: [],
      total: 3,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('activeByTypeAndBranch — T3.1, moved from the old dashboard repository', () => {
  it('groups the ACTIVE cars of the reader scope, a car with no branch under null', async () => {
    const type = new Types.ObjectId();
    const branch = new Types.ObjectId();
    let pipeline: Record<string, unknown>[] = [];
    vi.spyOn(FleetVehicleModel, 'aggregate').mockImplementation(((sent: never[]) => {
      pipeline = sent;
      return {
        exec: async () => [
          { _id: { typeId: type, branchId: branch }, count: 4 },
          { _id: { typeId: type, branchId: null }, count: 1 },
        ],
      };
    }) as unknown as typeof FleetVehicleModel.aggregate);
    expect(await fleetVehicleRepository.activeByTypeAndBranch(branchScope)).toEqual([
      { typeId: String(type), branchId: String(branch), count: 4 },
      { typeId: String(type), branchId: null, count: 1 },
    ]);
    const match = json(pipeline[0]?.['$match']);
    expect(match).toContain('"status":"active"');
    expect(match).toContain('"isDeleted":false');
    expect(match).toContain(BRANCH);
  });
});

describe('idsWithTypes — the type twin of idsWithOperations', () => {
  it('asks every car of these types, deleted ones INCLUDED', async () => {
    let asked: unknown;
    vi.spyOn(FleetVehicleModel, 'distinct').mockImplementation(((field: string, f: unknown) => {
      asked = { field, f };
      return { exec: async () => [new Types.ObjectId('64b000000000000000000001')] };
    }) as unknown as typeof FleetVehicleModel.distinct);
    const type = new Types.ObjectId().toString();
    expect(await fleetVehicleRepository.idsWithTypes([type])).toEqual(['64b000000000000000000001']);
    expect(json(asked)).toContain(type);
    expect(json(asked), 'no soft-delete clause: their history is still theirs').not.toContain(
      'isDeleted',
    );
  });

  it('an empty list asks nothing', async () => {
    const spy = vi.spyOn(FleetVehicleModel, 'distinct');
    expect(await fleetVehicleRepository.idsWithTypes([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('intersectVehicleIds / vehicleSetPart — how a screen combines its codes with the set', () => {
  it('undefined is «not asked» and gives way; [] is an answer and stays empty', () => {
    expect(intersectVehicleIds(undefined, undefined)).toBeUndefined();
    expect(intersectVehicleIds(['a', 'b'], undefined)).toEqual(['a', 'b']);
    expect(intersectVehicleIds(undefined, ['b'])).toEqual(['b']);
    expect(intersectVehicleIds(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
    expect(intersectVehicleIds([], ['a'])).toEqual([]);
    expect(intersectVehicleIds(['a'], [])).toEqual([]);
  });

  it('keeps only the set half, and only the keys that were asked', () => {
    expect(vehicleSetPart({})).toEqual({});
    expect(
      vehicleSetPart({ vehicleCodes: ['150'], typeIds: ['t'], operationIds: undefined }),
    ).toEqual({ typeIds: ['t'] });
    expect(vehicleSetPart({ operationIds: ['o'], branchIds: ['b'] })).toEqual({
      operationIds: ['o'],
      branchIds: ['b'],
    });
  });
});
