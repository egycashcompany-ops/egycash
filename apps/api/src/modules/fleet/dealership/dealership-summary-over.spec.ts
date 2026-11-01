// The dealership screen's own figures, for the fleet dashboard (T1.9, T6.9, R-20).
//
// `summaryOver` IS the `/summary` computation — `summary` answers through it — so the dashboard's
// «فواتير التوكيل» is the number the screen prints for the same query. The vehicle set — «النوع /
// التشغيل / الفرع» (plan D10) — narrows the same vehicle clause the codes do; a query without one
// sends the filter it always sent, the old book's codes included.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetDealershipInvoiceModel } from './dealership.model';
import { fleetDealershipRepository } from './dealership.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

const ID = (n: number): string => `64b0000000000000000000${String(n).padStart(2, '0')}`;
const CODE_IDS = [ID(1), ID(2)];
const SET_IDS = [ID(2), ID(7)];

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) =>
    f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined
      ? SET_IDS
      : undefined,
  ),
}));

const { fleetDealershipService } = await import('./dealership.service');

const json = (value: unknown): string => JSON.stringify(value);

const record = (): unknown[][] => {
  const sent: unknown[][] = [];
  vi.spyOn(FleetDealershipInvoiceModel, 'aggregate').mockImplementation(((stages: unknown[]) => {
    sent.push(stages);
    return {
      exec: async () => [
        { _id: { pending: true }, count: 2, amount: 0 },
        { _id: { pending: false }, count: 3, amount: 1234.5 },
      ],
    };
  }) as unknown as typeof FleetDealershipInvoiceModel.aggregate);
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
    const query = { pending: true, vehicleCodes: ['150'] };
    const a = await fleetDealershipService.summary(query);
    const b = await fleetDealershipService.summaryOver(query);
    expect(a).toEqual({ count: 5, pending: 2, dealershipTotal: 1234.5 });
    expect(b).toEqual(a);
    expect(json(sent[1])).toBe(json(sent[0]));
  });

  it('without a set, the filter is the one the screen always sent (book codes included)', async () => {
    const sent = record();
    const from = new Date('2026-10-01T00:00:00.000Z');
    await fleetDealershipService.summaryOver({ vehicleCodes: ['150'], from });
    const before = fleetDealershipRepository.dealershipFilter({
      vehicleIds: CODE_IDS,
      vehicleCodes: ['150'],
      from,
    });
    expect(matchOf(sent[0])).toBe(json({ $and: [{ isDeleted: false }, before] }));
    expect(matchOf(sent[0])).toContain('vehicleCode');
  });

  it('with a set, codes ∩ set, and a bill on a car the registry never had stops matching', async () => {
    const sent = record();
    await fleetDealershipService.summaryOver({ vehicleCodes: ['150'], branchIds: [ID(40)] });
    const match = matchOf(sent[0]);
    expect(match).toContain(ID(2));
    expect(match).not.toContain(ID(1));
    expect(match).not.toContain(ID(7));
    expect(match).not.toContain('vehicleCode');
  });

  it('a set alone narrows to the set; the exit-day window stays on outDate (R-20)', async () => {
    const sent = record();
    await fleetDealershipService.summaryOver({
      typeIds: [ID(41)],
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.999Z'),
    });
    const match = matchOf(sent[0]);
    for (const id of SET_IDS) expect(match).toContain(id);
    expect(match).toContain('"outDate"');
    expect(match).not.toContain('createdBy');
  });
});
