// Emptying the accidents screen, against a real mongo — «fleet/accidents امسح كل الحوادث اللى فيها».
//
// What is proved here is the boundary a source-reading test cannot see: every live file is
// deleted, NONE of them leaves the database («الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا
// بيز فقط»), a file that was already deleted keeps the day it was deleted, it waits for the
// import rather than running ahead of it, and it happens once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { ACCIDENTS_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/accidents';
import {
  ACCIDENTS_CLEAR_GO_LIVE_MARK,
  runAccidentsClearGoLive,
} from '../../src/modules/fleet/go-live/accidents-clear';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const EARLIER = new Date('2026-01-10T00:00:00.000Z');

/** Raw inserts: enough of a file for the step to have something to delete. */
const plant = async (): Promise<void> => {
  const vehicleId = new Types.ObjectId();
  await FleetAccidentModel.collection.insertMany([
    {
      vehicleId,
      occurredAt: new Date(),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      __v: 0,
    },
    {
      vehicleId,
      occurredAt: new Date(),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      __v: 3,
    },
    // Already deleted by somebody on the screen: it keeps its own day.
    {
      vehicleId,
      occurredAt: new Date(),
      isDeleted: true,
      deletedAt: EARLIER,
      deletedBy: null,
      __v: 1,
    },
  ]);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plant();
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('clearing the accidents screen', () => {
  it('waits for the import: refuses, claims nothing and deletes nothing while the book is not in', async () => {
    await runAccidentsClearGoLive();
    expect(await FleetAccidentModel.countDocuments({ isDeleted: false }).exec()).toBe(2);
    const row = await FleetGoLiveRunModel.findOne({ key: ACCIDENTS_CLEAR_GO_LIVE_MARK })
      .lean()
      .exec();
    expect(row?.status).toBe('running');
    expect(row?.outcome).toMatchObject({ refused: true, reason: 'accidents-not-done' });
  });

  it('deletes every live file SOFTLY once the import is done — all of them still in the database', async () => {
    const now = new Date();
    await FleetGoLiveRunModel.create({
      key: ACCIDENTS_GO_LIVE_MARK,
      status: 'done',
      leaseUntil: now,
      startedAt: now,
      finishedAt: now,
      outcome: {},
    });
    await runAccidentsClearGoLive();

    expect(
      await FleetAccidentModel.countDocuments({ isDeleted: false }).exec(),
      'the screen is empty',
    ).toBe(0);
    expect(
      await FleetAccidentModel.countDocuments({}).exec(),
      'and not one file left the database',
    ).toBe(3);

    const rows = await FleetAccidentModel.find({}).sort({ __v: 1 }).lean().exec();
    const versions = rows.map((row) => row.__v).sort((a, b) => a - b);
    // 0 → 1 and 3 → 4 for the two live files; the one already deleted is not touched (1).
    expect(versions).toEqual([1, 1, 4]);
    const already = rows.find((row) => row.deletedAt?.getTime() === EARLIER.getTime());
    expect(already, 'a file deleted earlier keeps the day it was deleted').toBeDefined();
    for (const row of rows) expect(row.deletedBy).toBeNull();

    const run = await FleetGoLiveRunModel.findOne({ key: ACCIDENTS_CLEAR_GO_LIVE_MARK })
      .lean()
      .exec();
    expect(run?.status).toBe('done');
    expect(run?.outcome).toEqual({ deleted: 2 });
  });

  it('happens once: a file recorded after the run stays on the screen', async () => {
    await FleetAccidentModel.collection.insertOne({
      vehicleId: new Types.ObjectId(),
      occurredAt: new Date(),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      __v: 0,
    });
    await runAccidentsClearGoLive();
    expect(await FleetAccidentModel.countDocuments({ isDeleted: false }).exec()).toBe(1);
  });
});
