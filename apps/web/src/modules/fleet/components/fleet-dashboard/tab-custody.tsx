// «العهدة» — the owner-approved sample (approved/cust-dark.png, cust-branch-dark.png; harness
// zz-custody-tab.tsx; DECISIONS §9: «اعتمد سامبل العهدة», the critic's 17 corrections, Q1 (أ)
// «اعمل اللى بتفضلوا»), a NEW tab after «الوقود والمصروفات»: a restyle of «لوحة تحكم العهدة»
// (`/fleet/custody/dashboard`) — the same formula, the same titles, the same reads — plus the
// period's custody spend, drawn over real reads only:
//
//   1  the heading; «تحديث» refreshes the custody reads, «سجل العهدة» and R2, and «آخر تحديث» is the
//      oldest of them (the page hands in the custody reads and R2; the tab adds its ledger);
//   2  «الآن» (the custody screen's own reads — `props.custody`, the fund being the department's
//      whole since its first day: «الشركة كلها» while the page is narrowed) — tab-custody-now.tsx,
//      and its history — tab-custody-history.tsx;
//   3  «خلال الفترة» (the page's R2 `opex` and `custodyStates`, under the page's own filters, the
//      period bar right under the band's head) — tab-custody-period.tsx.
//
// The tab shows for a reader of the custody fund alone (`fleetCustody.view`); its period band only
// for a reader of the receipts as well (`opex`). Each band wears its own read's face: the custody
// reads failing never blank the period band, and the other way round. Nothing on this tab counts
// anything: every figure is a field a read sent, every count of a list the custody lib's.
import { useT } from '../../../../platform/localization/useT';
import { sectionPermitted } from '../../lib/fleet-dashboard-tabs';
import { useCustodyLedger } from '../../api/fleet-queries';
import { CUSTODY_LEDGER_PARAMS } from '../CustodyDashboardFund';
import { CUSTODY_FUND } from '../CustodyKinds';
import { TabHead } from './dash-kit';
import { RefreshTools, type MixedTabProps } from './dash-shell';
import { CustodyNowBand } from './tab-custody-now';
import { CustodyPeriodBand } from './tab-custody-period';
import { useCustodyWords } from './tab-custody-words';

export const CustodyTab = (props: MixedTabProps): JSX.Element => {
  const t = useT();
  const w = useCustodyWords();
  const { custody, can } = props;
  // «سجل العهدة» as «لوحة تحكم العهدة» reads it (one cache): the chart and the latest lines.
  const ledger = useCustodyLedger(CUSTODY_LEDGER_PARAMS, custody !== null);
  // The period band for a reader of the receipts (FDP draws R2 for this tab when `opex` is theirs).
  const periodOk = props.period.enabled && sectionPermitted('opex', can);
  // The heading's age: the oldest of the page's reads and the ledger's.
  const stamps = [props.updatedAt, ledger.dataUpdatedAt].filter((stamp) => stamp > 0);
  const updatedAt = stamps.length === 0 ? 0 : Math.min(...stamps);
  const refresh = (): void => {
    props.onRefresh();
    if (custody !== null) void ledger.refetch();
  };
  return (
    <div data-dash-tab-body="custody">
      <TabHead
        icon={CUSTODY_FUND.icon}
        title={t('fleet.dash.shell.tab.custody')}
        live={false}
        sub={w(periodOk ? 'sub' : 'subNow')}
        end={
          <RefreshTools
            updatedAt={updatedAt}
            onRefresh={refresh}
            refreshing={props.refreshing || ledger.isFetching}
            {...(props.clock === undefined ? {} : { clock: props.clock })}
          />
        }
      />
      {custody !== null && <CustodyNowBand props={props} custody={custody} ledger={ledger} />}
      {periodOk && <CustodyPeriodBand props={props} />}
    </div>
  );
};
