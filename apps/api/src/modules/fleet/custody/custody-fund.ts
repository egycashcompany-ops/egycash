// «إجمالي العهدة» — the fund itself, beside what it paid for: «عاوز ازود اجمالى العهده فى الاحصايات و
// تكون فى الداس بورد».
//
// The fund is what the department's three letters move, less what the receipts paid out of it —
// the owner's word: «المفروض هيكون فى زرار تسوية العهدة و استعاضة العهدة و شحن العهدة كل واحد
// هيعمل اكشن معين». So:
//
//   «إجمالي العهدة» = Σ «شحن العهدة» − Σ custody receipts + Σ «استعاضة عهدة» − Σ «تسوية عهدة»
//
// Every live custody receipt counts, of every kind, from the beginning — a card's fuel and a
// dealership invoice never do. The fund may be negative: more was spent, or settled, than was ever
// charged into it (his own settlement letter does that). It is read here and nowhere else; the
// figures, the dashboard and «سجل العهدة» all carry this, and no filter changes it.
import { type ClientSession } from 'mongoose';
import { type FleetCustodyOperationKind } from '@ecms/contracts';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { RECEIPT_PIASTRES } from './custody-memo-totals';
import { FleetCustodyOperationModel } from './custody-operation.model';

/** Pounds → whole piastres: every sum of the fund is exact. */
export const toPiastres = (pounds: number): number => Math.round(pounds * 100);
/** Whole piastres → pounds, never `-0`. */
export const fromPiastres = (piastres: number): number => (piastres === 0 ? 0 : piastres / 100);

/** The four sums the fund is made of, each in EGP. */
export interface CustodyFundSums {
  charged: number;
  spent: number;
  replenished: number;
  settled: number;
}

/** «إجمالي العهدة» from its four sums — to the piastre, negatives allowed. */
export const fundOf = (sums: CustodyFundSums): number =>
  fromPiastres(
    toPiastres(sums.charged) -
      toPiastres(sums.spent) +
      toPiastres(sums.replenished) -
      toPiastres(sums.settled),
  );

export interface CustodyFundCount {
  count: number;
  /** EGP, to the piastre. */
  amount: number;
}

/** Everything the fund is made of, as one read. */
export interface CustodyFundTerms {
  /** «شحن العهدة». */
  charged: CustodyFundCount;
  /** The custody receipts — `count` is receipts. */
  spent: CustodyFundCount;
  /** «استعاضة عهدة», with the memos they brought back. */
  replenished: CustodyFundCount & { memos: number };
  /** «تسوية عهدة», with the licensing memos they took off. */
  settled: CustodyFundCount & { parts: number };
  fundTotal: number;
}

interface ReceiptSumRow {
  count: number;
  piastres: number;
}
interface OperationSumRow {
  _id: FleetCustodyOperationKind;
  count: number;
  piastres: number;
  memos: number;
  parts: number;
}

/** A sum taken in the database in whole piastres — `$sum` of pounds would carry binary residue. */
const PIASTRES = { $sum: RECEIPT_PIASTRES };

const readReceiptSums = async (session?: ClientSession): Promise<ReceiptSumRow | undefined> => {
  const [row] = await FleetReceiptModel.aggregate<ReceiptSumRow>([
    { $match: { isDeleted: false, source: 'custody' } },
    { $group: { _id: null, count: { $sum: 1 }, piastres: PIASTRES } },
  ])
    .session(session ?? null)
    .exec();
  return row;
};

const readOperationSums = async (session?: ClientSession): Promise<OperationSumRow[]> =>
  FleetCustodyOperationModel.aggregate<OperationSumRow>([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$kind',
        count: { $sum: 1 },
        piastres: PIASTRES,
        memos: { $sum: { $size: { $ifNull: ['$memos', []] } } },
        parts: { $sum: { $size: { $ifNull: ['$parts', []] } } },
      },
    },
  ])
    .session(session ?? null)
    .exec();

/**
 * The fund's terms. Inside a transaction (`session`) the two reads run one after the other — a
 * session cannot run operations in parallel — and see the transaction's own snapshot.
 */
export const readCustodyFundTerms = async (session?: ClientSession): Promise<CustodyFundTerms> => {
  const [receipts, operations] =
    session === undefined
      ? await Promise.all([readReceiptSums(), readOperationSums()])
      : [await readReceiptSums(session), await readOperationSums(session)];
  const op = (kind: FleetCustodyOperationKind) => operations.find((row) => row._id === kind);
  const countOf = (row: { count: number; piastres: number } | undefined): CustodyFundCount => ({
    count: row?.count ?? 0,
    amount: fromPiastres(row?.piastres ?? 0),
  });
  const charged = countOf(op('charge'));
  const spent = countOf(receipts);
  const replenished = { ...countOf(op('replenish')), memos: op('replenish')?.memos ?? 0 };
  const settled = { ...countOf(op('settle')), parts: op('settle')?.parts ?? 0 };
  return {
    charged,
    spent,
    replenished,
    settled,
    fundTotal: fundOf({
      charged: charged.amount,
      spent: spent.amount,
      replenished: replenished.amount,
      settled: settled.amount,
    }),
  };
};

/** The fund in EGP — may be negative. */
export const readCustodyFundTotal = async (): Promise<number> =>
  (await readCustodyFundTerms()).fundTotal;

/**
 * The bracket figure his letter prints, frozen on the operation so a reprint never changes:
 * «عهده اداره الحركه ( X )» on a replenishment is everything ever charged into the fund (his
 * 100,000), «من العهده ( X )» on a settlement is the fund just before it. A charge prints none.
 */
export const letterFigureOf = (
  kind: FleetCustodyOperationKind,
  terms: Pick<CustodyFundTerms, 'charged' | 'fundTotal'>,
): number | null =>
  kind === 'replenish' ? terms.charged.amount : kind === 'settle' ? terms.fundTotal : null;

// ── Days ──────────────────────────────────────────────────────────────────────────────────────

/** A moment's calendar day, as UTC midnight — how every day of the fund is stored. */
export const utcDay = (moment: Date): Date =>
  new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate()));

/** A stored day as the wire writes it: `YYYY-MM-DD`. */
export const dayKey = (day: Date): string => day.toISOString().slice(0, 10);

/**
 * A letter's default period: the first day of the earliest month to the last day of the latest,
 * over the days it covers (the memos' periods, the licensing memos' days) — the web's rule too.
 * `null` with no day at all.
 */
export const monthBounds = (days: readonly Date[]): { from: Date; to: Date } | null => {
  if (days.length === 0) return null;
  const times = days.map((day) => day.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  return {
    from: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)),
    to: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)),
  };
};

// ── «شحن العهدة»'s reason ─────────────────────────────────────────────────────────────────────

/**
 * His letter writes «و ذلك نظير <reason>», and the ledger «نظير <reason>»: the reason is kept
 * WITHOUT that word, or both would print «نظير نظير …». A clerk who types it anyway — alone, or
 * after «وذلك» — has it taken off the front; it is never searched for anywhere else.
 */
const LEADING_NAZIR = /^(?:و\s*ذلك\s+)?نظير(?:[\s:،,-]+|$)/u;

/** A charge's reason as it is stored: trimmed, with a leading «نظير» (or «وذلك نظير») taken off. */
export const chargeReasonOf = (reason: string): string =>
  reason.trim().replace(LEADING_NAZIR, '').trim();
