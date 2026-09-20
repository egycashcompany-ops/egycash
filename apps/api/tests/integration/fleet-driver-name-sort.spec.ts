// «رتب بإسم السائق» — a join across the FR-11 line, against a real mongo.
//
// The name belongs to HR and the register belongs to Fleet, and the two may not import each other.
// So HR declares WHERE names live (`DirectoryNameSource`, registered at module load) and Fleet's
// register performs the join without ever naming the collection. That is the arrangement under
// test, and it can only be tested end to end: the unit spec proves Fleet asks the seam, and this
// proves the seam's answer actually joins.
//
// Both shifts, deliberately. The two columns are two arrows on two different reference fields —
// «تفصل الصباحى عن المسائى كل واحد فى عمود» — and the failure that a single fixture would miss is
// the second column quietly ordering by the first driver.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { parseFleetSort } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getDirectoryNameSource } from '../../src/platform/directory';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const VEHICLE = new Types.ObjectId();

/**
 * Three people, and three readings that pair them CROSSWISE.
 *
 *   reading 1 · morning أحمد   · evening يوسف
 *   reading 2 · morning يوسف   · evening أحمد
 *   reading 3 · morning محمد   · evening —
 *
 * So the morning order and the evening order are different orders, and a register that joined the
 * wrong reference for the second column answers the first column's list.
 */
const AHMED = new Types.ObjectId();
const MOHAMED = new Types.ObjectId();
const YOUSSEF = new Types.ObjectId();
const NAMES = new Map([
  [String(AHMED), 'أحمد'],
  [String(MOHAMED), 'محمد'],
  [String(YOUSSEF), 'يوسف'],
]);

const plant = async (): Promise<void> => {
  // The employees are written STRAIGHT into the collection the seam names — this test may not
  // import HR either, and it does not have to: what it needs is documents where HR says they are.
  const source = getDirectoryNameSource();
  if (source === null) throw new Error('HR registered no name source — the seam is the fixture');
  await mongoose.connection.collection(source.collection).insertMany(
    [...NAMES].map(([id, name]) => ({
      _id: new Types.ObjectId(id),
      code: `E-${name}`,
      personal: { fullNameAr: name },
      isDeleted: false,
    })),
  );
  // ONE OPEN PERIOD PER CAR, which is a real invariant and a unique index («ux_open_period»):
  // a reading closes the previous period and opens the next, so only the LAST one has no closing
  // reading. `inReading` of entry k is identically `outReading` of entry k+1, and `km` is the
  // difference — the chain FR-2 keeps, written out here rather than approximated, because a
  // fixture that violates the collection's own rules is not a fixture of anything.
  const reading = (
    at: string,
    outReading: number,
    inReading: number | null,
    driver1: Types.ObjectId,
    driver2: Types.ObjectId | null,
  ) => ({
    vehicleId: VEHICLE,
    date: day(at),
    outReading,
    inReading,
    km: inReading === null ? null : inReading - outReading,
    driver1EmployeeId: driver1,
    driver2EmployeeId: driver2,
    notes: null,
    isDeleted: false,
    createdAt: day(at),
  });
  await FleetOdometerLogModel.collection.insertMany([
    reading('2026-01-01', 1000, 2000, AHMED, YOUSSEF),
    reading('2026-01-02', 2000, 3000, YOUSSEF, AHMED),
    reading('2026-01-03', 3000, null, MOHAMED, null),
  ]);
};

/** The readings the register answers with, named by their OUT reading — the row's own identity. */
const readings = async (sort: string): Promise<number[]> => {
  const page = await fleetOdometerRepository.listLogs({
    filter: { vehicleId: VEHICLE },
    page: 1,
    pageSize: 50,
    sorts: parseFleetSort(sort),
  });
  return page.items.map((doc) => doc.outReading as number);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plant();
}, 120_000);

afterAll(async () => {
  await FleetOdometerLogModel.deleteMany({ vehicleId: VEHICLE }).exec();
  const source = getDirectoryNameSource();
  if (source !== null) {
    await mongoose.connection
      .collection(source.collection)
      .deleteMany({ _id: { $in: [...NAMES.keys()].map((id) => new Types.ObjectId(id)) } });
  }
  await disconnectMongo();
  await replset?.stop();
});

describe('the seam is what carries the join', () => {
  it('is registered by HR at module load, and names HR’s own collection', () => {
    const source = getDirectoryNameSource();
    expect(source?.collection).toBe('hr_employees');
    expect(source?.nameField, 'the Arabic name every Fleet screen prints').toBe(
      'personal.fullNameAr',
    );
  });
});

describe('«اسم السائق الأول (صباحي)»', () => {
  it('orders the register by the MORNING driver’s name', () => {
    // أحمد · محمد · يوسف — an Arabic alphabet, not the order the readings were written in and not
    // the order their dates or their readings run in.
    return expect(readings('driver1Name:asc')).resolves.toEqual([1000, 3000, 2000]);
  });

  it('turns round, and takes the evening column with nothing', async () => {
    expect(await readings('driver1Name:desc')).toEqual([2000, 3000, 1000]);
  });
});

describe('«اسم السائق الثاني (مسائي)»', () => {
  it('orders by the EVENING driver — a DIFFERENT order, on a different reference', async () => {
    // أحمد is the evening driver of reading 2 and يوسف of reading 1, so this is the morning
    // answer with its first two swapped. A column joined against `driver1EmployeeId` by mistake
    // would answer the morning list here and look perfectly plausible.
    expect(await readings('driver2Name:asc')).toEqual([2000, 1000, 3000]);
  });

  it('sorts the reading nobody drove home LAST, whichever way the arrow points', async () => {
    // Mongo orders null BEFORE every value, so without the missing-value flag this reading would
    // open the ascending list — «رتب بإسم السائق» would answer with every row that has no driver.
    expect((await readings('driver2Name:asc')).at(-1)).toBe(3000);
    expect((await readings('driver2Name:desc')).at(-1), 'and last descending too').toBe(3000);
  });
});

describe('both columns at once', () => {
  it('lets the evening driver break the morning driver’s ties', async () => {
    // Nothing here ties on the morning driver, so the second column changes nothing — which is
    // itself the assertion: a second joined column must not reshuffle what the first decided.
    expect(await readings('driver1Name:asc,driver2Name:desc')).toEqual([1000, 3000, 2000]);
  });

  it('orders the WHOLE register, not the page — one row at a time walks the names', async () => {
    const pageOf = async (page: number): Promise<number[]> => {
      const answered = await fleetOdometerRepository.listLogs({
        filter: { vehicleId: VEHICLE },
        page,
        pageSize: 1,
        sorts: parseFleetSort('driver1Name:asc'),
      });
      return answered.items.map((doc) => doc.outReading as number);
    };
    expect([await pageOf(1), await pageOf(2), await pageOf(3)]).toEqual([[1000], [3000], [2000]]);
  });

  it('hands back the reading, with no joined name left on it', async () => {
    const answered = await fleetOdometerRepository.listLogs({
      filter: { vehicleId: VEHICLE },
      page: 1,
      pageSize: 1,
      sorts: parseFleetSort('driver1Name:asc'),
    });
    const doc = answered.items[0] as Record<string, unknown> | undefined;
    expect(doc?.['outReading']).toBe(1000);
    expect(doc).not.toHaveProperty('driver1Name');
    expect(Object.keys(doc ?? {}).filter((k) => k.startsWith('__sort_'))).toEqual([]);
  });
});
