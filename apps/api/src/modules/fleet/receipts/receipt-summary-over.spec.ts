// The receipts screen's own figures, for the fleet dashboard's «مصروفات التشغيل» (T6.7/T6.8, R-19,
// R-21).
//
// `summaryOver` IS the `/summary` computation — `summary` answers through it — so the card and
// custody split the dashboard shows is the screen's own for the same query. The vehicle set —
// «النوع / التشغيل / الفرع» (plan D10) — narrows the same `vehicleId` clause the codes do. And
// `firstReceiptDate` is R-21's «البيانات متاحة من …»: the earliest live receipt's day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetReceiptModel } from './receipt.model';
import { fleetReceiptRepository } from './receipt.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

const ID = (n: number): string => `64b0000000000000000000${String(n).padStart(2, '0')}`;
const CODE_IDS = [ID(1), ID(2)];
const SET_IDS = [ID(2), ID(8)];

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) =>
    f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined
      ? SET_IDS
      : undefined,
  ),
}));

const { fleetReceiptService } = await import('./receipt.service');

const json = (value: unknown): string => JSON.stringify(value);

const record = (): unknown[][] => {
  const sent: unknown[][] = [];
  vi.spyOn(FleetReceiptModel, 'aggregate').mockImplementation(((stages: unknown[]) => {
    sent.push(stages);
    return {
      exec: async () => [
        { _id: { kind: 'fuel', source: 'card' }, count: 3, amount: 900, litres: 60 },
        { _id: { kind: 'wash', source: 'custody' }, count: 1, amount: 50.25, litres: 0 },
      ],
    };
  }) as unknown as typeof FleetReceiptModel.aggregate);
  return sent;
};
const matchOf = (stages: unknown[] | undefined): string =>
  json((stages?.[0] as { $match: unknown } | undefined)?.$match);

beforeEach(() => {
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockResolvedValue(CODE_IDS);
});

afterEach(() => vi.restoreAllMocks());

describe('summaryOver — the /summary computation, byte for byte', () => {
  it('summary answers through it: the same pipeline, the same figures', async () => {
    const sent = record();
    const query = { vehicleCodes: ['150'], source: 'card' as const };
    const a = await fleetReceiptService.summary(query);
    const b = await fleetReceiptService.summaryOver(query);
    expect(a).toMatchObject({ count: 4, cardTotal: 900, custodyTotal: 50.25 });
    expect(b).toEqual(a);
    expect(json(sent[1])).toBe(json(sent[0]));
  });

  it('without a set, the filter is the one the screen always sent', async () => {
    const sent = record();
    const from = new Date('2026-10-01T00:00:00.000Z');
    await fleetReceiptService.summaryOver({ vehicleCodes: ['150'], from });
    const before = fleetReceiptRepository.receiptFilter({ vehicleIds: CODE_IDS, from });
    expect(matchOf(sent[0])).toBe(json({ $and: [{ isDeleted: false }, before] }));
  });

  it('with a set, the cars are the codes ∩ the set; a set alone is the set', async () => {
    const sent = record();
    await fleetReceiptService.summaryOver({ vehicleCodes: ['150'], operationIds: [ID(30)] });
    await fleetReceiptService.summaryOver({ typeIds: [ID(31)] });
    expect(matchOf(sent[0])).toContain(ID(2));
    expect(matchOf(sent[0])).not.toContain(ID(1));
    expect(matchOf(sent[0])).not.toContain(ID(8));
    expect(matchOf(sent[1])).toContain(ID(2));
    expect(matchOf(sent[1])).toContain(ID(8));
    expect(json(sent)).not.toContain('createdBy');
  });
});

describe('firstReceiptDate — R-21', () => {
  const findChain = (rows: { date: Date }[]) => {
    const seen: { filter?: unknown; sort?: unknown; limit?: number } = {};
    const chain = {
      select: () => chain,
      sort: (s: unknown) => ((seen.sort = s), chain),
      limit: (n: number) => ((seen.limit = n), chain),
      lean: () => chain,
      exec: async () => rows,
    };
    vi.spyOn(FleetReceiptModel, 'find').mockImplementation(((filter: unknown) => {
      seen.filter = filter;
      return chain;
    }) as unknown as typeof FleetReceiptModel.find);
    return seen;
  };

  it('is the earliest LIVE receipt’s calendar day', async () => {
    const seen = findChain([{ date: new Date('2026-08-14T00:00:00.000Z') }]);
    expect(await fleetReceiptService.firstReceiptDate()).toBe('2026-08-14');
    expect(seen.filter).toEqual({ isDeleted: false });
    expect(seen.sort).toEqual({ date: 1 });
    expect(seen.limit).toBe(1);
  });

  it('is null while there is no receipt at all', async () => {
    findChain([]);
    expect(await fleetReceiptService.firstReceiptDate()).toBeNull();
  });

  it('reads a stored date-only value as the day it names', async () => {
    findChain([{ date: new Date('2026-09-30T00:00:00.000Z') }]);
    expect(await fleetReceiptService.firstReceiptDate()).toBe('2026-09-30');
  });
});
