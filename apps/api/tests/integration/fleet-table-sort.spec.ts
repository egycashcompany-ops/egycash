// Sorting a Fleet table by SEVERAL columns, against a real mongo.
//
// «لو دوس على الكود ... لكن لو دوس على انتهاء الترخيص هيلغى اللى كنت عامله فى الكود ... انا عاوز
// اقدر اعمل الاتنين مع بعض». The browser can hold the whole order and say so in the address bar,
// but the ORDER ITSELF is the database's answer, and the only place to prove it is against one.
//
// The fixture is built so that no single column can produce the two-column result: two cars share
// a licence expiry and differ by code, and a third expires earlier with a code between them. Any
// implementation that quietly kept only the first column, or only the last, gives a different
// list — which is what makes these assertions worth their round trip.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { parseFleetSort } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { fleetVehicleRepository } from '../../src/modules/fleet/vehicles/vehicle.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const TYPE = new Types.ObjectId();
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/**
 * Three cars, planted in an order that is none of the orders under test — so a result that
 * happens to match insertion order proves nothing by accident.
 *
 *   SORT-300 · expires 2027-01-01   ┐ same expiry, different codes
 *   SORT-100 · expires 2027-01-01   ┘
 *   SORT-200 · expires 2026-01-01     earlier, code in between
 */
const plant = async (): Promise<void> => {
  // The plate, chassis and motor numbers are each uniquely indexed, so even a planted row needs
  // its own — three cars with no plate at all collide on `ux_plate`.
  const car = (code: string, expiry: string, created: string) => ({
    code,
    typeId: TYPE,
    plateNumber: `س ص ${code}`,
    chassisNumber: `CH-${code}`,
    motorNumber: `MO-${code}`,
    licenseExpiresAt: day(expiry),
    isDeleted: false,
    status: 'active',
    createdAt: day(created),
  });
  await FleetVehicleModel.collection.insertMany([
    car('SORT-300', '2027-01-01', '2026-01-03'),
    car('SORT-100', '2027-01-01', '2026-01-01'),
    car('SORT-200', '2026-01-01', '2026-01-02'),
  ]);
};

/** The codes the registry answers with, for an order written the way the browser writes it. */
const codes = async (sort: string): Promise<string[]> => {
  const page = await fleetVehicleRepository.listVehicles({
    filter: { code: { $regex: '^SORT-' } },
    page: 1,
    pageSize: 50,
    sorts: parseFleetSort(sort),
  });
  return page.items.map((doc) => doc.code);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plant();
}, 120_000);

afterAll(async () => {
  await FleetVehicleModel.deleteMany({ code: { $regex: '^SORT-' } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('one column at a time, as it always was', () => {
  it('sorts by the code alone', async () => {
    expect(await codes('code:asc')).toEqual(['SORT-100', 'SORT-200', 'SORT-300']);
    expect(await codes('code:desc')).toEqual(['SORT-300', 'SORT-200', 'SORT-100']);
  });

  it('sorts by the licence expiry alone', async () => {
    // The two cars that share an expiry may come back either way round here — that is exactly the
    // ambiguity the second column exists to settle, and the case below settles it.
    expect((await codes('licenseExpiresAt:asc'))[0]).toBe('SORT-200');
  });
});

describe('two columns at once — «الاتنين مع بعض»', () => {
  it('breaks the first column’s ties with the second', async () => {
    expect(await codes('licenseExpiresAt:asc,code:asc')).toEqual([
      'SORT-200', // expires first
      'SORT-100', // then the 2027 pair, by code
      'SORT-300',
    ]);
  });

  it('turns ONLY the column that was turned', async () => {
    expect(await codes('licenseExpiresAt:asc,code:desc')).toEqual([
      'SORT-200',
      'SORT-300',
      'SORT-100',
    ]);
  });

  it('answers differently when the columns swap places — precedence is real', async () => {
    // Code first: 100, 200, 300 whatever the expiries say. Expiry first: 200 leads.
    expect(await codes('code:asc,licenseExpiresAt:asc')).toEqual([
      'SORT-100',
      'SORT-200',
      'SORT-300',
    ]);
  });
});

describe('what the registry refuses to sort by', () => {
  it('drops a column the collection does not offer, and keeps the rest of the order', async () => {
    // `plateNumber` is not in `sortableFields`; the code beside it still decides.
    expect(await codes('plateNumber:asc,code:desc')).toEqual([
      'SORT-300',
      'SORT-200',
      'SORT-100',
    ]);
  });

  it('falls back to the collection’s own order rather than failing, when NOTHING is sortable', async () => {
    const answered = await codes('plateNumber:asc,chassisNumber:desc');
    expect(answered, 'every car is still answered for').toHaveLength(3);
  });

  it('is unchanged for a caller that passes no order at all', async () => {
    const page = await fleetVehicleRepository.listVehicles({
      filter: { code: { $regex: '^SORT-' } },
      page: 1,
      pageSize: 50,
    });
    // `createdAt` descending is the documented default (API Standards §4), and the fixture's
    // creation stamps are deliberately not in any of the orders above.
    expect(page.items.map((doc) => doc.code)).toEqual(['SORT-300', 'SORT-200', 'SORT-100']);
  });
});

describe('paging under a two-column order', () => {
  it('cuts the SAME list the first page was cut from — no row shown twice, none skipped', async () => {
    const paged = async (page: number): Promise<string[]> =>
      (
        await fleetVehicleRepository.listVehicles({
          filter: { code: { $regex: '^SORT-' } },
          page,
          pageSize: 2,
          sorts: parseFleetSort('licenseExpiresAt:asc,code:asc'),
        })
      ).items.map((doc) => doc.code);
    expect([...(await paged(1)), ...(await paged(2))]).toEqual([
      'SORT-200',
      'SORT-100',
      'SORT-300',
    ]);
  });
});
