// «لوحة تحكم العهدة» — the third tab of SCREEN 1 «العهدة»: the fund's part of the dashboard, as a
// page under the fund's head instead of a full-screen modal, in the modal's own order:
//   the fund's alerts (`CustodyAlerts` with no spend line: the double fuelling and the photo audit
//   are the spend's, on «لوحة تحكم المصروفات») · «العهدة الآن» (`CustodyFundNow`) · «مبالغ صُرفت ولم
//   تُستعَض بعد» + «مصروفات تراخيص لم تُسوَّ بعد» · «إجمالي العهدة بعد كل عملية» + «آخر عمليات العهدة».
// It never asks `GET /fleet/custody/dashboard`: every card reads the fund's summary, its candidates
// or its ledger, unfiltered — this tab has no filters (they stayed with the spend). The cards'
// «استعاضة العهدة» / «تسوية العهدة» open the head's dialogs (`?fund=`); a receipts line of the
// history is a link to «مصروفات العهدة» over its days.
import { useCustodyFundSummary } from '../api/fleet-queries';
import { useFundParam } from './CustodyFundActions';
import { CustodyAlerts } from './CustodyDashboard';
import {
  CUSTODY_FUND_ROW,
  CustodyFundNow,
  CustodyFundSteps,
  CustodyRecentOps,
  CustodySettleCard,
  CustodyWaitingCard,
  useCustodyFundAlerts,
} from './CustodyDashboardFund';

/** No spend line on the fund's banner — those are «لوحة تحكم المصروفات»'s. */
const NO_SPEND_ALERTS = { doubleFuel: [], receiptsWithoutPhoto: 0, duplicateReceipts: 0 };
/**
 * «العهدة الآن»'s five figures a size down (`text-xl`), as the dashboard's own spend figures go from
 * 1,536px: under the shell each tile is about 215px, and «300,000.00» would push its «ج.م.» onto a
 * line of its own.
 */
const FORMULA_FIT = '[&_[data-custody-fund-value]]:!text-xl [&_[data-ledger-term-value]]:!text-xl';
/**
 * The history's two cards one under the other — each card's own `lg:col-span-*` overruled. In the
 * modal they stood seven twelfths and five; under the shell with the menu open the page is about
 * 1,190px, and «آخر عمليات العهدة» at five twelfths would run its lines into each other.
 */
const HISTORY_ROW = 'grid grid-cols-1 gap-5 [&>section]:!col-span-full';

export const CustodyFundDashboard = ({
  now,
}: {
  /** Today, for the fund's ages — fixed by the specs. */
  now?: number | undefined;
}): JSX.Element => {
  const [, setFund] = useFundParam();
  const fund = useCustodyFundSummary();
  const fundLines = useCustodyFundAlerts(fund.data?.fundTotal, now);
  const today = now === undefined ? {} : { now };
  return (
    <div className="space-y-6" data-custody-fund-dashboard="true">
      {fund.data !== undefined && (
        <CustodyAlerts alerts={NO_SPEND_ALERTS} fundLines={fundLines} onFundAction={setFund} />
      )}
      <div className={FORMULA_FIT}>
        {/* No `data`: it reads the fund's summary itself. */}
        <CustodyFundNow />
      </div>
      <div className={CUSTODY_FUND_ROW}>
        <CustodyWaitingCard onFundAction={setFund} {...today} />
        <CustodySettleCard onFundAction={setFund} {...today} />
      </div>
      {/* No `onShowPeriod`: a receipts line is a real link (`custodyPeriodLink`), middle-click too. */}
      <div className={HISTORY_ROW}>
        <CustodyFundSteps />
        <CustodyRecentOps />
      </div>
    </div>
  );
};
