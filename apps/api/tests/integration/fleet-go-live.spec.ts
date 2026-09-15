// The vehicle go-live, against a real mongo — the three things the design rests on, in the order
// an operator meets them.
//
//   1. A refusal leaves the run UNCLAIMED, so the fix can simply be redeployed.
//   2. The run that succeeds claims it, and finishes it.
//   3. Every boot after that does nothing at all — including to a car an admin has since changed.
//   4. A run that DIED — a lease that ran out with the job unfinished — is taken over and finished.
//
// (3) is the one worth a real database. `applyImport` UPDATES a car it finds by code, so a step
// that ran on every boot would quietly restore every correction the company made, at the next
// restart, forever. The only thing standing between that and their data is the run's `done`, and
// a test that asserted the row exists would prove nothing about whether anybody honours it.
//
// (4) is why the mark became a lease: v1 was cut off in production between the vehicle types and
// the vehicles, and its once-only mark then kept every later boot away from the job.
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
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive, VEHICLE_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/vehicles';

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH = 'فرع الاختبار';
/** How /system spells the same branch — one hamza off the data, as production's were. */
const BRANCH_IN_SYSTEM = 'فرع الإختبار';

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

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: VEHICLE_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: unknown } | null>()
    .exec();

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

/** A refusal's row: written, with its reasons, and with a lease that has ALREADY lapsed. */
const expectRefused = async (reasons: Record<string, unknown>): Promise<void> => {
  const doc = await run();
  expect(doc, 'the refusal was written to the row').not.toBeNull();
  expect(doc?.status, 'not done').toBe('running');
  expect(doc?.outcome, 'with its reasons').toMatchObject({ refused: true, ...reasons });
  expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(Date.now());
};

describe('a refusal leaves the door open', () => {
  it('refuses a branch the organisation does not have, imports nothing, and SAYS SO on its row', async () => {
    // The branch is not a Fleet fact — HR, Gold and every user's data scope point at the same
    // registry — so the import will not invent one. What matters here is the SECOND half: it also
    // does not mark itself done, because the missing branch is precisely the thing somebody goes
    // and adds. And the third: the reason is on the row, where the screen can print it — a
    // refusal that lived only in the log was, for two deploys, indistinguishable from nothing.
    await runVehicleGoLive(dataDir);

    expect(await imported(), 'no car was written').toBe(0);
    await expectRefused({ reason: 'plan', missingBranches: [BRANCH], inactiveBranches: [] });
  });

  it('refuses a branch the organisation has DEACTIVATED — the check the service would fail on', async () => {
    // THE PRODUCTION SHAPE. `findByName` matched the branch, the run was claimed, and every car
    // then failed `assertBranch` inside the loop. The planner asks the service's question now.
    await branchService.create(
      { code: 'GOLIVE', name: { ar: BRANCH_IN_SYSTEM, en: BRANCH_IN_SYSTEM } },
      new Types.ObjectId().toString(),
    );
    await BranchModel.updateOne({ code: 'GOLIVE' }, { $set: { status: 'inactive' } }).exec();

    await runVehicleGoLive(dataDir);

    expect(await imported(), 'no car was written').toBe(0);
    await expectRefused({ reason: 'plan', missingBranches: [], inactiveBranches: [BRANCH] });
  });
});

describe('the run that can proceed, proceeds once', () => {
  it('imports the cars once the branch is active — over the refusal row, with no lease to wait out', async () => {
    await BranchModel.updateOne({ code: 'GOLIVE' }, { $set: { status: 'active' } }).exec();

    await runVehicleGoLive(dataDir);

    expect(await imported(), 'both cars landed').toBe(2);
    expect((await run())?.status, 'and the run marked itself done').toBe('done');
    // …in the branch /system spells with a hamza the data does not have.
    const branch = await BranchModel.findOne({ code: 'GOLIVE' }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
    expect(
      await FleetVehicleModel.countDocuments({ code: { $in: ['GOLIVE-1', 'GOLIVE-2'] }, branchId: branch?._id }).exec(),
      'matched by folded spelling',
    ).toBe(2);
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
    expect((await run())?.status, 'still done').toBe('done');
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

describe('a run that died is finished by the next boot', () => {
  it('takes over an expired lease, re-runs, and only then marks done', async () => {
    // Put the row back into the shape production was left in: claimed, unfinished, and its holder
    // long gone. A car is removed underneath it, so «took over and re-ran» is observable.
    await FleetGoLiveRunModel.updateOne(
      { key: VEHICLE_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();
    await FleetVehicleModel.deleteOne({ code: 'GOLIVE-2' }).exec();
    expect(await imported()).toBe(1);

    await runVehicleGoLive(dataDir);

    expect(await imported(), 'the missing car was put back by the take-over').toBe(2);
    const doc = await run();
    expect(doc?.status, 'and the take-over finished the job').toBe('done');
    expect(doc?.outcome, 'with its counts on record').toMatchObject({ created: 1, updated: 1 });
  });

  it('does NOT take over a lease that is still live — somebody else has it', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: VEHICLE_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() + 60_000) } },
    ).exec();
    await FleetVehicleModel.deleteOne({ code: 'GOLIVE-2' }).exec();

    await runVehicleGoLive(dataDir);

    expect(await imported(), 'nothing was imported under a live lease').toBe(1);
    expect((await run())?.status, 'and the lease is left as it was').toBe('running');
  });
});
