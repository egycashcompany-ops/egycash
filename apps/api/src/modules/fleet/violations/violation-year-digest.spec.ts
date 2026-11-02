// R-24 / T5.11–T5.12 — the year's uncollected violations on the fleet dashboard.
//
// Two promises. The money is the ROLLUP's own: Σ `outstandingVehicleAmount` and Σ
// `outstandingDriverAmount` over the same `yearSums` rows `/fleet/violations/rollup?year=Y` is
// built from. And the drivers' total is shown as its exact SPLIT — attributed + «مجهول» + «اسم غير
// مربوط» — each an amount and a count, sorted by the contract's `isUnknownFleetDriver` (the list
// filter's rule), so the three add up to the total and «مجهول» is what `unknownDriver=true` lists.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetViolationModel } from './violation.model';
import { type DriverFineGroup, type ViolationYearSums } from './violation.repository';
import { assembleYearDigest } from './violation-rollup';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

const ID = (n: number): string => `64b0000000000000000000${String(n).padStart(2, '0')}`;
const CODE_IDS = [ID(1), ID(2)];
const SET_IDS = [ID(2), ID(5)];

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) =>
    f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined
      ? SET_IDS
      : undefined,
  ),
}));

const { fleetViolationService } = await import('./violation.service');
const { fleetGrievanceRepository, fleetViolationRepository } =
  await import('./violation.repository');

const json = (value: unknown): string => JSON.stringify(value);

const sums = (
  outstandingVehicleAmount: number,
  outstandingDriverAmount: number,
): ViolationYearSums => ({
  vehicleId: ID(1),
  vehicleCode: null,
  year: 2026,
  vehicleCount: 0,
  vehicleAmount: 0,
  driverCount: 0,
  driverAmount: 0,
  outstandingVehicleAmount,
  outstandingDriverAmount,
  outstandingVehicleCount: 0,
  outstandingDriverCount: 0,
  rowCount: 1,
  collectedCount: 0,
});
const group = (
  attributed: boolean,
  driverName: string | null,
  amount: number,
  count: number,
): DriverFineGroup => ({ attributed, driverName, amount, count });

describe('assembleYearDigest — the pure half', () => {
  it('sums the rollup’s outstanding halves and splits the drivers’ total exactly', () => {
    const out = assembleYearDigest(
      2026,
      [sums(1000, 700), sums(500.5, 300.25)],
      [
        group(true, null, 600, 4),
        group(false, null, 100, 1), // no name at all → «مجهول»
        group(false, 'مجهول', 150, 2),
        group(false, '  مجهول ', 50, 1), // the book's word with spacing round it → «مجهول»
        group(false, 'محمد عبد الله', 100.25, 1), // a name nobody linked → «اسم غير مربوط»
      ],
    );
    expect(out).toEqual({
      year: 2026,
      company: 1500.5,
      drivers: {
        total: 1000.25,
        attributed: 600,
        unknown: { amount: 300, count: 4 },
        unlinked: { amount: 100.25, count: 1 },
      },
      total: 2500.75,
    });
    const { attributed, unknown, unlinked, total } = out.drivers;
    expect(attributed + unknown.amount + unlinked.amount).toBeCloseTo(total, 10);
  });

  it('an empty name is «مجهول» — the same rule the list filter and the print use', () => {
    const out = assembleYearDigest(2026, [sums(0, 20)], [group(false, '', 20, 1)]);
    expect(out.drivers.unknown).toEqual({ amount: 20, count: 1 });
    expect(out.drivers.unlinked).toEqual({ amount: 0, count: 0 });
    expect(out.drivers.attributed).toBe(0);
  });

  it('nothing owed is zeroes, not a missing figure', () => {
    expect(assembleYearDigest(2027, [], [])).toEqual({
      year: 2027,
      company: 0,
      drivers: {
        total: 0,
        attributed: 0,
        unknown: { amount: 0, count: 0 },
        unlinked: { amount: 0, count: 0 },
      },
      total: 0,
    });
  });
});

