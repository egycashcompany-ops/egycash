// Ordering a register by a column it does not store, against a real mongo.
//
// «عاوز هنا يكون فيه سهم ... كود السيارة ... إجمالي المتبقي». Two different kinds of key, and both
// of them are impossible to sort by with a plain query:
//
//   • «كود السيارة» is JOINED — an accident stores a `vehicleId`, and the code is on the vehicle.
//   • «إجمالي المتبقي» is COMPUTED — it is never stored anywhere, by design: it is «المحصَّل +
//     تكلفة الشركة − المدفوع», and the contract owns that formula.
//
// What has to be proved against a database is that both happen BEFORE the page is cut. Sorting a
// fetched page by either would order twenty-five rows out of the whole file and present it as the
// file's order, which is the defect wearing a subtler hat than the one the arrows were asked for.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { fleetAccidentRemaining, parseFleetSort } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { fleetAccidentRepository } from '../../src/modules/fleet/accidents/accident.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/**
 * Three cars and one accident each, planted so that NO other column reproduces either answer.
 *
 *   car DER-300 · collected 100 + company 100 − paid   0 =  200 still owed
 *   car DER-100 · collected   0 + company 500 − paid 500 =    0 — settled
 *   car DER-200 · collected  50 + company  50 − paid 150 =  −50 — overpaid
 *
 * The dates run the other way to the codes, and the three stored money figures each order the
 * files differently from «المتبقي» — so an implementation that sorted by any stored column, or by
 * insertion order, answers something else.
 */
const CARS = [
  { code: 'DER-300', collected: 100, company: 100, paid: 0, on: '2026-03-01' },
  { code: 'DER-100', collected: 0, company: 500, paid: 500, on: '2026-02-01' },
  { code: 'DER-200', collected: 50, company: 50, paid: 150, on: '2026-01-01' },
];
const vehicleIds = new Map<string, Types.ObjectId>();

const plant = async (): Promise<void> => {
  await FleetVehicleModel.collection.insertMany(
    CARS.map((car) => {
      const id = new Types.ObjectId();
      vehicleIds.set(car.code, id);
      return {
        _id: id,
        code: car.code,
        typeId: new Types.ObjectId(),
        plateNumber: `س ص ${car.code}`,
        chassisNumber: `CH-${car.code}`,
        motorNumber: `MO-${car.code}`,
        licenseExpiresAt: day('2027-01-01'),
        isDeleted: false,
        status: 'active',
        createdAt: day('2026-01-01'),
      };
    }),
  );
  await FleetAccidentModel.collection.insertMany(
    CARS.map((car) => ({
      vehicleId: vehicleIds.get(car.code) as Types.ObjectId,
      occurredAt: day(car.on),
      culprit: `سائق ${car.code}`,
      culpritEmployeeId: null,
      statement: 'بيان',
      companyCost: car.company,
      amountCollected: car.collected,
      paidAmount: car.paid,
      status: 'open',
      notes: null,
      isDeleted: false,
      createdAt: day(car.on),
    })),
  );
};

/** The cars the register answers for, in the order asked for. */
const order = async (sort: string, pageSize = 50): Promise<string[]> => {
  const answered = await fleetAccidentRepository.listAccidents({
    filter: { vehicleId: { $in: [...vehicleIds.values()] } },
    page: 1,
    pageSize,
    sorts: parseFleetSort(sort),
  });
  const byId = new Map([...vehicleIds].map(([code, id]) => [String(id), code]));
  return answered.items.map((doc) => byId.get(String(doc.vehicleId)) ?? '?');
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plant();
}, 120_000);

afterAll(async () => {
  await FleetAccidentModel.deleteMany({ vehicleId: { $in: [...vehicleIds.values()] } }).exec();
  await FleetVehicleModel.deleteMany({ code: { $regex: '^DER-' } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('«كود السيارة» — joined from the registry', () => {
  it('orders the accident file by the car’s code', async () => {
    expect(await order('vehicleCode:asc')).toEqual(['DER-100', 'DER-200', 'DER-300']);
    expect(await order('vehicleCode:desc')).toEqual(['DER-300', 'DER-200', 'DER-100']);
  });

  it('orders the WHOLE file, not the page — one row at a time still walks the codes', async () => {
    const first = await fleetAccidentRepository.listAccidents({
      filter: { vehicleId: { $in: [...vehicleIds.values()] } },
      page: 2,
      pageSize: 1,
      sorts: parseFleetSort('vehicleCode:asc'),
    });
    const byId = new Map([...vehicleIds].map(([code, id]) => [String(id), code]));
    expect(first.items.map((doc) => byId.get(String(doc.vehicleId)))).toEqual(['DER-200']);
    expect(first.meta.totalItems, 'and the count is the file’s, not the page’s').toBe(3);
  });

  it('breaks the code’s ties with a second column', async () => {
    expect(await order('vehicleCode:asc,occurredAt:desc')).toEqual([
      'DER-100',
      'DER-200',
      'DER-300',
    ]);
  });
});

describe('«إجمالي المتبقي» — computed, never stored', () => {
  it('orders by what is still owed, which is no stored column’s order', async () => {
    // −50, 0, 200. Note that none of `amountCollected`, `companyCost` or `paidAmount` produces
    // this sequence on its own, and neither does the date or the code.
    expect(await order('remaining:asc')).toEqual(['DER-200', 'DER-100', 'DER-300']);
    expect(await order('remaining:desc')).toEqual(['DER-300', 'DER-100', 'DER-200']);
  });

  it('computes exactly what the contract computes — the column and its order agree', async () => {
    // The screen prints `fleetAccidentRemaining`; the database sorts by its own copy of the same
    // subtraction. If the two ever part, the register would be ordered by a figure that is not
    // the one on the rows — this is the assertion that catches it.
    for (const car of CARS) {
      const expected = fleetAccidentRemaining({
        amountCollected: car.collected,
        companyCost: car.company,
        paidAmount: car.paid,
      });
      const answered = await fleetAccidentRepository.listAccidents({
        filter: { vehicleId: vehicleIds.get(car.code) },
        page: 1,
        pageSize: 1,
        sorts: parseFleetSort('remaining:asc'),
      });
      const doc = answered.items[0] as Record<string, unknown> | undefined;
      const stored = fleetAccidentRemaining({
        amountCollected: doc?.['amountCollected'] as number,
        companyCost: doc?.['companyCost'] as number,
        paidAmount: doc?.['paidAmount'] as number,
      });
      expect(stored, car.code).toBe(expected);
    }
  });

  it('leaves no computed field on the document it hands back', async () => {
    const answered = await fleetAccidentRepository.listAccidents({
      filter: { vehicleId: { $in: [...vehicleIds.values()] } },
      page: 1,
      pageSize: 1,
      sorts: parseFleetSort('remaining:asc'),
    });
    const doc = answered.items[0] as Record<string, unknown> | undefined;
    expect(doc).not.toHaveProperty('remaining');
    expect(doc).not.toHaveProperty('vehicleCode');
    expect(Object.keys(doc ?? {}).filter((k) => k.startsWith('__sort_'))).toEqual([]);
  });

  it('is still answered when one column is stored and the other is not', async () => {
    // A mixed order is the ordinary case once a reader clicks twice, and it is the one where a
    // half-applied aggregation would show: the stored column sorted, the derived one ignored.
    expect(await order('occurredAt:asc,remaining:desc')).toEqual([
      'DER-200',
      'DER-100',
      'DER-300',
    ]);
  });
});
