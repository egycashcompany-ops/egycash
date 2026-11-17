// «لوحة تحكم الحركة» — the custody figures of «نظرة عامة» (T1.11), «ملخصات» (T5.6–T5.9) and the
// «العهدة» tab, read from the custody screen's OWN hooks so the dashboard says exactly what «لوحة
// تحكم العهدة» says (D3):
//
//   · the alert line counts the fund dashboard's banner lines — `useCustodyFundAlerts(fundTotal)`,
//     the very call `CustodyFundDashboard` makes — and nothing else: the receipt-audit lines stay on
//     «مصروفات العهدة»;
//   · «إجمالي العهدة الآن» is the fund's `fundTotal`; «تنتظر الاستعاضة» is `custodyWaiting(...)`
//     and «تنتظر التسوية» is `custodySettleWaiting(...)` — the dashboard's own functions, never its
//     parts added up again here.
//
// The «العهدة» tab is the third reader: it draws the same three reads whole (`detail`: the fund's
// summary, the replenish and the settle candidates, and the banner's lines themselves), so its
// strip, its three waiting cards and its alerts card are the figures «ملخصات» and the overview
// show, from one fetch. Every field the two older readers take is unchanged.
//
// MOUNTED ONLY WITH `fleetCustody.view`. Those hooks ask unconditionally, so a reader without the
// grant must never render this component: no request, and no 403.
import { type ReactNode } from 'react';
import {
  type FleetCustodyFundSummaryDto,
  type FleetCustodyReplenishCandidatesDto,
  type FleetCustodySettleCandidatesDto,
} from '@ecms/contracts';
import {
  useCustodyFundSummary,
  useReplenishCandidates,
  useSettleCandidates,
} from '../../api/fleet-queries';
import {
  custodySettleWaiting,
  custodyWaiting,
  type CustodyFundAlert,
} from '../../lib/custody-dashboard-fund';
import { useCustodyFundAlerts } from '../CustodyDashboardFund';

/** The three reads whole, and the banner's lines — for the «العهدة» tab. */
export interface CustodyDetail {
  summary: FleetCustodyFundSummaryDto;
  replenish: FleetCustodyReplenishCandidatesDto;
  settle: FleetCustodySettleCandidatesDto;
  /** The fund's banner lines (a–e) in the banner's order — `useCustodyFundAlerts(...)` itself. */
  alerts: readonly CustodyFundAlert[];
}

export interface CustodyFigures {
  /** The fund banner's lines (`useCustodyFundAlerts(...).length`) — the one browser count (D3). */
  lines: number;
  /** «إجمالي العهدة الآن»; `null` until the fund's summary has answered. */
  fundTotal: number | null;
  /** «مبالغ صُرفت ولم تُستعَض بعد» (`custodyWaiting(...).total`); `null` until both reads answered. */
  waiting: number | null;
  /** «مصروفات تراخيص لم تُسوَّ بعد» (`custodySettleWaiting(...)`); `null` until it answered. */
  settle: number | null;
  /** The three reads whole (the «العهدة» tab); `null` until all three have answered. */
  detail: CustodyDetail | null;
  loading: boolean;
  error: boolean;
  /** The first of the three reads' errors (`null` when none failed) — the tab's error face. */
  failure: unknown;
  /** One of the three reads is on its way (a refetch included). */
  fetching: boolean;
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
  const alerts = useCustodyFundAlerts(fund.data?.fundTotal, now);
  const waiting =
    fund.data === undefined || replenish.data === undefined
      ? null
      : custodyWaiting(
          replenish.data.memos,
          replenish.data.outside,
          fund.data.memos.pendingTotal,
          fund.data.held,
        ).total;
  const detail: CustodyDetail | null =
    fund.data === undefined || replenish.data === undefined || settle.data === undefined
      ? null
      : { summary: fund.data, replenish: replenish.data, settle: settle.data, alerts };
  return children({
    lines: alerts.length,
    fundTotal: fund.data?.fundTotal ?? null,
    waiting,
    settle: settle.data === undefined ? null : custodySettleWaiting(settle.data.parts),
    detail,
    loading: fund.isPending || replenish.isPending || settle.isPending,
    error: fund.isError || replenish.isError || settle.isError,
    failure: fund.error ?? replenish.error ?? settle.error ?? null,
    fetching: fund.isFetching || replenish.isFetching || settle.isFetching,
    updatedAt: Math.max(fund.dataUpdatedAt, replenish.dataUpdatedAt, settle.dataUpdatedAt),
    refetch: () => {
      void fund.refetch();
      void replenish.refetch();
      void settle.refetch();
    },
  });
};
