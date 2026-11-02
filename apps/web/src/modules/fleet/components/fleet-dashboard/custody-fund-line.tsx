// «لوحة تحكم الحركة» — the custody figures of tab 1 (T1.11) and tab 5 (T5.6–T5.9), read from the
// custody screen's OWN hooks so the dashboard says exactly what «لوحة تحكم العهدة» says (D3):
//
//   · the alert line counts the fund dashboard's banner lines — `useCustodyFundAlerts(fundTotal)`,
//     the very call `CustodyFundDashboard` makes — and nothing else: the receipt-audit lines stay on
//     «مصروفات العهدة»;
//   · «إجمالي العهدة الآن» is the fund's `fundTotal`; «تنتظر الاستعاضة» is `custodyWaiting(...)`
//     and «تنتظر التسوية» is `custodySettleWaiting(...)` — the dashboard's own functions, never its
//     parts added up again here.
//
// MOUNTED ONLY WITH `fleetCustody.view`. Those hooks ask unconditionally, so a reader without the
// grant must never render this component: no request, and no 403.
import { type ReactNode } from 'react';
import {
  useCustodyFundSummary,
  useReplenishCandidates,
  useSettleCandidates,
} from '../../api/fleet-queries';
import { custodySettleWaiting, custodyWaiting } from '../../lib/custody-dashboard-fund';
import { useCustodyFundAlerts } from '../CustodyDashboardFund';

export interface CustodyFigures {
  /** The fund banner's lines (`useCustodyFundAlerts(...).length`) — the one browser count (D3). */
  lines: number;
  /** «إجمالي العهدة الآن»; `null` until the fund's summary has answered. */
  fundTotal: number | null;
  /** «مبالغ صُرفت ولم تُستعَض بعد» (`custodyWaiting(...).total`); `null` until both reads answered. */
  waiting: number | null;
  /** «مصروفات تراخيص لم تُسوَّ بعد» (`custodySettleWaiting(...)`); `null` until it answered. */
  settle: number | null;
  loading: boolean;
  error: boolean;
  /** When the slowest of the three reads last answered. */
  updatedAt: number;
  refetch: () => void;
}

export const CustodyFundSource = ({
  now,
  children,
}: {
  /** Today, for the fund's ages — fixed by the specs. */
  now?: number | undefined;
  children: (figures: CustodyFigures) => ReactNode;
}): ReactNode => {
  const fund = useCustodyFundSummary(true);
  const replenish = useReplenishCandidates(true);
  const settle = useSettleCandidates(true);
  const lines = useCustodyFundAlerts(fund.data?.fundTotal, now);
  const waiting =
    fund.data === undefined || replenish.data === undefined
      ? null
      : custodyWaiting(
          replenish.data.memos,
          replenish.data.outside,
          fund.data.memos.pendingTotal,
          fund.data.held,
        ).total;
  return children({
    lines: lines.length,
    fundTotal: fund.data?.fundTotal ?? null,
    waiting,
    settle: settle.data === undefined ? null : custodySettleWaiting(settle.data.parts),
    loading: fund.isPending || replenish.isPending || settle.isPending,
    error: fund.isError || replenish.isError || settle.isError,
    updatedAt: Math.max(fund.dataUpdatedAt, replenish.dataUpdatedAt, settle.dataUpdatedAt),
    refetch: () => {
      void fund.refetch();
      void replenish.refetch();
      void settle.refetch();
    },
  });
};
