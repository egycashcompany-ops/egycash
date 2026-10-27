// What the receipts screen may still do to a receipt that is a line of a custody memo — asked
// INSIDE the receipt's own edit or delete transaction, after it read the live receipt.
//
// The memo is written first (`lockForReceipt`, a native `$inc` no DTO carries): a «استعاضة», a memo
// edit or a memo delete running at the same moment writes that same document, so one of the two
// transactions meets a write conflict and runs again — the rule below is never decided on a memo
// state that is already stale.
import { Types, type ClientSession } from 'mongoose';
import { publishAuditedChange } from '../../../platform/realtime';
import { BusinessRuleError } from '../../../shared/errors';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { FleetCustodyMemoModel } from './custody-memo.model';
import { fleetCustodyMemoRepository } from './custody-memo.repository';
import { dayKey, receiptChangeVerdict, utcDay, type ReceiptMemoFacts } from './custody-memo-rules';

interface HeldReceipt extends ReceiptMemoFacts {
  memoId?: Types.ObjectId | null;
}

interface MemoState {
  no: number;
  replenishedAt: Date | null;
  /** Taken by a replenishment — held or transferred: the memo is frozen. */
  replenished: boolean;
  /** That replenishment still waits for its transfer. */
  held: boolean;
}

/** The live memo holding the receipt — locked first — or `null` when it is on none. */
const holdingMemo = async (
  receipt: HeldReceipt,
  session: ClientSession,
): Promise<MemoState | null> => {
  if (receipt.memoId == null) return null;
  await fleetCustodyMemoRepository.lockForReceipt(String(receipt.memoId), session);
  const memo = await FleetCustodyMemoModel.findOne({ _id: receipt.memoId, isDeleted: false })
    .select({ no: 1, replenishmentId: 1, replenishedAt: 1, replenishmentHeld: 1 })
    .session(session)
    .lean<{
      no: number;
      replenishmentId?: Types.ObjectId | null;
      replenishedAt?: Date | null;
      replenishmentHeld?: boolean;
    }>()
    .exec();
  if (memo === null) return null;
  const replenished = memo.replenishmentId != null;
  return {
    no: memo.no,
    replenishedAt: memo.replenishedAt ?? null,
    replenished,
    held: replenished && memo.replenishmentHeld === true,
  };
};

/** «replenished on X», or — while its replenishment waits for the transfer — «held since X». */
const takenBy = (memo: MemoState): string => {
  const day = memo.replenishedAt === null ? '' : dayKey(memo.replenishedAt);
  if (memo.held) {
    return `held by a replenishment${day === '' ? '' : ` of ${day}`} waiting for its transfer`;
  }
  return `replenished${day === '' ? '' : ` on ${day}`}`;
};

/** Refuses (422) a change the memo holding `live` does not allow — see `receiptChangeVerdict`. */
export const assertReceiptChangeAllowed = async (
  live: HeldReceipt,
  next: ReceiptMemoFacts,
  session: ClientSession,
): Promise<void> => {
  const memo = await holdingMemo(live, session);
  const verdict = receiptChangeVerdict(live, next, memo);
  if (memo === null || verdict === 'ok') return;
  if (verdict === 'kindOrSource') {
    throw new BusinessRuleError(
      `this receipt is on custody memo ${memo.no} — take it off the memo first to change its kind or what paid for it`,
    );
  }
  throw new BusinessRuleError(
    `this receipt is on custody memo ${memo.no}, ${takenBy(memo)} — its amount, date, car, kind and payment can no longer change`,
  );
};

/** Refuses (422) deleting a receipt that is on a memo — pending, held or replenished. */
export const assertReceiptRemovable = async (
  live: HeldReceipt,
  session: ClientSession,
): Promise<void> => {
  const memo = await holdingMemo(live, session);
  if (memo === null) return;
  if (memo.replenished) {
    throw new BusinessRuleError(
      `this receipt is on custody memo ${memo.no}, ${takenBy(memo)} — it can no longer be deleted`,
    );
  }
  throw new BusinessRuleError(
    `this receipt is on custody memo ${memo.no} — take it off the memo first to delete it`,
  );
};

