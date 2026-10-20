// What the custody memo («المذكرات») holding a receipt keeps as it is — the receipts screen's half of
// the API's `receiptChangeVerdict` (custody-memo-rules.ts), so the form never offers a change the
// server would refuse:
//
//   · on a memo still waiting for its «استعاضة»: the kind and what paid for it stay, and the
//     receipt is not deleted until it is taken off the memo; the amount, the date and the car may
//     change, and the memo's total follows them;
//   · on a memo already replenished: the amount, the date and the car stay too — the money came
//     back into the fund on that figure.
//
// The driver, the photo, «كم», the fuel type and the company stay editable either way.
import { type FleetReceiptDto } from '@ecms/contracts';

export type ReceiptMemoState = 'none' | 'pending' | 'replenished';

/** Where the receipt stands — `none` for a receipt in no memo (an older row with no field too). */
export const receiptMemoState = (row: Pick<FleetReceiptDto, 'memo'> | null): ReceiptMemoState => {
  const memo = row?.memo ?? null;
  if (memo === null) return 'none';
  return memo.replenishedAt === null ? 'pending' : 'replenished';
};

export interface ReceiptMemoLocks {
  kind: boolean;
  /** The card or the fund — the tick, the card and «كارت آخر». */
  source: boolean;
  amount: boolean;
  date: boolean;
  vehicle: boolean;
  /** The bin. */
  remove: boolean;
}

export const receiptMemoLocks = (row: Pick<FleetReceiptDto, 'memo'> | null): ReceiptMemoLocks => {
  const state = receiptMemoState(row);
  const held = state !== 'none';
  const replenished = state === 'replenished';
  return {
    kind: held,
    source: held,
    remove: held,
    amount: replenished,
    date: replenished,
    vehicle: replenished,
  };
};

/** «2026/10/05» — the boards' year-first day. */
export const memoDay = (day: string): string => day.slice(0, 10).replace(/-/gu, '/');
