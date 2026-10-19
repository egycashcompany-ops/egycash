// What one memo of a licensing record costs, split as his sheet splits it: «فيزا» and «نقدي».
//
// The same arithmetic as the board's `linesTotalExpression` (license-expense.repository.ts) — a
// line is its amount, none written being nothing, times its count — spelled once more for ONE memo
// in memory, because «تسوية عهدة» takes a memo (a renewal, or an extension) off the fund, not a
// record. It works in whole piastres, so 0.1 + 0.2 is 0.30 and never 0.30000000000000004.
import { type FleetLicenseExpensePaidBy } from '@ecms/contracts';

/** A memo's lines — all `partMoney` reads of them. */
export interface LicenseExpenseMoneyPart {
  items: readonly {
    amount: number | null | undefined;
    count: number | null | undefined;
    paidBy: FleetLicenseExpensePaidBy;
  }[];
}

export interface LicenseExpenseMoney {
  /** By the card. */
  visa: number;
  /** In cash. */
  cash: number;
  /** Both — always `visa + cash`, to the piastre. */
  total: number;
}

/** One line in piastres: its amount (none = 0) times its count (none = 1, as the expression). */
const linePiastres = (item: LicenseExpenseMoneyPart['items'][number]): number =>
  Math.round((item.amount ?? 0) * 100) * (item.count ?? 1);

const toPounds = (piastres: number): number => (piastres === 0 ? 0 : piastres / 100);

/** A memo's money; a memo that is not there costs nothing. */
export const partMoney = (
  part: LicenseExpenseMoneyPart | null | undefined,
): LicenseExpenseMoney => {
  let visa = 0;
  let cash = 0;
  for (const item of part?.items ?? []) {
    if (item.paidBy === 'visa') visa += linePiastres(item);
    else cash += linePiastres(item);
  }
  return { visa: toPounds(visa), cash: toPounds(cash), total: toPounds(visa + cash) };
};
