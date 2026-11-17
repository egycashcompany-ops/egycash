// «الوقود والمصروفات» — the owner-approved sample (approved/fuel-dark.png, fuel-branch-dark.png;
// harness zz-fuel.tsx; DECISIONS §8, «اعمل الافضل» = every recommendation, the critic's 24
// corrections and the look L2, then «تمام»), a tab of «الآن» and a period both, drawn over the real
// reads:
//
//   1  the heading; «تحديث» refreshes both reads and «آخر تحديث» is the older of the two (the page
//      hands both in);
//   2  «الآن» (R1 `fuelCards`, `fuelCharging`, `fuelCardList`, `fuelSheets`) — tab-fuel-now.tsx;
//   3  «خلال الفترة» (the page's R2 `opex`, `opexSeries`, `dealership`, `dealershipList`, under the
//      page's own filters, the period bar right under the band's head) — tab-fuel-period.tsx and its
//      day chart, tab-fuel-chart.tsx.
//
// Each band wears its own read's face (an R1 failure never blanks the period band, and the other
// way round), and each part shows under its own gate: a reader of the fuel cards alone sees the
// expiry card, a reader of the receipts alone the receipts part, a reader of the dealership alone
// the dealership part. The words the two bands share (the dual counts, the company word, an amount)
// are tab-fuel-words.tsx. Nothing on this tab counts anything: every figure is a field a read sent.
import { sectionPermitted } from '../../lib/fleet-dashboard-tabs';
import { I, TabHead } from './dash-kit';
import { RefreshTools, type MixedTabProps } from './dash-shell';
import { FuelNowBand } from './tab-fuel-now';
import { FuelPeriodBand } from './tab-fuel-period';
import { useFuelWords } from './tab-fuel-words';

/** The heading (no live chip: the tab holds «now» and the period both); its line names only the
 *  bands this reader is drawn. */
const Heading = ({
  props,
  now,
  period,
}: {
  props: MixedTabProps;
  now: boolean;
  period: boolean;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <TabHead
      icon={I.fuel}
      title={w('heading')}
      live={false}
      sub={w(now && period ? 'headingSub' : now ? 'headingSubNow' : 'headingSubPeriod')}
      end={
        <RefreshTools
          updatedAt={props.updatedAt}
          onRefresh={props.onRefresh}
          refreshing={props.refreshing}
          {...(props.clock === undefined ? {} : { clock: props.clock })}
        />
      }
    />
  );
};

export const FuelTab = (props: MixedTabProps): JSX.Element => {
  const { can } = props;
  // Every R1 part of the tab needs the fuel cards' key (the expiry card's gate holds it alone).
  const nowOk = sectionPermitted('fuelCards', can);
  // The period band for a reader of the receipts or of the dealership (FDP draws R2 for this tab
  // when either section is the reader's).
  const periodOk =
    props.period.enabled && (sectionPermitted('opex', can) || sectionPermitted('dealership', can));
  return (
    <div data-dash-tab-body="fuel">
      <Heading props={props} now={nowOk} period={periodOk} />
      {nowOk && <FuelNowBand props={props} />}
      {periodOk && <FuelPeriodBand props={props} />}
    </div>
  );
};
