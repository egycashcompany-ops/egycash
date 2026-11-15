// `exitCount` — the overview's «زيارات الصيانة» (D6): the visits that LEFT the workshop in a period.
//
// The figure is the LIST's own count: these specs capture the filter `/fleet/maintenance` counts its
// `totalItems` with for a query and the filter `exitCount` counts with for the same query, and
// require them to be the same object — equal filters are equal numbers, by construction. The sums
// on real rows are proved by the integration spec `fleet-dashboard-parity.spec.ts`.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListFleetMaintenanceQuerySchema, type ListFleetMaintenanceQuery } from '@ecms/contracts';
import { FleetMaintenanceVisitModel } from './maintenance.model';
import { fleetMaintenanceService, type MaintenanceFilterQuery } from './maintenance.service';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

const oid = (): Types.ObjectId => new Types.ObjectId();
const [CAR1, CAR2, CAR3] = [oid(), oid(), oid()];
const B1 = String(oid());
const B2 = String(oid());
const T1 = String(oid());

/** The list's query exactly as the HTTP layer parses it. */
const parse = (raw: Record<string, unknown>): ListFleetMaintenanceQuery =>
  ListFleetMaintenanceQuerySchema.parse(raw);
/** The query less its page and order — what the dashboard's reads are asked. */
const filterPart = (q: ListFleetMaintenanceQuery): MaintenanceFilterQuery => {
  const rest: Partial<ListFleetMaintenanceQuery> = { ...q };
  for (const key of ['page', 'pageSize', 'sort', 'sortBy', 'sortDir'] as const) delete rest[key];
  return rest as MaintenanceFilterQuery;
};

let counted: unknown[] = [];
let answer = 0;

beforeEach(() => {
  counted = [];
  answer = 0;
  vi.spyOn(FleetMaintenanceVisitModel, 'countDocuments').mockImplementation(((f: unknown) => {
    counted.push(f);
    return { exec: async () => answer };
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
  vi.spyOn(FleetMaintenanceVisitModel, 'aggregate').mockImplementation((() =>
    Promise.resolve([])) as unknown as typeof FleetMaintenanceVisitModel.aggregate);
  vi.spyOn(fleetVehicleRepository, 'liveIdsByCodes').mockResolvedValue([String(CAR1)]);
  vi.spyOn(fleetVehicleRepository, 'idsWithTypes').mockResolvedValue([String(CAR1), String(CAR2)]);
  vi.spyOn(fleetVehicleRepository, 'idsInBranches').mockImplementation(
    async (branchIds: readonly string[]) =>
      branchIds.length === 0
        ? []
        : [
            ...(branchIds.includes(B1) ? [String(CAR1)] : []),
            ...(branchIds.includes(B2) ? [String(CAR2), String(CAR3)] : []),
          ],
  );
  vi.spyOn(fleetVehicleRepository, 'codesByIds').mockResolvedValue(new Map());
  vi.spyOn(fleetVehicleRepository, 'operationIdsByIds').mockResolvedValue(new Map());
  vi.spyOn(fleetVehicleRepository, 'branchIdsByIds').mockResolvedValue(new Map());
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

const exitFilter = async (raw: Record<string, unknown>): Promise<unknown> => {
  await fleetMaintenanceService.exitCount(filterPart(parse(raw)));
  expect(counted).toHaveLength(1);
  const filter = counted[0];
  counted = [];
  return filter;
};

const OCTOBER_OUT = { outFrom: '2026-10-01', outTo: '2026-10-31' };

const QUERIES: Record<string, Record<string, unknown>> = {
  'the exit days alone': OCTOBER_OUT,
  'exit days + one branch': { ...OCTOBER_OUT, branchIds: B1 },
  'exit days + «كل فروعي»': { ...OCTOBER_OUT, branchIds: `${B1},${B2}` },
  'exit days + type + codes': { ...OCTOBER_OUT, typeIds: T1, vehicleCodes: '201' },
};

describe('exitCount — the list’s own count over the EXIT day (D6)', () => {
  for (const [name, raw] of Object.entries(QUERIES)) {
    it(`counts exactly the rows /fleet/maintenance?outFrom&outTo lists — ${name}`, async () => {
      const listed = await listCountFilter(raw);
      expect(await exitFilter(raw)).toEqual(listed);
    });
  }

  it('the soft delete is the list’s own base filter — never a clause of its own', async () => {
    const filter = JSON.stringify(await exitFilter(OCTOBER_OUT));
    expect(filter).toContain('"isDeleted":false');
  });

  it('bounds the EXIT day (outDate), whole Cairo days, and never the check-in day', async () => {
    const filter = JSON.stringify(await exitFilter(OCTOBER_OUT));
    expect(filter).toContain('"outDate":{"$gte":"2026-10-01T00:00:00.000Z"}');
    // `outTo` is the last day itself: the bound is the day after it, exclusive.
    expect(filter).toContain('"outDate":{"$lt":"2026-11-01T00:00:00.000Z"}');
    expect(filter).not.toContain('inDate');
  });

  it('an open visit (no exit yet) is never in the range: `outDate` must be a day in it', async () => {
    const filter = JSON.stringify(await exitFilter(OCTOBER_OUT));
    expect(filter).not.toContain('"outDate":null');
  });

  it('a branch list nobody’s car is in narrows to NOTHING (`$in: []`), not to every visit', async () => {
    const filter = JSON.stringify(await exitFilter({ ...OCTOBER_OUT, branchIds: String(oid()) }));
    expect(filter).toContain('"$in":[]');
  });

  it('answers the count the repository counted', async () => {
    answer = 37;
    expect(await fleetMaintenanceService.exitCount(filterPart(parse(OCTOBER_OUT)))).toBe(37);
  });
});
