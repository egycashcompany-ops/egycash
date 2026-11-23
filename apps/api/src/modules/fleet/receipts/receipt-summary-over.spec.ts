// The receipts screen's own figures, for the fleet dashboard's «مصروفات التشغيل» (T6.7/T6.8, R-19,
// R-21) and «الوقود والمصروفات» («مصروف التشغيل حسب النوع», «نحو N لترًا», the day chart).
//
// `summaryOver` IS the `/summary` computation — `summary` answers through it — so the card and
// custody split the dashboard shows is the screen's own for the same query. The vehicle set —
// «النوع / التشغيل / الفرع» (plan D10) — narrows the same `vehicleId` clause the codes do. And
// `firstReceiptDate` is R-21's «البيانات متاحة من …»: the earliest live receipt's day.
//
// Against a real store (an in-memory Mongo), the same totals split by kind — «وقود من العهدة»
// (card receipts are fuel only, so fuel = card + it), the fuel receipts with no litre price (in the
// money, never in the litres) — and `seriesOver`: the same rows by the receipt's PAPER day or
// month, EVERY slot of the range, an empty one marked, adding up to the totals.
//
// And the fleet dashboard's «مصروفات العهدة» (R2 `opex.custodyCount`, `custodyStates`): the
// custody-paid receipts counted in the same `$group`, and the same custody receipts put where their
// memo stands NOW («لوحة تحكم المصروفات»'s `memoStates` rule — a held memo is still waiting), summed
// in whole piastres so the three parts ARE `custodyTotal`.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetReceiptModel } from './receipt.model';
import { fleetReceiptRepository } from './receipt.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { FleetCustodyMemoModel } from '../custody/custody-memo.model';
import { fleetCustodyMemoRepository } from '../custody/custody-memo.repository';

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

const { fleetReceiptService, seriesKeys } = await import('./receipt.service');

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
    expect(a).toMatchObject({ count: 4, cardTotal: 900, custodyTotal: 50.25, custodyCount: 1 });
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