const oidOf = (id: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

/** A memo's period before and after a line's receipt moved — for the memo's own audit line. */
export interface MemoPeriodMove {
  memoId: string;
  before: { from: string; to: string };
  after: { from: string; to: string };
}

/**
 * A PENDING memo's period follows a line whose receipt moved to another day (the receipts screen
 * may still change a pending memo's date — `receiptChangeVerdict`). An end that sat on the lines'
 * own first (last) day — the period the memo works out by itself — moves to their new first
 * (last) day; an end typed wider stays, widened only to take in the moved receipt's new day. So
 * «المذكرات»'s period filter and a «استعاضة»'s default month always cover the memo's own lines.
 *
 * Called inside the receipt's edit transaction, after `assertReceiptChangeAllowed` locked the memo.
 * `__v` moves, so an editor open on the memo goes stale rather than writing the old period back.
 * Returns the move for the audit, or `null` when the period stays as it is.
 */
export const followReceiptDay = async (
  live: HeldReceipt & { _id: Types.ObjectId; date: Date },
  nextDate: Date,
  by: string,
  session: ClientSession,
): Promise<MemoPeriodMove | null> => {
  const was = utcDay(live.date).getTime();
  const now = utcDay(nextDate).getTime();
  if (live.memoId == null || was === now) return null;
  const memo = await FleetCustodyMemoModel.findOne({
    _id: live.memoId,
    isDeleted: false,
    replenishmentId: null,
  })
    .select({ from: 1, to: 1, lines: 1 })
    .session(session)
    .lean<{ _id: Types.ObjectId; from: Date; to: Date; lines: { receiptId: Types.ObjectId }[] }>()
    .exec();
  if (memo === null) return null;
  const others = await FleetReceiptModel.find({
    _id: { $in: memo.lines.map((line) => line.receiptId).filter((id) => !id.equals(live._id)) },
    isDeleted: false,
  })
    .select({ date: 1 })
    .session(session)
    .lean<{ date: Date }[]>()
    .exec();
  const days = others.map((row) => utcDay(row.date).getTime());
  const first0 = Math.min(...days, was);
  const last0 = Math.max(...days, was);
  const first1 = Math.min(...days, now);
  const last1 = Math.max(...days, now);
  const from0 = memo.from.getTime();
  const to0 = memo.to.getTime();
  const from = from0 === first0 ? first1 : Math.min(from0, now);
  const to = to0 === last0 ? last1 : Math.max(to0, now);
  if (from === from0 && to === to0) return null;
  await FleetCustodyMemoModel.collection.updateOne(
    { _id: memo._id },
    {
      $set: { from: new Date(from), to: new Date(to), updatedAt: new Date(), updatedBy: oidOf(by) },
      $inc: { __v: 1 },
    },
    { session },
  );
  return {
    memoId: String(memo._id),
    before: { from: dayKey(memo.from), to: dayKey(memo.to) },
    after: { from: dayKey(new Date(from)), to: dayKey(new Date(to)) },
  };
};

/**
 * The receipts screen shows each receipt's memo (its «مذكرة رقم N» chip) and the locks that follow
 * from it, but a memo write is audited — and so announced — on the custody topics only, which a
 * receipts clerk without `fleetCustody.view` never joins. One signal on the receipts' own topic per
 * memo write (not per receipt) makes their open list read again. Best-effort, as every signal is.
 */
export const signalReceiptsOfMemo = (memoId: string): void => {
  publishAuditedChange({
    entityRef: { moduleId: 'fleet', entityType: 'receipt', entityId: memoId },
    action: 'update',
    at: new Date().toISOString(),
  });
};
