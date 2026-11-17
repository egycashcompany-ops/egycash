// «فواتير التوكيل في الفترة» — the dealership screen's FIRST PAGE over the dashboard's period,
// against a real store (an in-memory Mongo).
//
// The promises (plan D11, D24):
//   · the screen's own order — the exit day newest first, then the newest recorded (`_id` desc) —
//     so the table is page 1 of its link, a «صيانة + إصلاح» pair of one visit included;
//   · `date` is the exit day ('YYYY-MM-DD'), the day the period counts the row by;
//   · every car named as it is now: its code and make, a deleted car's too (no record link then),
//     an old-book row by its own code with no car;
//   · at most `limit` rows; `more` = the rows left out, so `more` + rows = `summaryOver`'s count;
//   · «بانتظار تسجيل القيمة» is `invoiceAmount: null`.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetDealershipInvoiceModel } from './dealership.model';

const ID = (n: number): string => `64b00000000000000000d0${String(n).padStart(2, '0')}`;
const oid = (n: number) => new Types.ObjectId(ID(n));

// Cars: A «150» (live), B «151» (deleted since). The set (type, operation or branch) is B alone.
const CAR_A = ID(1);
const CAR_B = ID(2);
const MAKE = ID(20);
const CARS: Record<string, { code: string; isDeleted: boolean }> = {
  [CAR_A]: { code: '150', isDeleted: false },
  [CAR_B]: { code: '151', isDeleted: true },
};

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) =>
    f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined
      ? [ID(2)]
      : undefined,
  ),
}));

const { fleetDealershipService } = await import('./dealership.service');
const { fleetVehicleRepository } = await import('../vehicles/vehicle.repository');
const { fleetVehicleTypeRepository } = await import('../vehicle-types/vehicle-type.repository');

const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const OCT = { from: day('2026-10-01'), to: day('2026-10-31') };

let server: MongoMemoryServer;

const row = (n: number, over: Record<string, unknown>) => ({
  _id: oid(n),
  visitId: new Types.ObjectId(),
  vehicleId: new Types.ObjectId(CAR_A),
  vehicleCode: null,
  outDate: day('2026-10-10'),
  workKind: 'maintenance',
  workTypeLabel: 'صيانة دورية',
  privateCar: false,
  insuranceCompanyId: null,
  invoiceNumber: null,
  invoiceAmount: null,
  image: null,
  side: null,
  isDeleted: false,
  ...over,
});

const R = {
  // One visit, two rows: «صيانة» recorded first, «إصلاح» after — the register lists «إصلاح» first.
  pairMaintenance: row(31, {
    outDate: day('2026-10-20'),
    invoiceNumber: 'INV-31',
    invoiceAmount: 1500.5,
  }),
  pairRepair: row(32, { outDate: day('2026-10-20'), workKind: 'repair', workTypeLabel: 'إصلاح' }),
  // On the deleted car.
  onDeleted: row(33, {
    vehicleId: new Types.ObjectId(CAR_B),
    outDate: day('2026-10-15'),
    invoiceAmount: 800,
  }),
  // An old-book row: a code, no car.
  book: row(34, { vehicleId: null, vehicleCode: 'B-12', outDate: day('2026-10-25') }),
  older: row(35, { outDate: day('2026-10-02'), invoiceAmount: 100 }),
  oldest: row(36, { outDate: day('2026-10-01'), invoiceAmount: 50 }),
  // Outside the month, and a deleted row inside it — never listed.
  outside: row(37, { outDate: day('2026-11-01') }),
  removed: row(38, { outDate: day('2026-10-26'), isDeleted: true }),
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('ecms-dealership-rows'));
  await FleetDealershipInvoiceModel.collection.insertMany(Object.values(R));
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(() => {
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockImplementation(async (codes) =>
    Object.entries(CARS).flatMap(([id, car]) => (codes.includes(car.code) ? [id] : [])),
  );
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.flatMap((id) =>
        CARS[id] === undefined
          ? []
          : [{ _id: new Types.ObjectId(id), typeId: new Types.ObjectId(MAKE), ...CARS[id] }],
      ) as never,
  );
  vi.spyOn(fleetVehicleTypeRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.map((id) => ({
        _id: new Types.ObjectId(id),
        name: { ar: 'تويوتا', en: 'Toyota' },
      })) as never,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('dashboardRows — the dealership screen’s first page of the period', () => {
  it('the screen’s order: exit day newest first, then the newest recorded; `more` the rest', async () => {
    const out = await fleetDealershipService.dashboardRows(OCT, 6);
    expect(out.rows.map((r) => r.id)).toEqual([ID(34), ID(32), ID(31), ID(33), ID(35), ID(36)]);
    expect(out.more).toBe(0);
    const totals = await fleetDealershipService.summaryOver(OCT);
    expect(out.rows.length + out.more).toBe(totals.count);
  });

  it('at most `limit` rows; `more` + rows = the screen’s count', async () => {
    const out = await fleetDealershipService.dashboardRows(OCT, 3);
    expect(out.rows.map((r) => r.id)).toEqual([ID(34), ID(32), ID(31)]);
    expect(out.more).toBe(3);
  });

  it('names every row as it is now; `date` is the exit day; a pending row has no amount', async () => {
    const { rows } = await fleetDealershipService.dashboardRows(OCT, 6);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ID(31))).toEqual({
      id: ID(31),
      vehicleId: CAR_A,
      code: '150',
      typeName: { ar: 'تويوتا', en: 'Toyota' },
      vehicleDeleted: false,
      date: '2026-10-20',
      workKind: 'maintenance',
      workTypeLabel: 'صيانة دورية',
      invoiceNumber: 'INV-31',
      invoiceAmount: 1500.5,
    });
    expect(byId.get(ID(32))).toMatchObject({
      workKind: 'repair',
      invoiceAmount: null,
      invoiceNumber: null,
    });
    expect(byId.get(ID(33))).toMatchObject({ vehicleId: CAR_B, code: '151', vehicleDeleted: true });
    expect(byId.get(ID(34))).toMatchObject({
      vehicleId: null,
      code: 'B-12',
      typeName: null,
      vehicleDeleted: false,
      date: '2026-10-25',
    });
    // Never the stored instant under its stored name.
    expect(Object.keys(byId.get(ID(31)) ?? {})).not.toContain('outDate');
  });

  it('follows the screen’s own filter: a set drops the old book’s rows; the typed codes reach them', async () => {
    const set = await fleetDealershipService.dashboardRows({ ...OCT, branchIds: [ID(9)] }, 6);
    expect(set.rows.map((r) => r.id)).toEqual([ID(33)]);
    const coded = await fleetDealershipService.dashboardRows({ ...OCT, vehicleCodes: ['B-12'] }, 6);
    expect(coded.rows.map((r) => r.id)).toEqual([ID(34)]);
  });

  it('nothing in the period: no rows and 0', async () => {
    expect(
      await fleetDealershipService.dashboardRows(
        { from: day('2025-01-01'), to: day('2025-01-31') },
        6,
      ),
    ).toEqual({ rows: [], more: 0 });
  });
});
