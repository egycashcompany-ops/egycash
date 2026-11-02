// The accidents screen's own figures, for the fleet dashboard (T4.9, T5.10, T6.5/T6.6, T10.2, R-23).
//
// `summaryOver` IS the `/summary` handler's computation: `summary` answers through it, so a figure
// the dashboard reads with the screen's query is the figure the screen prints. The vehicle set —
// «النوع / التشغيل / الفرع» (plan D10) — joins the codes as one more narrowing of the SAME vehicle
// clause, and a query without one sends exactly the filter it always sent.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetAccidentModel, type FleetAccidentDoc } from './accident.model';
import { fleetAccidentRepository } from './accident.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

const ID = (n: number): string => `64b0000000000000000000${String(n).padStart(2, '0')}`;
const CODE_IDS = [ID(1), ID(2), ID(3)];
const SET_IDS = [ID(3), ID(2), ID(9)];

const set = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) => {
    set.calls.push(f);
    const asked =
      f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined;
    return asked ? SET_IDS : undefined;
  }),
}));

const { fleetAccidentService } = await import('./accident.service');

const json = (value: unknown): string => JSON.stringify(value);

/** Every pipeline / count / find the accidents model is sent, recorded. */
const record = () => {
  const sent: { aggregate: unknown[][]; count: unknown[]; find: unknown[] } = {
    aggregate: [],
    count: [],
    find: [],
  };
  vi.spyOn(FleetAccidentModel, 'aggregate').mockImplementation(((stages: unknown[]) => {
    sent.aggregate.push(stages);
    return {
      exec: async () => [{ count: 2, amountCollected: 100, companyCost: 50, paidAmount: 30 }],
    };
  }) as unknown as typeof FleetAccidentModel.aggregate);
  vi.spyOn(FleetAccidentModel, 'countDocuments').mockImplementation(((filter: unknown) => {
    sent.count.push(filter);
    return { exec: async () => 4 };
  }) as unknown as typeof FleetAccidentModel.countDocuments);
  return sent;
};

