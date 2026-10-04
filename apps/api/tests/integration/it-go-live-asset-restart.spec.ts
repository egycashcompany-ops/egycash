// The IT asset register restarted, against a real mongo — «شيل كل الأصول معادا AST-00005 وخليه
// AST-00001».
//
// What is proved here is what a source-reading test cannot see: AST-00005 becomes AST-00001 and
// keeps everything it had, every other asset leaves the screens and NONE leaves the database
// («الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط»), what only existed for them goes
// with them, the next code handed out is AST-00002 — and the decision is taken once, including
// the decision to refuse when AST-00005 is not there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { ItAssetAssignmentModel } from '../../src/modules/it/assets/assignment.model';
import { ItAssetEventModel } from '../../src/modules/it/assets/asset-event.model';
import { nextAssetCode } from '../../src/modules/it/assets/asset-sequence';
import { ItMaintenancePlanModel } from '../../src/modules/it/maintenance/plan.model';
import { ItMaintenanceOrderModel } from '../../src/modules/it/maintenance/order.model';
import { ItSoftwareInstallationModel } from '../../src/modules/it/software/installation.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import {
  IT_ASSET_RESTART_MARK,
  restartAssetRegister,
  retiredAssetCode,
} from '../../src/modules/it/go-live/asset-restart';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const EARLIER = new Date('2026-01-10T00:00:00.000Z');
const BRANCH = new Types.ObjectId();
const CATEGORY = new Types.ObjectId();

/** Raw inserts: enough of an asset for the step to judge it. */
const plantAsset = async (
  assetCode: string,
  extra: Record<string, unknown> = {},
): Promise<Types.ObjectId> => {
  const _id = new Types.ObjectId();
  await ItAssetModel.collection.insertOne({
    _id,
    assetCode,
    name: `Asset ${assetCode}`,
    categoryId: CATEGORY,
    status: 'inStock',
    branchId: BRANCH,
    currentAssignmentId: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    __v: 0,
    ...extra,
  });
  return _id;
};

/** A row that only exists for its asset — custody, a plan, an order, an installation. */
const plantFor = async (
  collection: { insertOne: (doc: Record<string, unknown>) => Promise<unknown> },
  assetId: Types.ObjectId,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  await collection.insertOne({
    assetId,
    branchId: BRANCH,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    __v: 0,
    ...extra,
  });
};

const codeOf = async (id: Types.ObjectId): Promise<string | undefined> =>
  (await ItAssetModel.findById(id).lean().exec())?.assetCode;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('restarting the IT asset register', () => {
  const early: Types.ObjectId[] = [];

  it('refuses — deleting nothing — when AST-00005 is not on the register, and records it for good', async () => {
    for (const code of ['AST-00001', 'AST-00002', 'AST-00003', 'AST-00004']) {
      early.push(await plantAsset(code));
    }

    const outcome = await restartAssetRegister();

    expect(outcome.status).toBe('refused');
    expect(await ItAssetModel.countDocuments({ isDeleted: false }).exec()).toBe(4);
    const run = await ItGoLiveRunModel.findOne({ key: IT_ASSET_RESTART_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ refused: true });

    // A later AST-00005 — the counter's next asset — must not reopen a decision already taken.
    const later = await plantAsset('AST-00005');
    expect((await restartAssetRegister()).status).toBe('alreadyDone');
    expect(await ItAssetModel.countDocuments({ isDeleted: false }).exec()).toBe(5);
    await ItAssetModel.collection.deleteOne({ _id: later });

    // TEST ONLY: forget the refusal, so the same database can show the restart itself.
    await ItGoLiveRunModel.deleteMany({}).exec();
  });

  it('keeps AST-00005 as AST-00001 and deletes every other asset SOFTLY, with what was only theirs', async () => {
    const kept = await plantAsset('AST-00005', { status: 'assigned' });
    await plantFor(ItAssetAssignmentModel.collection, kept, { returnedAt: null });
    const doomed = await plantAsset('AST-00006', { status: 'assigned' });
    await plantFor(ItAssetAssignmentModel.collection, doomed, { returnedAt: null });
    await plantFor(ItMaintenancePlanModel.collection, doomed, { active: true });
    await plantFor(ItMaintenanceOrderModel.collection, doomed, { status: 'open' });
    await plantFor(ItSoftwareInstallationModel.collection, doomed, { removedAt: null });
    // Deleted earlier (registered in error): it keeps its own day, and frees its code too.
    const deletedEarlier = await plantAsset('AST-00007', {
      isDeleted: true,
      deletedAt: EARLIER,
      __v: 2,
    });

    const outcome = await restartAssetRegister();

    expect(outcome).toMatchObject({
      status: 'done',
      from: 'AST-00005',
      to: 'AST-00001',
      deletedAssets: 5,
      freedEarlierDeleted: 1,
      assignments: 1,
      plans: 1,
      orders: 1,
      installations: 1,
    });

    // The one asset kept: its new code, still live, its custody untouched.
    const keptRow = await ItAssetModel.findById(kept).lean().exec();
    expect(keptRow?.assetCode).toBe('AST-00001');
    expect(keptRow?.isDeleted).toBe(false);
    expect(
      await ItAssetAssignmentModel.countDocuments({ assetId: kept, isDeleted: false }).exec(),
    ).toBe(1);
    const history = await ItAssetEventModel.findOne({ subjectId: kept, type: 'updated' })
      .lean()
      .exec();
    expect(history?.metadata).toEqual({ assetCode: { from: 'AST-00005', to: 'AST-00001' } });

    // Off the screens, never out of the database — every row is still there.
    expect(await ItAssetModel.countDocuments({ isDeleted: false }).exec()).toBe(1);
    expect(await ItAssetModel.countDocuments({}).exec()).toBe(7);
    for (const [id, code] of [
      [early[0], 'AST-00001'],
      [doomed, 'AST-00006'],
    ] as const) {
      expect(await codeOf(id as Types.ObjectId)).toBe(retiredAssetCode(code, String(id)));
    }
    const earlierRow = await ItAssetModel.findById(deletedEarlier).lean().exec();
    expect(earlierRow?.deletedAt?.getTime(), 'an earlier deletion keeps its own day').toBe(
      EARLIER.getTime(),
    );
    expect(earlierRow?.assetCode).toBe(retiredAssetCode('AST-00007', String(deletedEarlier)));

    // What only existed for the deleted asset went with it.
    expect(
      await ItAssetAssignmentModel.countDocuments({ assetId: doomed, isDeleted: false }).exec(),
    ).toBe(0);
    const plan = await ItMaintenancePlanModel.findOne({ assetId: doomed }).lean().exec();
    expect(plan?.isDeleted).toBe(true);
    expect(plan?.active).toBe(false);
    expect(
      await ItMaintenanceOrderModel.countDocuments({ assetId: doomed, isDeleted: false }).exec(),
    ).toBe(0);
    expect(
      await ItSoftwareInstallationModel.countDocuments({
        assetId: doomed,
        isDeleted: false,
      }).exec(),
    ).toBe(0);

    // The numbering starts again: the next asset registered is AST-00002.
    expect(await nextAssetCode()).toBe('AST-00002');
  });

  it('happens once: an asset registered after the restart stays', async () => {
    const after = await plantAsset('AST-00003');
    expect((await restartAssetRegister()).status).toBe('alreadyDone');
    expect((await ItAssetModel.findById(after).lean().exec())?.isDeleted).toBe(false);
  });
});
