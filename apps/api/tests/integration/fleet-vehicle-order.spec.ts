// «اى عربيات تتعرض من اول 150 وانت طالع ... وبعدين الملاكى» — against a real mongo.
//
// The rule is one sentence and three groups: the working fleet counting up from 150, then the
// cars whose code is written in words, then «الملاكى» below 150, counting up among themselves.
// It exists twice by necessity — a TypeScript function for the browser, an aggregation expression
// for the database — and the contract's own spec proves the function. THIS file is what proves
// the expression, because nothing but a database can evaluate one.
//
// It also proves the two AGREE, by walking the same codes through both and expecting one order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { compareFleetVehicleCodes, parseFleetSort } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { fleetVehicleRepository } from '../../src/modules/fleet/vehicles/vehicle.repository';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/**
 * Planted in an order that is NONE of the answers — not the expected one, and not its reverse.
 *
 * `1500` and `9` are the pair that a text sort gets wrong in both directions; `ميكروباص` is the
 * middle group; `61` and `149` are «الملاكى», and 149 is the boundary itself.
 */
const CODES = ['61', 'ميكروباص', '1500', '9', '150', '149', '151'];
const EXPECTED = ['150', '151', '1500', 'ميكروباص', '9', '61', '149'];

const ids = new Map<string, Types.ObjectId>();

const plant = async (): Promise<void> => {
  await FleetVehicleModel.collection.insertMany(
    CODES.map((code) => {
      const id = new Types.ObjectId();
      ids.set(code, id);
      return {
        _id: id,
        code,
        typeId: new Types.ObjectId(),
        plateNumber: `ORDER ${code}`,
        chassisNumber: `ORDCH-${code}`,
        motorNumber: `ORDMO-${code}`,
        joinedAt: day('2026-01-01'),
        licenseExpiresAt: day('2027-01-01'),
        licenseClassId: null,
        operationId: null,
        insuranceCompanyId: null,
        branchId: null,
        departmentId: null,
        radio: { issi: null, motorolaSn: null },
        status: 'active',
        statusReason: null,
        licenseImage: null,
        isDeleted: false,
        schemaVersion: 1,
        __v: 0,
        createdAt: day('2026-01-01'),
        updatedAt: day('2026-01-01'),
      };
    }),
  );
  // One reading per car, so the JOINED order can be read too — the four registers that reference
  // a vehicle all share one sort declaration, so proving one proves the shape of all four.
  await FleetOdometerLogModel.collection.insertMany(
    CODES.map((code) => ({
      vehicleId: ids.get(code) as Types.ObjectId,
      vehicleCode: null,
      date: day('2026-05-05'),
      outReading: 1000,
      inReading: null,
      km: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      driver1Name: null,
      driver2Name: null,
      notes: null,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: day('2026-05-05'),
    })),
  );
};

/** The seven planted cars, by the codes they came back in. */
const registryOrder = async (): Promise<string[]> => {
  const answered = await fleetVehicleRepository.listVehicles({
    filter: { _id: { $in: [...ids.values()] } },
    page: 1,
    pageSize: 50,
    sortBy: 'code',
    sortDir: 'asc',
  });
  return answered.items.map((doc) => doc.code);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plant();
}, 120_000);

afterAll(async () => {
  await FleetOdometerLogModel.deleteMany({ vehicleId: { $in: [...ids.values()] } }).exec();
  await FleetVehicleModel.deleteMany({ _id: { $in: [...ids.values()] } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('the registry', () => {
  it('reads 150 upward, then the worded cars, then «الملاكى»', async () => {
    expect(await registryOrder()).toEqual(EXPECTED);
  });

  it('does NOT sort the codes as text — «9» does not come before «150»', async () => {
    const answered = await registryOrder();
    expect(answered.indexOf('150')).toBeLessThan(answered.indexOf('9'));
    expect(answered.indexOf('151'), '1500 counts as one thousand five hundred').toBeLessThan(
      answered.indexOf('1500'),
    );
  });

  it('and the SERVER agrees with the browser, code for code', async () => {
    // The two implementations of one rule, walked over the same seven codes. A drift between
    // them shows here as two different arrays rather than as a screen somebody notices months on.
    expect(await registryOrder()).toEqual([...CODES].sort(compareFleetVehicleCodes));
  });

  it('reverses cleanly — «الملاكى» first, the working fleet last', async () => {
    const answered = await fleetVehicleRepository.listVehicles({
      filter: { _id: { $in: [...ids.values()] } },
      page: 1,
      pageSize: 50,
      sortBy: 'code',
      sortDir: 'desc',
    });
    expect(answered.items.map((doc) => doc.code)).toEqual([...EXPECTED].reverse());
  });

  it('orders the WHOLE registry, not the page — one car at a time walks the same order', async () => {
    const second = await fleetVehicleRepository.listVehicles({
      filter: { _id: { $in: [...ids.values()] } },
      page: 2,
      pageSize: 1,
      sortBy: 'code',
      sortDir: 'asc',
    });
    expect(second.items.map((doc) => doc.code)).toEqual([EXPECTED[1]]);
  });
});

describe('a register that REFERENCES a car', () => {
  it('orders by the car’s code in the same three groups', async () => {
    // The odometer log stores a `vehicleId`; the code is joined in before the page is cut, and
    // then ordered by the fleet's rule rather than by the text the join produced.
    const answered = await fleetOdometerRepository.listLogs({
      filter: { vehicleId: { $in: [...ids.values()] } },
      page: 1,
      pageSize: 50,
      sorts: parseFleetSort('vehicleCode:asc'),
    });
    const byId = new Map([...ids].map(([code, id]) => [String(id), code]));
    expect(answered.items.map((doc) => byId.get(String(doc.vehicleId)))).toEqual(EXPECTED);
  });
});