beforeEach(() => {
  set.calls = [];
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockResolvedValue(CODE_IDS);
  vi.spyOn(fleetVehicleRepository, 'idsByCodeSearch').mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe('summaryOver — the /summary computation, byte for byte', () => {
  it('summary answers through it: the same pipeline, the same figures', async () => {
    const sent = record();
    const query = { status: 'open' as const, vehicleCodes: ['150', '151'] };
    const a = await fleetAccidentService.summary(query);
    const b = await fleetAccidentService.summaryOver(query);
    expect(b).toEqual(a);
    expect(json(sent.aggregate[1])).toBe(json(sent.aggregate[0]));
  });

  it('without a vehicle set, the filter is the one the screen always sent', async () => {
    const sent = record();
    const query = { status: 'open' as const, vehicleCodes: ['150'], from: new Date('2026-10-01') };
    await fleetAccidentService.summaryOver(query);
    const before = fleetAccidentRepository.accidentFilter({
      vehicleIds: CODE_IDS,
      vehicleCodes: ['150'],
      status: 'open',
      from: query.from,
    });
    expect(json((sent.aggregate[0]?.[0] as { $match: unknown }).$match)).toBe(
      json({ $and: [{ isDeleted: false }, before] }),
    );
  });

  it('with a set, the cars are the codes ∩ the set — and the old book’s codes stop on their own', async () => {
    const sent = record();
    await fleetAccidentService.summaryOver({ vehicleCodes: ['150'], typeIds: [ID(50)] });
    const match = json((sent.aggregate[0]?.[0] as { $match: unknown }).$match);
    expect(match).toContain(ID(2));
    expect(match).toContain(ID(3));
    expect(match).not.toContain(ID(1));
    expect(match).not.toContain(ID(9));
    expect(match, 'a file on a car the registry never had has no type').not.toContain(
      'vehicleCode',
    );
    expect(set.calls[0]).toEqual({ typeIds: [ID(50)] });
  });

  it('a set alone narrows to the set', async () => {
    const sent = record();
    await fleetAccidentService.summaryOver({ operationIds: [ID(60)], branchIds: [ID(61)] });
    const match = json((sent.aggregate[0]?.[0] as { $match: unknown }).$match);
    for (const id of SET_IDS) expect(match).toContain(id);
    expect(set.calls[0]).toEqual({ operationIds: [ID(60)], branchIds: [ID(61)] });
  });

  it('applies no permission scope — an `own` grant can never become createdBy', async () => {
    const sent = record();
    await fleetAccidentService.summaryOver({ typeIds: [ID(50)] });
    expect(json(sent.aggregate)).not.toContain('createdBy');
  });
});

describe('undatedCount — R-23, the files no period can hold', () => {
  it('counts live files with no accident date, over the vehicle filter', async () => {
    const sent = record();
    expect(await fleetAccidentService.undatedCount({ typeIds: [ID(50)] })).toBe(4);
    const filter = json(sent.count[0]);
    expect(filter).toContain('"occurredAt":null');
    expect(filter).toContain('"isDeleted":false');
    expect(filter).toContain(ID(9));
  });

  it('nothing narrows → every undated file', async () => {
    const sent = record();
    await fleetAccidentService.undatedCount({});
    expect(json(sent.count[0])).not.toContain('vehicleId');
  });
});

describe('recentWritten — R-12, newest WRITTEN first, dated rows only, date only', () => {
  const findChain = (rows: Partial<FleetAccidentDoc>[]) => {
    const seen: { filter?: unknown; sort?: unknown; limit?: number } = {};
    const chain = {
      select: () => chain,
      sort: (s: unknown) => ((seen.sort = s), chain),
      limit: (n: number) => ((seen.limit = n), chain),
      lean: () => chain,
      exec: async () => rows,
    };
    vi.spyOn(FleetAccidentModel, 'find').mockImplementation(((filter: unknown) => {
      seen.filter = filter;
      return chain;
    }) as unknown as typeof FleetAccidentModel.find);
    return seen;
  };

  it('reads by createdAt desc, _id desc, from the first instant of the window’s first day', async () => {
    const seen = findChain([]);
    await fleetAccidentService.recentWritten({ sinceYmd: '2026-10-03', limit: 8, filter: {} });
    expect(seen.sort).toEqual({ createdAt: -1, _id: -1 });
    expect(seen.limit).toBe(8);
    const filter = json(seen.filter);
    expect(filter).toContain('"$gte":"2026-10-03T00:00:00.000Z"');
    expect(filter, 'an undated file is never recent').toContain('"$ne":null');
    expect(filter).toContain('"isDeleted":false');
  });

  it('maps a row to the dashboard’s shape — the registry code, the book’s code, the date', async () => {
    const car = new Types.ObjectId(ID(2));
    const driver = new Types.ObjectId();
    findChain([
      {
        _id: new Types.ObjectId(),
        vehicleId: car,
        vehicleCode: null,
        occurredAt: new Date('2026-10-30T00:00:00.000Z'),
        culprit: 'أحمد',
        culpritEmployeeId: driver,
        status: 'open',
      },
      {
        _id: new Types.ObjectId(),
        vehicleId: null,
        vehicleCode: 'B-77',
        occurredAt: new Date('2026-10-29T21:00:00.000Z'),
        culprit: 'طرف ثالث',
        culpritEmployeeId: null,
        culpritEmployeeIds: [],
        status: 'closed',
      },
    ]);
    vi.spyOn(fleetVehicleRepository, 'codesByIds').mockResolvedValue(new Map([[ID(2), '213']]));
    const rows = await fleetAccidentService.recentWritten({
      sinceYmd: '2026-10-03',
      limit: 8,
      filter: {},
    });
    expect(rows.map(({ accidentId: _, ...row }) => row)).toEqual([
      {
        vehicleId: ID(2),
        code: '213',
        date: '2026-10-30',
        culprit: 'أحمد',
        culpritEmployeeIds: [String(driver)],
        status: 'open',
      },
      {
        vehicleId: null,
        code: 'B-77',
        date: '2026-10-29',
        culprit: 'طرف ثالث',
        culpritEmployeeIds: [],
        status: 'closed',
      },
    ]);
  });

  it('a request for no rows reads nothing', async () => {
    const seen = findChain([]);
    expect(
      await fleetAccidentService.recentWritten({ sinceYmd: '2026-10-03', limit: 0, filter: {} }),
    ).toEqual([]);
    expect(seen.filter).toBeUndefined();
  });
});
