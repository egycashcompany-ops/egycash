// «التراخيص والتجديدات» — the owner-approved sample (approved/lic-dark.png, lic-branch-dark.png;
// harness zz-licences-tab.tsx; DECISIONS §11, «اعمل اللى بتفضلوا», «أ جدول بالسواقين», then «اعتمد»;
// the critic's 21 corrections), a tab of «الآن» and a period both, drawn over the real reads. It
// replaces the old «التراخيص وآخر ما سُجّل» body under the same key (`licences`): an old link opens
// it.
//
//   1  the heading; «تحديث» refreshes both reads and «آخر تحديث» is the older of the two (the page
//      hands both in);
//   2  «الآن» (R1 `licenceVehicles`, `licenceDrivers`, `papers`) — tab-licences-now.tsx, with the
//      12-month chart (tab-licences-chart.tsx) and the two tables (tab-licences-tables.tsx);
//   3  «خلال الفترة» (the page's R2 `licenceSpend`, the period choices only) —
//      tab-licences-period.tsx.
//
// Each band wears its own read's face (an R1 failure never blanks the period band, and the other
// way round), and each part shows under its own gate: a reader of the licensing board alone sees the
// papers card alone (and no period band — they read no R2); a reader of the licence expenses sees
// the period band. The words the parts share are tab-licences-words.tsx. Nothing on this tab counts
// anything: every figure is a field a read sent.
import { sectionPermitted } from '../../lib/fleet-dashboard-tabs';
import { I, TabHead } from './dash-kit';
import { RefreshTools, type MixedTabProps } from './dash-shell';
import { LicencesNowBand } from './tab-licences-now';
import { LicencesPeriodBand } from './tab-licences-period';
import { LICENCE_NOW_SECTIONS, useLicenceWords } from './tab-licences-words';
import { useT } from '../../../../platform/localization/useT';

/** The heading (no live chip: the tab holds «now» and the period both); its line names the period
 *  only for a reader who is drawn the period band. */
const Heading = ({ props, period }: { props: MixedTabProps; period: boolean }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  return (
    <TabHead
      icon={I.doc}
      title={t('fleet.dash.shell.tab.licences')}
      live={false}
      sub={w(period ? 'sub' : 'subNow')}
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

export const LicencesTab = (props: MixedTabProps): JSX.Element => {
  const { can } = props;
  const nowOk = LICENCE_NOW_SECTIONS.some((section) => sectionPermitted(section, can));
  // The period band for a reader of the licence expenses (FDP reads R2 for them).
  const periodOk = props.period.enabled && sectionPermitted('licenceSpend', can);
  return (
    <div data-dash-tab-body="licences">
      <Heading props={props} period={periodOk} />
      {nowOk && <LicencesNowBand props={props} />}
      {periodOk && <LicencesPeriodBand props={props} />}
    </div>
  );
};