describe('seriesKeys — every slot of the range, in order', () => {
  it('each day, both ends included, across a year', () => {
    expect(seriesKeys('2026-12-30', '2027-01-02', 'day')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(seriesKeys('2026-11-12', '2026-11-12', 'day')).toEqual(['2026-11-12']);
  });

  it('each month the range touches', () => {
    expect(seriesKeys('2026-11-20', '2027-02-01', 'month')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(seriesKeys('2026-01-01', '2026-01-31', 'month')).toEqual(['2026-01']);
  });

  it('a range that ends before it starts has no slot', () => {
    expect(seriesKeys('2026-11-12', '2026-11-11', 'day')).toEqual([]);
    expect(seriesKeys('2026-11-12', '2026-10-31', 'month')).toEqual([]);
  });
});

describe('the split, the litres and the series — over a real store', () => {
  let server: MongoMemoryServer;
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  const receipt = (over: Record<string, unknown>) => ({
    _id: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(ID(1)),
    driverEmployeeId: null,
    driverName: null,
    kind: 'fuel',
    source: 'card',
    cardId: null,
    fuelType: null,
    pricePerLitre: null,
    litres: null,
    amount: 0,
    odometer: null,
    company: null,
    memoId: null,
    image: null,
    isDeleted: false,
    ...over,
  });
  const OCT = { from: day('2026-10-01'), to: day('2026-10-31') };

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri('ecms-receipt-series'));
    await FleetReceiptModel.collection.insertMany([
      receipt({ date: day('2026-10-01'), amount: 300, litres: 20 }),
      receipt({
        date: day('2026-10-01'),
        amount: 200.1,
        litres: 13.3,
        vehicleId: new Types.ObjectId(ID(2)),
      }),
      receipt({ date: day('2026-10-03'), source: 'custody', amount: 150.15, litres: 10 }),
      // A fuel receipt with no litre price: in the money, never in the litres.
      receipt({ date: day('2026-10-03'), source: 'custody', amount: 99.9 }),
      receipt({ date: day('2026-10-31'), amount: 50 }),
      receipt({ date: day('2026-10-05'), kind: 'tyres', source: 'custody', amount: 400 }),
      // On a car the typed codes do not name.
      receipt({
        date: day('2026-10-05'),
        kind: 'wash',
        source: 'custody',
        amount: 30.05,
        vehicleId: new Types.ObjectId(ID(5)),
      }),
      // Outside October, and a deleted one inside it — never counted.
      receipt({ date: day('2026-11-02'), kind: 'maintenance', source: 'custody', amount: 120 }),
      receipt({ date: day('2026-09-30'), amount: 77, litres: 5 }),
      receipt({ date: day('2026-10-03'), source: 'custody', amount: 1000, isDeleted: true }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it('splits the totals by kind in the same aggregate: card + fuel by custody + tyres + wash + maintenance = total', async () => {
    const out = await fleetReceiptService.summaryOver(OCT);
    expect(out).toMatchObject({
      count: 7,
      cardTotal: 550.1,
      custodyTotal: 680.1,
      fuelTotal: 800.15,
      fuelCustodyTotal: 250.05,
      tyresTotal: 400,
      washTotal: 30.05,
      maintenanceTotal: 0,
      fuelLitres: 43.3,
      fuelUnpriced: 2,
    });
    const parts =
      out.cardTotal + out.fuelCustodyTotal + out.tyresTotal + out.washTotal + out.maintenanceTotal;
    expect(Math.round(parts * 100) / 100).toBe(
      Math.round((out.cardTotal + out.custodyTotal) * 100) / 100,
    );
    expect(Math.round((out.cardTotal + out.fuelCustodyTotal) * 100) / 100).toBe(out.fuelTotal);
  });

  it('by day: every day of the range in order, the empty ones marked, adding up to the totals', async () => {
    const buckets = await fleetReceiptService.seriesOver(OCT, 'day');
    expect(buckets.map((b) => b.key)).toEqual(seriesKeys('2026-10-01', '2026-10-31', 'day'));
    expect(buckets.filter((b) => b.hasRows)).toEqual([
      { key: '2026-10-01', hasRows: true, amount: 500.1, count: 2 },
      { key: '2026-10-03', hasRows: true, amount: 250.05, count: 2 },
      { key: '2026-10-05', hasRows: true, amount: 430.05, count: 2 },
      { key: '2026-10-31', hasRows: true, amount: 50, count: 1 },
    ]);
    expect(buckets.find((b) => b.key === '2026-10-02')).toEqual({
      key: '2026-10-02',
      hasRows: false,
      amount: 0,
      count: 0,
    });
    const sum = buckets.reduce((total, b) => total + b.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(1230.2);
    expect(buckets.reduce((total, b) => total + b.count, 0)).toBe(7);
  });

  it('by month: each month the range touches', async () => {
    const buckets = await fleetReceiptService.seriesOver(
      { from: day('2026-09-15'), to: day('2026-11-10') },
      'month',
    );
    expect(buckets).toEqual([
      { key: '2026-09', hasRows: true, amount: 77, count: 1 },
      { key: '2026-10', hasRows: true, amount: 1230.2, count: 7 },
      { key: '2026-11', hasRows: true, amount: 120, count: 1 },
    ]);
  });

  it('follows the screen’s own filter — the typed cars', async () => {
    const buckets = await fleetReceiptService.seriesOver({ ...OCT, vehicleCodes: ['150'] }, 'day');
    expect(buckets.find((b) => b.key === '2026-10-05')).toMatchObject({ amount: 400, count: 1 });
    const totals = await fleetReceiptService.summaryOver({ ...OCT, vehicleCodes: ['150'] });
    const sum = buckets.reduce((total, b) => total + b.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(
      Math.round((totals.cardTotal + totals.custodyTotal) * 100) / 100,
    );
  });
});

describe('custodyCount and custodyStatesOver — «مصروفات العهدة» and where it stands now', () => {
  let server: MongoMemoryServer;
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  const OCT = { from: day('2026-10-01'), to: day('2026-10-31') };
  const memo = (no: number, over: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    no,
    kind: 'fuel',
    name: '',
    date: day('2026-10-02'),
    from: day('2026-10-01'),
    to: day('2026-10-31'),
    lines: [],
    signatures: { blocks: [], note: '' },
    replenishmentId: null,
    replenishedAt: null,
    isDeleted: false,
    ...over,
  });
  const done = memo(1, { replenishmentId: new Types.ObjectId(), replenishmentHeld: false });
  // From before the hold: no `replenishmentHeld` at all — replenished.
  const legacy = memo(2, { replenishmentId: new Types.ObjectId() });
  const held = memo(3, { replenishmentId: new Types.ObjectId(), replenishmentHeld: true });
  const pending = memo(4);
  const deleted = memo(5, { isDeleted: true });
  const receipt = (over: Record<string, unknown>) => ({
    _id: new Types.ObjectId(),
    vehicleId: new Types.ObjectId(ID(1)),
    date: day('2026-10-10'),
    kind: 'fuel',
    source: 'custody',
    amount: 0,
    memoId: null,
    isDeleted: false,
    ...over,
  });

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri('ecms-receipt-custody-states'));
    await FleetCustodyMemoModel.collection.insertMany([done, legacy, held, pending, deleted]);
    await FleetReceiptModel.collection.insertMany([
      receipt({ memoId: done._id, amount: 100.1 }),
      receipt({ memoId: done._id, amount: 0.2, kind: 'maintenance' }),
      receipt({ memoId: legacy._id, amount: 50, kind: 'tyres' }),
      receipt({ memoId: held._id, amount: 30.05, kind: 'wash' }),
      receipt({ memoId: pending._id, amount: 20 }),
      // On a memo since deleted — «خارج المذكرات», as the dashboard's rule reads it.
      receipt({ memoId: deleted._id, amount: 7 }),
      receipt({ amount: 0.1 }),
      receipt({ amount: 0.2, kind: 'maintenance' }),
      // On a car the typed codes do not name.
      receipt({ memoId: pending._id, amount: 3, vehicleId: new Types.ObjectId(ID(5)) }),
      // Never counted: a card receipt, one outside October, a deleted one.
      receipt({ source: 'card', amount: 400 }),
      receipt({ memoId: done._id, amount: 999, date: day('2026-11-01') }),
      receipt({ memoId: pending._id, amount: 1000, isDeleted: true }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it('counts the custody-paid receipts in the same group — a card receipt is never one', async () => {
    const out = await fleetReceiptService.summaryOver(OCT);
    expect(out).toMatchObject({ count: 10, custodyCount: 9, custodyTotal: 210.65 });
    expect((await fleetReceiptService.summaryOver({ ...OCT, source: 'custody' })).count).toBe(9);
  });

  it('puts each custody receipt where its memo stands now: a held memo is still waiting', async () => {
    expect(await fleetReceiptService.custodyStatesOver(OCT)).toEqual({
      replenished: 150.3,
      pending: 53.05,
      outside: 7.3,
    });
  });

  it('Σ states = custodyTotal to the piastre, over the same query — whatever source was asked', async () => {
    const piastres = (n: number): number => Math.round(n * 100);
    for (const query of [
      OCT,
      { ...OCT, vehicleCodes: ['150'] },
      { ...OCT, source: 'card' as const },
    ]) {
      const states = await fleetReceiptService.custodyStatesOver(query);
      const { custodyTotal } = await fleetReceiptService.summaryOver({
        ...query,
        source: 'custody',
      });
      expect(
        piastres(states.replenished) + piastres(states.pending) + piastres(states.outside),
      ).toBe(piastres(custodyTotal));
    }
    // The typed cars narrow it as they narrow the screen.
    expect(
      await fleetReceiptService.custodyStatesOver({ ...OCT, vehicleCodes: ['150'] }),
    ).toMatchObject({ pending: 50.05 });
  });

  it('reads the memos once, the ones the receipts name — and none when no receipt names one', async () => {
    const spy = vi.spyOn(fleetCustodyMemoRepository, 'statusesByIds');
    await fleetReceiptService.custodyStatesOver(OCT);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...(spy.mock.calls[0]?.[0] ?? [])].sort()).toEqual(
      [done, legacy, held, pending, deleted].map((row) => String(row._id)).sort(),
    );
    spy.mockClear();
    expect(
      await fleetReceiptService.custodyStatesOver({
        from: day('2026-12-01'),
        to: day('2026-12-31'),
      }),
    ).toEqual({ replenished: 0, pending: 0, outside: 0 });
    expect(spy.mock.calls[0]?.[0]).toEqual([]);
  });
});
