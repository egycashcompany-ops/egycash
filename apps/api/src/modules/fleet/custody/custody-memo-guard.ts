// What the receipts screen may still do to a receipt that is a line of a custody memo — asked
// INSIDE the receipt's own edit or delete transaction, after it read the live receipt.
//
// The memo is written first (`lockForReceipt`, a native `$inc` no DTO carries): a «استعاضة», a memo
// edit or a memo delete running at the same moment writes that same document, so one of the two
// transactions meets a write conflict and runs again — the rule below is never decided on a memo
// state that is already stale.
import { type ClientSession, type Types } from 'mongoose';
import { BusinessRuleError } from '../../../shared/errors';
import { FleetCustodyMemoModel } from './custody-memo.model';
import { fleetCustodyMemoRepository } from './custody-memo.repository';
import { dayKey, receiptChangeVerdict, type ReceiptMemoFacts } from './custody-memo-rules';

interface HeldReceipt extends ReceiptMemoFacts {
  memoId?: Types.ObjectId | null;
}

interface MemoState {
  no: number;
  replenishedAt: Date | null;
  replenished: boolean;
}

/** The live memo holding the receipt — locked first — or `null` when it is on none. */
const holdingMemo = async (
  receipt: HeldReceipt,
  session: ClientSession,
): Promise<MemoState | null> => {
  if (receipt.memoId == null) return null;
  await fleetCustodyMemoRepository.lockForReceipt(String(receipt.memoId), session);
  const memo = await FleetCustodyMemoModel.findOne({ _id: receipt.memoId, isDeleted: false })
    .select({ no: 1, replenishmentId: 1, replenishedAt: 1 })
    .session(session)
    .lean<{ no: number; replenishmentId?: Types.ObjectId | null; replenishedAt?: Date | null }>()
    .exec();
  if (memo === null) return null;
  return {
    no: memo.no,
    replenishedAt: memo.replenishedAt ?? null,
    replenished: memo.replenishmentId != null,
  };
};

const replenishedOn = (memo: MemoState): string =>
  memo.replenishedAt === null ? '' : ` on ${dayKey(memo.replenishedAt)}`;

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
    `this receipt is on custody memo ${memo.no}, replenished${replenishedOn(memo)} — its amount, date, car, kind and payment can no longer change`,
  );
};

/** Refuses (422) deleting a receipt that is on a memo — pending or replenished. */
export const assertReceiptRemovable = async (
  live: HeldReceipt,
  session: ClientSession,
): Promise<void> => {
  const memo = await holdingMemo(live, session);
  if (memo === null) return;
  if (memo.replenished) {
    throw new BusinessRuleError(
      `this receipt is on custody memo ${memo.no}, replenished${replenishedOn(memo)} — it can no longer be deleted`,
    );
  }
  throw new BusinessRuleError(
    `this receipt is on custody memo ${memo.no} — take it off the memo first to delete it`,
  );
};