describe('driverFineGroups — the rollup’s own question, narrowed to the drivers’ owed fines', () => {
  let pipeline: Record<string, unknown>[] = [];
  beforeEach(() => {
    vi.spyOn(FleetViolationModel, 'aggregate').mockImplementation(((sent: never[]) => {
      pipeline = sent;
      return { exec: async () => [] };
    }) as unknown as typeof FleetViolationModel.aggregate);
  });
  afterEach(() => vi.restoreAllMocks());

  it('matches live driver fines, not collected, in the year by the rollup’s year rule', async () => {
    await fleetViolationRepository.driverFineGroups(2026);
    const match = json(pipeline[0]?.['$match']);
    expect(match).toContain('"isDeleted":false');
    expect(match).toContain('"kind":"driver"');
    expect(match).toContain('"collected":{"$ne":true}');
    // `violationYearBranches`: a fine carried onto the year by `filedYear`, or dated in it.
    expect(match).toContain('"filedYear":2026');
    expect(match).toContain('"$gte":"2026-01-01T00:00:00.000Z"');
    expect(match).toContain('"$lt":"2027-01-01T00:00:00.000Z"');
  });

  it('narrows by the same vehicle clause the rollup is asked with', async () => {
    await fleetViolationRepository.driverFineGroups(2026, {
      vehicleIds: [ID(3)],
      vehicleCodes: ['B-9'],
    });
    const match = json(pipeline[0]?.['$match']);
    expect(match).toContain(ID(3));
    expect(match).toContain('"vehicleCode":{"$in":["B-9"]}');
  });
});

describe('yearDigest and the screens — one vehicle narrowing for list, rollup and digest', () => {
  let matches: unknown[] = [];
  beforeEach(() => {
    matches = [];
    vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockResolvedValue(CODE_IDS);
    vi.spyOn(FleetViolationModel, 'aggregate').mockImplementation(((sent: unknown[]) => {
      matches.push((sent[0] as { $match: unknown }).$match);
      // Awaited directly by `yearSums`, `.exec()`-ed by the split: answer both ways.
      return Object.assign(Promise.resolve([]), { exec: async () => [] });
    }) as unknown as typeof FleetViolationModel.aggregate);
    vi.spyOn(fleetGrievanceRepository, 'forYears').mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('the digest asks the rollup’s sums and the split with the SAME scope', async () => {
    const out = await fleetViolationService.yearDigest({
      year: 2026,
      filter: { vehicleCodes: ['150'], typeIds: [ID(40)] },
    });
    expect(out.year).toBe(2026);
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      const text = json(match);
      expect(text).toContain(ID(2));
      expect(text, 'codes ∩ set').not.toContain(ID(1));
      expect(text).not.toContain(ID(5));
      expect(text, 'a set is a question about registry cars').not.toContain('vehicleCode');
    }
  });

  it('the list takes the set too, and keeps its old filter without one', async () => {
    let filters: unknown[] = [];
    vi.spyOn(fleetViolationRepository, 'listViolations').mockImplementation(async (params) => {
      filters.push(params.filter);
      return { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 } };
    });
    const base = { page: 1, pageSize: 25, sortDir: 'desc' } as const;
    await fleetViolationService.list({ ...base, vehicleCodes: ['150'] });
    expect(json(filters[0])).toBe(
      json(
        fleetViolationRepository.violationFilter({ vehicleIds: CODE_IDS, vehicleCodes: ['150'] }),
      ),
    );
    filters = [];
    await fleetViolationService.list({ ...base, vehicleCodes: ['150'], operationIds: [ID(41)] });
    expect(json(filters[0])).toContain(ID(2));
    expect(json(filters[0])).not.toContain(ID(1));
    expect(json(filters[0])).not.toContain('vehicleCode');
  });

  it('the rollup takes the set beside its codes and its old single id', async () => {
    vi.spyOn(fleetVehicleRepository, 'findById').mockResolvedValue(null);
    await fleetViolationService.rollup([2026], undefined, ['150'], { branchIds: [ID(42)] });
    expect(json(matches[0])).toContain(ID(2));
    expect(json(matches[0])).not.toContain(ID(1));
    matches = [];
    await fleetViolationService.rollup([2026], ID(1), ['150']);
    // Without a set: exactly as before — the codes' cars and the old id, the book codes kept.
    expect(json(matches[0])).toContain(ID(1));
    expect(json(matches[0])).toContain(ID(2));
    expect(json(matches[0])).toContain('vehicleCode');
  });
});
