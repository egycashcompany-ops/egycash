// What a memo adds up to — never stored, always read from its receipts, so an amount corrected on
// the receipts screen moves the memo's total with it (while the memo is not replenished yet; a
// replenished memo's receipts keep their amounts — see `custody-memo-guard.ts`).
//
// Summed in INTEGER PIASTRES in the database: 0.1 + 0.2 is 0.30000000000000004 as doubles, and a
// memo of three thousand lines must still print the same figure as its rows add up to by hand.
import { type ClientSession, type Types } from 'mongoose';
import { FleetReceiptModel } from '../receipts/receipt.model';

export interface CustodyMemoTotals {
  /** Its live receipts. */
  receipts: number;
  /** Their amounts, to the piastre. */
  total: number;
}

const ZERO: CustodyMemoTotals = { receipts: 0, total: 0 };

/**
 * memo id → its receipts and total, for every memo given (zeros for one with none). One
 * aggregate over the receipts' own link, in `session` when given — so a «استعاضة» reads exactly
 * the amounts its transaction sees.
 */
export const readMemoTotals = async (
  memos: readonly { _id: Types.ObjectId }[],
  session?: ClientSession,
): Promise<Map<string, CustodyMemoTotals>> => {
  const out = new Map<string, CustodyMemoTotals>(memos.map((memo) => [String(memo._id), ZERO]));
  if (memos.length === 0) return out;
  const rows = await FleetReceiptModel.aggregate<{
    _id: Types.ObjectId;
    receipts: number;
    piastres: number;
  }>([
    {
      $match: {
        source: 'custody',
        memoId: { $in: memos.map((memo) => memo._id) },
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$memoId',
        receipts: { $sum: 1 },
        piastres: { $sum: { $round: [{ $multiply: ['$amount', 100] }, 0] } },
      },
    },
  ])
    .session(session ?? null)
    .exec();
  for (const row of rows) {
    out.set(String(row._id), { receipts: row.receipts, total: Math.round(row.piastres) / 100 });
  }
  return out;
};

/** Σ of several memos' totals, to the piastre. */
export const sumMemoTotals = (totals: Iterable<CustodyMemoTotals>): CustodyMemoTotals => {
  let receipts = 0;
  let piastres = 0;
  for (const entry of totals) {
    receipts += entry.receipts;
    piastres += Math.round(entry.total * 100);
  }
  return { receipts, total: piastres / 100 };
};
