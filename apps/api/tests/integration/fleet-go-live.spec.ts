// The vehicle go-live, against a real mongo — the three things the design rests on, in the order
// an operator meets them.
//
//   1. A refusal leaves the mark UNCLAIMED, so the fix can simply be redeployed.
//   2. The run that succeeds claims it.
//   3. Every boot after that does nothing at all — including to a car an admin has since changed.
//
// (3) is the one worth a real database. `applyImport` UPDATES a car it finds by code, so a step
// that ran on every boot would quietly restore every correction the company made, at the next
// restart, forever. The only thing standing between that and their data is the mark, and a test
// that asserted the mark row exists would prove nothing about whether anybody honours it.
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { branchService } from '../../src/platform/organization';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetSweepMarkModel } from '../../src/modules/fleet/sweeps/sweep-mark.model';
import { runVehicleGoLive, VEHICLE_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/vehicles';

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH = 'فرع الاختبار';

/** Two cars in the handover's own shape — enough to prove the mark, which is what is under test. */
const CARS = [
  {
    car_type: 'سوزوكى',
    car_code: 'GOLIVE-1',
    plate_num: 'ج ك ق 1111',
    chassis_num: 'CH-GOLIVE-1',
    motor_num: 'MO-GOLIVE-1',
    joining_date: { $date: '2025-02-24T00:00:00.000Z' },
    expiry_date: { $date: '2026-08-03T00:00:00.000Z' },
    branch: BRANCH,
    deleted: 0,
    status: 1,
    issi: '',
    sn_motorola: '',
  },
  {
    car_type: 'سوزوكى',
    car_code: 'GOLIVE-2',
    plate_num: 'ج ك ق 2222',
    chassis_num: 'CH-GOLIVE-2',
    motor_num: 'MO-GOLIVE-2',
    joining_date: { $date: '2025-02-24T00:00:00.000Z' },
    expiry_date: { $date: '2026-08-03T00:00:00.000Z' },
    branch: BRANCH,
    deleted: 0,
    status: 1,
    issi: '',
    sn_motorola: '',
  },
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const markCount = async (): Promise<number> =>
  FleetSweepMarkModel.countDocuments({ key: VEHICLE_GO_LIVE_MARK }).exec();

const imported = async (): Promise<number> =>
  FleetVehicleModel.countDocuments({ code: { $in: ['GOLIVE-1', 'GOLIVE-2'] } }).exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-'));
  await writeFile(join(dataDir, 'cars.json'), JSON.stringify(CARS), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });

  // The import authors every row as the seeded admin, exactly as a person's write is authored.
  await userService.create(
    {
      email: env.SEED_ADMIN_EMAIL,
      firstName: { ar: 'مدير', en: 'Admin' },
      lastName: { ar: 'النظام', en: 'System' },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('a refusal leaves the door open', () => {
  it('refuses a branch the organisation does not have, and claims NOTHING', async () => {
    // The branch is not a Fleet fact — HR, Gold and every user's data scope point at the same
    // registry — so the import will not invent one. What matters here is the SECOND half: it also
    // does not mark itself done, because the missing branch is precisely the thing somebody goes
    // and adds.
    await runVehicleGoLive(dataDir);

    expect(await imported(), 'no car was written').toBe(0);
    expect(await markCount(), 'and the mark is still free').toBe(0);
  });
});

describe('the run that can proceed, proceeds once', () => {
  it('imports the cars once the branch exists', async () => {
    await branchService.create(
      { code: 'GOLIVE', name: { ar: BRANCH, en: BRANCH } },
      new Types.ObjectId().toString(),
    );

    await runVehicleGoLive(dataDir);

    expect(await imported(), 'both cars landed').toBe(2);
    expect(await markCount(), 'and the run marked itself done').toBe(1);
  });

  it('a second boot does not touch a car the company has since corrected', async () => {
    // THE WHOLE POINT. `applyImport` updates by code, so without the mark this second call would
    // put the imported plate straight back over the corrected one.
    await FleetVehicleModel.updateOne(
      { code: 'GOLIVE-1' },
      { $set: { plateNumber: 'ص ح ح 9999' } },
    ).exec();

    await runVehicleGoLive(dataDir);

    const car = await FleetVehicleModel.findOne({ code: 'GOLIVE-1' }, { plateNumber: 1 })
      .lean<{ plateNumber: string }>()
      .exec();
    expect(car?.plateNumber, "the admin's correction survived the boot").toBe('ص ح ح 9999');
    expect(await imported(), 'and nothing was duplicated').toBe(2);
    expect(await markCount(), 'the mark is still exactly one row').toBe(1);
  });

  it('writes nothing at all on a later boot — not even a version bump', async () => {
    // The sharper half of the same guarantee. The first draft of this case asserted that a car the
    // company had DELETED stayed deleted, and that case passed with the mark removed — `update`
    // does not clear `isDeleted`, so it was proving a property of the update path rather than
    // anything about the mark. `__v` is the honest witness: every `fleetVehicleService.update`
    // bumps it, so a boot that wrote would show here even when it wrote the identical values.
    const before = await FleetVehicleModel.findOne({ code: 'GOLIVE-2' }, { __v: 1 })
      .lean<{ __v: number }>()
      .exec();

    await runVehicleGoLive(dataDir);

    const after = await FleetVehicleModel.findOne({ code: 'GOLIVE-2' }, { __v: 1 })
      .lean<{ __v: number }>()
      .exec();
    expect(after?.__v, 'the row was not written again').toBe(before?.__v);
  });
});
