// The asset register RESTARTED, once, by the deploy — «شيل كل الأصول معادا AST-00005 وخليه
// AST-00001».
//
// Every asset but AST-00005 is deleted, AST-00005 takes the first code, and the counter is wound
// back so the next asset registered is AST-00002. The register was filled while the module was
// being tried out; the owner keeps the one real asset and starts the numbering again from it.
//
// SOFT, NOT HARD. The owner's standing rule for deleted data is «الداتا اللى ممسوحه متظهرش
// للمستخدم تبقى فى الداتا بيز فقط»: a deleted asset leaves every screen, list and count, and
// stays in the database. Each one gets what the register's own delete gives it — `isDeleted`,
// the day, its version bumped so an edit dialog open on a stale copy is refused.
//
// THE CODES ARE FREED, which is the one thing a normal delete never does. FR-1 makes a code
// permanent and unique across deleted rows too, so a deleted AST-00001 would block the rename and
// a deleted AST-00002 the next registration. Each deleted row's code becomes
// `retired:<code>:<id>` — still its own, still readable, and never a code the counter can hand out
// or a scan can resolve. Rows deleted earlier (registered in error) are freed the same way.
//
// WHAT GOES WITH THEM — what only exists for an asset: its custody intervals (or the people
// holding them would still show it on the custody register and the employees screen), its
// maintenance plans (or the preventive sweep would keep raising orders for a machine that is
// gone), its maintenance orders and its software installations (or a licence would still count a
// seat on it). What is LEFT ALONE: tickets, which are somebody's request in their own right and
// merely name an asset, and every asset's history and audit trail, which are history.
//
// ONCE PER DATABASE, and all or nothing: the work and its run row are one transaction
// (`go-live-run.model.ts`). It is decided ONCE, too — against the register as it stands on the
// first boot after the owner asked. When AST-00005 is not on it, the step deletes nothing and
// records that it refused, for good: otherwise a later boot, after the counter had handed out a
// new AST-00005, would empty a register nobody asked to empty. A second restart is a new key.
import { type Types } from 'mongoose';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ItAssetModel } from '../assets/asset.model';
import { ItAssetAssignmentModel } from '../assets/assignment.model';
import { ItAssetEventModel } from '../assets/asset-event.model';
import { ItCustodyReceiptModel } from '../assets/receipt.model';
import { ASSET_SEQUENCE_KEY, formatAssetCode } from '../assets/asset-number';
import { ItMaintenancePlanModel } from '../maintenance/plan.model';
import { ItMaintenanceOrderModel } from '../maintenance/order.model';
import { ItSoftwareInstallationModel } from '../software/installation.model';
import { setSequenceValue } from '../shared/sequence';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';

/** The run key — versioned, so a second restart is a decision and never a redeploy's accident. */
export const IT_ASSET_RESTART_MARK = 'go-live:it-asset-restart:v1';

/** The one asset the owner keeps, and the code it takes. */
export const KEPT_ASSET_CODE = 'AST-00005';
export const RESTARTED_ASSET_CODE = formatAssetCode(1);

/** A deleted asset's code, freed: its own code and id, in a form no allocation or scan produces. */
export const retiredAssetCode = (code: string, id: string): string => `retired:${code}:${id}`;

export type AssetRestartOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      keptAssetId: string;
      from: string;
      to: string;
      deletedAssets: number;
      deletedCodes: string[];
      freedEarlierDeleted: number;
      assignments: number;
      plans: number;
      orders: number;
      installations: number;
      receipts: number;
      nextCode: string;
    };

interface AssetRow {
  _id: Types.ObjectId;
  assetCode: string;
  isDeleted: boolean;
  deletedAt: Date | null;
}

