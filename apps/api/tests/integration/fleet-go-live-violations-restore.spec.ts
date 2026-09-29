// The ticks the violations reload took back, given back — against a real mongo.
//
//   1. A fine a person ticked on the 25th, swept by the reload, gets its tick back on the book's
//      copy — found by the import's key on the car it sat on at the cutoff.
//   2. A car's year ticked on the 26th is ticked again on the book's rows of that block.
//   3. A change made BEFORE the 24th is not put back, and a book row corrected since the reload
//      keeps that correction.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import {
  VIOLATIONS_RELOAD_CUTOFF,
  VIOLATIONS_RELOAD_MARK,
} from '../../src/modules/fleet/go-live/violations-reload';
import {
  VIOLATIONS_RESTORE_MARK,
  runViolationsRestoreGoLive,
} from '../../src/modules/fleet/go-live/violations-restore';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const car = new Types.ObjectId();
const otherCar = new Types.ObjectId();
const type = new Types.ObjectId();
const person = new Types.ObjectId();
const BEFORE = new Date('2026-09-20T09:00:00.000Z');
const SWEPT_AT = new Date('2026-09-29T15:00:00.000Z');
const RELOAD_DONE = new Date('2026-09-29T15:05:00.000Z');

const statement = (o: Record<string, unknown>) => ({
  kind: 'vehicle',
  vehicleId: car,
  vehicleCode: null,
  violationTypeId: type,
  year: 2026,
  count: 1,
  unitValue: 500,
  amount: 500,
  date: null,
  filedYear: null,
  homeVehicleId: null,
  driverEmployeeId: null,
  driverName: null,
  collected: false,
  schemaVersion: 1,
  createdBy: null,
  updatedBy: null,
  __v: 0,
  ...o,
});

/** The swept first-import copy and the reload's copy of the same book row. */
const pair = async (
  count: number,
  swept: Record<string, unknown>,
  book: Record<string, unknown> = {},
) => {
  const sweptId = new Types.ObjectId();
  const bookId = new Types.ObjectId();
  await FleetViolationModel.collection.insertMany([
    statement({
      _id: sweptId,
      count,
      createdAt: BEFORE,
      updatedAt: SWEPT_AT,
      isDeleted: true,
      deletedAt: SWEPT_AT,
      deletedBy: null,
      ...swept,
    }),
    statement({
      _id: bookId,
      count,
      fromOldBook: true,
      createdAt: SWEPT_AT,
      updatedAt: SWEPT_AT,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      ...book,
    }),
  ]);
  return { sweptId, bookId };
};

const audit = async (
  entityId: string,
  at: Date,
  changes: { field: string; old: unknown; new: unknown }[],
) =>
  AuditLogModel.create({
    entityRef: { moduleId: 'fleet', entityType: 'violation', entityId },
    action: 'update',
    changes,
    actor: { userId: person, ip: null, userAgent: null },
    requestId: null,
    at,
  });

const collectedOf = async (id: Types.ObjectId): Promise<boolean> =>
  ((await FleetViolationModel.findById(id).lean().exec()) as { collected: boolean }).collected;

let ticked: { sweptId: Types.ObjectId; bookId: Types.ObjectId };
let tickedEarly: { sweptId: Types.ObjectId; bookId: Types.ObjectId };
let changedSince: { sweptId: Types.ObjectId; bookId: Types.ObjectId };
let yearBlock: Types.ObjectId[] = [];

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  // 1. Ticked on the 25th.
  ticked = await pair(1, { collected: true });
  await audit(String(ticked.sweptId), new Date('2026-09-25T08:00:00Z'), [
    { field: 'collected', old: false, new: true },
  ]);
  // 3a. Ticked on the 22nd — before the start the owner named.
  tickedEarly = await pair(2, { collected: true });
  await audit(String(tickedEarly.sweptId), new Date('2026-09-22T08:00:00Z'), [
    { field: 'collected', old: false, new: true },
  ]);
  // 3b. Its amount corrected on the 25th — but the book's copy was corrected again since the
  //     reload, to something else: that later correction stands.
  changedSince = await pair(3, { amount: 450 }, { __v: 4, amount: 999 });
  await audit(String(changedSince.sweptId), new Date('2026-09-25T09:00:00Z'), [
    { field: 'amount', old: 500, new: 450 },
  ]);
  // 2. A whole year of another car, ticked on the 26th.
  const block = [new Types.ObjectId(), new Types.ObjectId()];
  await FleetViolationModel.collection.insertMany(
    block.map((_id, index) =>
      statement({
        _id,
        vehicleId: otherCar,
        count: 10 + index,
        fromOldBook: true,
        createdAt: SWEPT_AT,
        updatedAt: SWEPT_AT,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      }),
    ),
  );
  yearBlock = block;
  await audit(`${String(otherCar)}:2026`, new Date('2026-09-26T08:00:00Z'), [
    { field: 'collected', old: false, new: true },
  ]);

  await FleetGoLiveRunModel.create({
    key: VIOLATIONS_RELOAD_MARK,
    status: 'done',
    leaseUntil: RELOAD_DONE,
    startedAt: SWEPT_AT,
    finishedAt: RELOAD_DONE,
    outcome: {},
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('putting back what was done from the 24th on', () => {
  it('ticks the book’s copy of a fine ticked on the 25th, and the whole year ticked on the 26th', async () => {
    expect(VIOLATIONS_RELOAD_CUTOFF.toISOString()).toBe('2026-09-23T21:00:00.000Z');
    await runViolationsRestoreGoLive();

    expect(await collectedOf(ticked.bookId), 'the 25th’s tick is back').toBe(true);
    for (const id of yearBlock) expect(await collectedOf(id), 'the year’s tick is back').toBe(true);
    expect(await collectedOf(tickedEarly.bookId), 'a tick from the 22nd is not').toBe(false);
    const since = await FleetViolationModel.findById(changedSince.bookId).lean().exec();
    expect(since?.amount, 'a copy corrected since the reload keeps its correction').toBe(999);

    const run = await FleetGoLiveRunModel.findOne({ key: VIOLATIONS_RESTORE_MARK }).lean().exec();
    expect(run?.status).toBe('done');
    expect(run?.outcome).toMatchObject({
      restoredFields: { collected: 1 },
      yearTicksRestored: 2,
      keptSinceReload: [`${String(changedSince.bookId)}: amount`],
    });
  });

  it('happens once', async () => {
    await FleetViolationModel.updateOne(
      { _id: ticked.bookId },
      { $set: { collected: false } },
    ).exec();
    await runViolationsRestoreGoLive();
    expect(await collectedOf(ticked.bookId)).toBe(false);
  });
});