/** Run the restart. Exported so a test can drive it against a real database. */
export const restartAssetRegister = async (at: Date = new Date()): Promise<AssetRestartOutcome> => {
  await ensureItGoLiveRunIndexes();
  return unitOfWork(async (session) => {
    // Inside the transaction: a second process that lost the race re-reads this on its retry and
    // finds the first one's row.
    if (await isItGoLiveRunDone(IT_ASSET_RESTART_MARK, session)) return { status: 'alreadyDone' };

    const kept = await ItAssetModel.findOne({ assetCode: KEPT_ASSET_CODE, isDeleted: false })
      .session(session)
      .lean<AssetRow>()
      .exec();
    if (kept === null) {
      // Recorded, not retried — see the header: the decision belongs to this register, not to
      // whatever the counter puts at AST-00005 later.
      const reason = `${KEPT_ASSET_CODE} is not on the register`;
      await recordItGoLiveRun(IT_ASSET_RESTART_MARK, { refused: true, reason }, session);
      return { status: 'refused', reason };
    }

    const others = await ItAssetModel.find({ _id: { $ne: kept._id } })
      .select({ _id: 1, assetCode: 1, isDeleted: 1, deletedAt: 1 })
      .session(session)
      .lean<AssetRow[]>()
      .exec();
    const live = others.filter((row) => !row.isDeleted);
    const liveIds = live.map((row) => row._id);

    // 1. Every other asset: deleted softly (an earlier deletion keeps its own date) and its code
    //    freed — before the rename below, which needs AST-00001 to be free.
    if (others.length > 0) {
      await ItAssetModel.bulkWrite(
        others.map((row) => ({
          updateOne: {
            filter: { _id: row._id },
            update: {
              $set: {
                assetCode: retiredAssetCode(row.assetCode, String(row._id)),
                isDeleted: true,
                deletedAt: row.isDeleted ? row.deletedAt : at,
                ...(row.isDeleted ? {} : { deletedBy: null }),
              },
              $inc: { __v: 1 },
            },
          },
        })),
        { session },
      );
    }

    // 2. What only exists for them.
    const gone = { assetId: { $in: liveIds }, isDeleted: false };
    const softly = { $set: { isDeleted: true, deletedAt: at, deletedBy: null }, $inc: { __v: 1 } };
    const assignments = await ItAssetAssignmentModel.updateMany(gone, softly, { session }).exec();
    const plans = await ItMaintenancePlanModel.updateMany(
      gone,
      { ...softly, $set: { ...softly.$set, active: false } },
      { session },
    ).exec();
    const orders = await ItMaintenanceOrderModel.updateMany(gone, softly, { session }).exec();
    const installations = await ItSoftwareInstallationModel.updateMany(gone, softly, {
      session,
    }).exec();
    // A receipt whose every line is gone has nothing left to stand for.
    const receipts = await ItCustodyReceiptModel.updateMany(
      { isDeleted: false, lines: { $not: { $elemMatch: { assetId: { $nin: liveIds } } } } },
      softly,
      { session },
    ).exec();

    // 3. The kept asset takes the first code — and says so in its own history.
    await ItAssetModel.updateOne(
      { _id: kept._id },
      { $set: { assetCode: RESTARTED_ASSET_CODE }, $inc: { __v: 1 } },
      { session },
    ).exec();
    await ItAssetEventModel.create(
      [
        {
          subjectId: kept._id,
          type: 'updated',
          at,
          actorUserId: null,
          actorName: '',
          metadata: { assetCode: { from: KEPT_ASSET_CODE, to: RESTARTED_ASSET_CODE } },
          notes: `أُعيد ترقيم الأصل من ${KEPT_ASSET_CODE} إلى ${RESTARTED_ASSET_CODE}`,
        },
      ],
      { session },
    );

    // 4. The counter: the next asset registered is AST-00002.
    await setSequenceValue(ASSET_SEQUENCE_KEY, 1, session);

    const outcome = {
      keptAssetId: String(kept._id),
      from: KEPT_ASSET_CODE,
      to: RESTARTED_ASSET_CODE,
      deletedAssets: live.length,
      deletedCodes: live.map((row) => row.assetCode),
      freedEarlierDeleted: others.length - live.length,
      assignments: assignments.modifiedCount,
      plans: plans.modifiedCount,
      orders: orders.modifiedCount,
      installations: installations.modifiedCount,
      receipts: receipts.modifiedCount,
      nextCode: formatAssetCode(2),
    };
    await recordItGoLiveRun(IT_ASSET_RESTART_MARK, outcome, session);
    return { status: 'done', ...outcome };
  });
};

/** Run it once and say what happened. Exported so a test can await it. */
export const runAssetRestartGoLive = async (): Promise<void> => {
  const outcome = await restartAssetRegister();
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: the asset register was NOT restarted — nothing was deleted, and the step will not run again',
    );
    return;
  }
  if (outcome.status === 'done') {
    logger.warn(
      outcome,
      `it go-live: every asset but ${KEPT_ASSET_CODE} was deleted (softly) and it is now ${RESTARTED_ASSET_CODE} — done, and never again`,
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the Fleet steps' terms (`startAccidentsClearGoLive`).
 */
export const startItAssetRestartGoLive = (): void => {
  if (isTest) return;
  void runAssetRestartGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: restarting the asset register failed — no boot was harmed',
    );
  });
};
