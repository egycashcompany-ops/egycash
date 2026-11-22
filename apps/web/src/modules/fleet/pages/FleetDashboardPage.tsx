// «لوحة تحكم الحركة» — the fleet module's home (/fleet).
//
// Eleven tabs on ONE sticky pill strip, and NO page head (owner-decisions #3), in the order the
// finished dashboard will keep (plan D2):
//   نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات ·
//   الحوادث ومطالبات التأمين · المخالفات المرورية والتسويات · الوقود والمصروفات · العهدة ·
//   التراخيص والتجديدات · ملخصات
// The first ten are the redesigned screens: «نظرة عامة» and «الحركة اليوم» took the content of the
// retired «التنبيهات» and «الحركة الآن» (an old `?tab=alerts` / `?tab=now` opens them);
// «توزيع السيارات», «الصيانة والورش», «العدادات والكيلومترات» (key `km`), «الحوادث ومطالبات
// التأمين» (key `accidents`) and «التراخيص والتجديدات» (key `licences`) were rebuilt under their old
// keys (an old link opens the new body); «العدادات والكيلومترات» also holds the old «ترتيب السيارات»
// (an old `?tab=ranking` opens it); «المخالفات المرورية والتسويات» (key `violations`), «الوقود
// والمصروفات» (key `fuel`) and «العهدة» (key `custody`) are NEW tabs with no old tab of their own.
// The last one, «ملخصات», is the one old tab kept, unchanged; the old period-figures tab was removed
// at the owner's word (22 November) — an old link to it opens the first visible tab (`readTab`), and
// its figures live on the mixed panels. The reads:
//   · R1 `GET /fleet/dashboard/now` (Cairo today, untouched by the filters) — overview, today,
//     distribution, summaries; the overview and «توزيع السيارات» (its km, with the km key) also read
//     R2 over «هذا الشهر» with no page filter;
//   · R2 `GET /fleet/dashboard/period` under the page's filters — the period parts of the seven
//     MIXED panels below (no tab reads R2 alone any more);
//   · the seven MIXED panels — «الصيانة والورش», «العدادات والكيلومترات», «الحوادث ومطالبات
//     التأمين», «المخالفات المرورية والتسويات», «الوقود والمصروفات», «العهدة», «التراخيص
//     والتجديدات»: a «الآن» part and a period part over the page's R2, under the same filter bar
//     (between the bands, or at the top of «العدادات والكيلومترات»); each part wears its own read's
//     face. The «الآن» part is R1's, except on «العهدة», whose «الآن» is the custody screen's own
//     reads (`FLEET_DASHBOARD_TAB_READS`: 'web').
// One filter state serves every screen that reads R2.
// At the strip's end «الفرع: …» says what the figures cover, as the server answered it.
//
// THE ADDRESS BAR IS THE STATE (D14). `tab` names the panel and is never remembered. Of the filters,
// only type / operation / codes are remembered across visits (`REMEMBERED_FILTERS`); the period opens
// on «هذا الشهر» on every visit and a chosen period stays in the address bar while the reader moves
// between tabs (DECISIONS §0c). Switching tabs re-reads nothing: `tab` is in neither query key.
//
// PERMISSIONS ARE THE SERVER'S (R-28). A reader holding no key of a read never asks for it — R2 only
// when some period section is fully permitted (a custody-only reader holds an R2 key but no section,
// and sends no R2); a section the reader may not see comes back `null` and renders nothing; a tab
// with no section left is not in the bar. The custody figures come from the custody screen's own
// hooks, mounted only with `fleetCustody.view` (D3).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PAGELESS_SECTIONS,
  FLEET_DASHBOARD_PERIOD_SECTIONS,
  cairoYmd,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_PARTS,
  FLEET_DASHBOARD_TAB_READS,
  FLEET_DASHBOARD_TAB_SECTIONS,
  type FleetDashboardPeriodQuery,
  type FleetDashboardSection,
  type FleetDashboardTab,
} from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { useT } from '../../../platform/localization/useT';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import {
  useCairoMidnightRefresh,
  useFleetDashboardNow,
  useFleetDashboardPeriod,
} from '../api/fleet-dashboard-queries';
import {
  periodFiltersPatch,
  readPeriodFilters,
  readTab,
  toPeriodQuery,
  type PeriodFilters,
} from '../lib/fleet-dashboard-url';
import { midnightClock, periodLiveness } from '../lib/fleet-dashboard-refresh';
import { tabLink, type TabLinkFilters } from '../lib/fleet-dashboard-links';
import { alertLines, sectionPermitted, tabBadges, visibleTabs } from '../lib/fleet-dashboard-tabs';
import {
  CustodyFundSource,
  type CustodyFigures,
} from '../components/fleet-dashboard/custody-fund-line';
import {
  ReadError,
  TabSkeleton,
  TopNav,
  type DashScope,
  type MixedTabProps,
  type MonthRead,
  type NowTabProps,
  type PageRead,
} from '../components/fleet-dashboard/dash-shell';
import { MONTH_SECTIONS, OverviewTab } from '../components/fleet-dashboard/tab-overview';
import { TodayTab } from '../components/fleet-dashboard/tab-today';
import { DistributionTab } from '../components/fleet-dashboard/tab-distribution';
import { MaintenanceTab } from '../components/fleet-dashboard/tab-maintenance';
import { KmTab } from '../components/fleet-dashboard/tab-km';
import { AccidentsTab } from '../components/fleet-dashboard/tab-accidents';
import { ViolationsTab } from '../components/fleet-dashboard/tab-violations';
import { FuelTab } from '../components/fleet-dashboard/tab-fuel';
import { CustodyTab } from '../components/fleet-dashboard/tab-custody';
import { LicencesTab } from '../components/fleet-dashboard/tab-licences';
import { SummariesTab } from '../components/fleet-dashboard/tab-summaries';

/**
 * The filters the page remembers across visits — never `tab` (a link names its tab), and never the
 * period (DECISIONS §0c): the dashboard opens on «هذا الشهر» on every visit, while a period the
 * reader chose stays in the address bar between tabs for the rest of the visit.
 */
export const REMEMBERED_FILTERS = ['type', 'operation', 'vehicleCodes'] as const;

/**
 * «هذا الشهر» with no page filter (plan D16): the overview's month card, and the km by branch of
 * «توزيع السيارات».
 */
const MONTH_QUERY: FleetDashboardPeriodQuery = { preset: 'thisMonth' };

/**
 * Which face a read's panel wears. A read on its way is a skeleton; a read with no answer is an error
 * (with its retry), never an empty fleet; an answer is shown even while a later refetch fails.
 */
export type DashboardView = 'loading' | 'error' | 'ready';
export const dashboardView = (query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}): DashboardView => (query.isPending ? 'loading' : query.data === undefined ? 'error' : 'ready');

/**
 * A period section some tab may DRAW for this reader. A PAGELESS one (`licenceSpend`) is drawn only
 * beside the figures of the tab that holds it as a part (FLEET_DASHBOARD_TAB_PARTS), so it counts
 * only while that tab can show by its own sections: on its key alone it would send R2 for nothing
 * (a custody clerk who also holds the licence-expense key sees no «التراخيص والتجديدات»).
 */
const periodSectionDrawn = (
  section: (typeof FLEET_DASHBOARD_PERIOD_SECTIONS)[number],
  can: (permission: string) => boolean,
): boolean => {
  if (!sectionPermitted(section, can)) return false;
  if (!(FLEET_DASHBOARD_PAGELESS_SECTIONS as readonly string[]).includes(section)) return true;
  return FLEET_DASHBOARD_TABS.some(
    (tab) =>
      (FLEET_DASHBOARD_TAB_PARTS[tab] ?? []).includes(section) &&
      FLEET_DASHBOARD_TAB_SECTIONS[tab].some((own) => sectionPermitted(own, can)),
  );
};

/** Which of the two reads this reader may ask for at all (a read nobody may see is never sent). */
export const dashboardReads = (
  can: (permission: string) => boolean,
): { now: boolean; period: boolean; custody: boolean } => ({
  now: FLEET_DASHBOARD_NOW_KEYS.some((key) => can(key)),
  // R2 only when some period section is fully permitted AND drawn somewhere (plan D5):
  // `fleetCustody.view` is in the R2 union (`custodyStates` needs the receipts' key too), so a
  // custody-only reader sends no R2; nor does a reader whose only period section is a PAGELESS part
  // of a tab they cannot see.
  period: FLEET_DASHBOARD_PERIOD_SECTIONS.some((section) => periodSectionDrawn(section, can)),
  custody: sectionPermitted('custodyFund', can),
});

/**
 * The panels of a «الآن» read and R2 both, each part with its own read's face (plan D3): R1's, or —
 * «العهدة» — the custody screen's own reads.
 */
const MIXED_PANELS = {
  maintenance: MaintenanceTab,
  km: KmTab,
  accidents: AccidentsTab,
  violations: ViolationsTab,
  fuel: FuelTab,
  custody: CustodyTab,
  licences: LicencesTab,
} as const satisfies Partial<Record<FleetDashboardTab, (props: MixedTabProps) => JSX.Element>>;
type MixedTabKey = keyof typeof MIXED_PANELS;
/**
 * The R2 sections each mixed panel draws its period band from (any one of them draws it — «الوقود
 * والمصروفات» from the receipts OR the dealership): a reader who may read R2 for another tab (km,
 * dealership) but none of these sees no band, so its age and «تحديث» leave R2 out. «العهدة» draws its
 * band from the receipts (`custodyStates` only adds lines to it); «التراخيص والتجديدات» from the
 * licence memos.
 */
const MIXED_PERIOD_SECTIONS = {
  maintenance: ['exits'],
  km: ['km'],
  accidents: ['accidents'],
  violations: ['violations'],
  fuel: ['opex', 'dealership'],
  custody: ['opex'],
  licences: ['licenceSpend'],
} as const satisfies Record<MixedTabKey, readonly FleetDashboardSection[]>;

const isMixedTab = (tab: FleetDashboardTab): tab is MixedTabKey =>
  (Object.keys(MIXED_PANELS) as readonly string[]).includes(tab);

const NOW_PANELS: Record<
  Exclude<FleetDashboardTab, MixedTabKey>,
  (props: NowTabProps) => JSX.Element
> = {
  overview: OverviewTab,
  today: TodayTab,
  distribution: DistributionTab,
  summaries: SummariesTab,
};

const Dashboard = ({ custody }: { custody: CustodyFigures | null }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const asked = sp.get('tab');
  const period = sp.get('period');
  const from = sp.get('from');
  const to = sp.get('to');
  const type = sp.get('type');
  const operation = sp.get('operation');
  const codes = sp.get('vehicleCodes');
  // The six params ARE the filter state: a new object only when one of them changes.
  const filters = useMemo(() => readPeriodFilters(sp), [period, from, to, type, operation, codes]);
  const query = useMemo(() => toPeriodQuery(filters), [filters]);

  const reads = dashboardReads(can);
  const nowQ = useFleetDashboardNow(reads.now);
  // R1's `today` once it has answered; until then (and for a reader without R1) the browser's own
  // Cairo day — so a custom range that ended before today is `past` from the first render, and its
  // key does not flip (and R2 is not read twice) when R1 lands.
  const periodQ = useFleetDashboardPeriod(
    query,
    periodLiveness(query, nowQ.data?.today ?? cairoYmd(new Date())),
    reads.period,
  );
  const midnight = midnightClock(nowQ, periodQ);
  useCairoMidnightRefresh(midnight.asOf, midnight.fetchedAt);

  const answers = { can, now: nowQ.data, period: periodQ.data };
  const visible = visibleTabs(answers);
  const active = readTab(asked, visible);
  const lines = alertLines(nowQ.data?.alerts ?? [], custody?.lines ?? null);
  const badges = tabBadges(answers);

  // «هذا الشهر» for the overview's month card (only for a reader of one of its four figures) and the
  // km of «توزيع السيارات» (only for a reader of the km): the page's filters never reach it — and no
  // reader meets a month skeleton that could never fill. At the default filters it is the page's own
  // R2 key, so the two are one request.
  const monthEnabled =
    reads.period &&
    ((active === 'overview' && MONTH_SECTIONS.some((section) => sectionPermitted(section, can))) ||
      (active === 'distribution' && sectionPermitted('km', can)));
  const monthQ = useFleetDashboardPeriod(MONTH_QUERY, 'live', monthEnabled);
  const month: MonthRead = {
    data: monthQ.data,
    loading: monthQ.isPending,
    failed: monthQ.isError && monthQ.data === undefined,
    enabled: monthEnabled,
    onRetry: () => void monthQ.refetch({ cancelRefetch: false }),
  };
  const toTab = (tab: FleetDashboardTab, metric: string, own?: TabLinkFilters) =>
    tabLink(tab, metric, sp, visible, own);

  // «الفرع: …» — what the figures cover, as the server echoed it (never the switcher's header):
  // R1's, else R2's; `null` («الشركة كلها») for a reader with neither read (custody alone), and
  // `undefined` (no chip) while the reads are on their way.
  const scope: DashScope =
    nowQ.data !== undefined
      ? nowQ.data.scopeBranches
      : periodQ.data !== undefined
        ? periodQ.data.vehicleScope.scopeBranches
        : !reads.now && !reads.period
          ? null
          : undefined;

  const write = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };
  const pick = (tab: FleetDashboardTab): void => write({ tab });
  const onFilters = (next: PeriodFilters): void => write(periodFiltersPatch(next));

  if (visible.length === 0) {
    return (
      <div className="mx-auto w-full shrink-0 px-4 py-6 sm:px-6 lg:px-8">
        <EmptyState
          title={t('fleet.dash.shell.nothingTitle')}
          description={t('fleet.dash.shell.nothingNote')}
        />
      </div>
    );
  }

  // «تحديث»: never a read this reader may not send (`refetch()` ignores `enabled`), and never a
  // second R1 while one is in flight (`cancelRefetch: false` joins it rather than restarting it).
  const refreshNow = (): void => {
    if (reads.now) void nowQ.refetch({ cancelRefetch: false });
    if (month.enabled) void monthQ.refetch({ cancelRefetch: false });
    custody?.refetch();
  };
  const refreshPeriod = (): void => {
    if (reads.period) void periodQ.refetch({ cancelRefetch: false });
  };

  // R1's face for the tabs that draw it as a part of their own (the overview, the mixed panels):
  // R1 on its way (or failed) costs only R1's parts.
  const nowView = reads.now ? dashboardView(nowQ) : 'ready';
  const nowPending =
    nowView === 'ready' ? undefined : { state: nowView, error: nowQ.error as unknown };

  let panel: JSX.Element;
  if (isMixedTab(active)) {
    // «الصيانة والورش», «العدادات والكيلومترات», «الحوادث ومطالبات التأمين», «المخالفات المرورية
    // والتسويات», «الوقود والمصروفات», «العهدة», «التراخيص والتجديدات»: a «الآن» part and a period
    // part (the page's R2, under the bar the tab draws). «تحديث» refetches both; the heading's age is
    // the OLDER of the two answers.
    const Panel = MIXED_PANELS[active];
    // The tab's own «الآن» read (`FLEET_DASHBOARD_TAB_READS`): R1, or — «العهدة» — the custody
    // screen's reads ('web'), whose face the tab draws itself (no `nowPending`).
    const web = !FLEET_DASHBOARD_TAB_READS[active].includes('now');
    const ownStamp = web ? (custody?.updatedAt ?? 0) : reads.now ? nowQ.dataUpdatedAt : 0;
    // R2 counts in the heading only when this tab draws its band (R2 itself stays page-wide).
    const periodDrawn =
      reads.period &&
      MIXED_PERIOD_SECTIONS[active].some((section) => sectionPermitted(section, can));
    const stamps = [
      ...(ownStamp > 0 ? [ownStamp] : []),
      ...(periodDrawn && periodQ.dataUpdatedAt > 0 ? [periodQ.dataUpdatedAt] : []),
    ];
    const refreshBoth = (): void => {
      if (web) custody?.refetch();
      else if (reads.now) void nowQ.refetch({ cancelRefetch: false });
      if (periodDrawn) refreshPeriod();
    };
    const pageRead: PageRead = {
      data: periodQ.data,
      loading: reads.period && periodQ.isPending,
      failed: periodQ.isError && periodQ.data === undefined,
      enabled: reads.period,
      onRetry: refreshPeriod,
      updatedAt: periodQ.dataUpdatedAt,
      refreshing: periodQ.isFetching,
      filters,
      onFilters,
    };
    panel = (
      <Panel
        now={nowQ.data ?? null}
        custody={custody}
        lines={lines}
        can={can}
        updatedAt={stamps.length === 0 ? 0 : Math.min(...stamps)}
        refreshing={
          (web ? (custody?.fetching ?? false) : reads.now && nowQ.isFetching) ||
          (periodDrawn && periodQ.isFetching)
        }
        onRefresh={refreshBoth}
        onRetry={refreshNow}
        month={month}
        tabLink={toTab}
        period={pageRead}
        {...(nowPending === undefined || web ? {} : { nowPending })}
      />
    );
  } else if (reads.now && dashboardView(nowQ) !== 'ready' && active !== 'overview') {
    panel =
      dashboardView(nowQ) === 'error' ? (
        <ReadError error={nowQ.error} onRetry={refreshNow} />
      ) : (
        <TabSkeleton />
      );
  } else {
    // The overview is not gated on R1 here: its month card and custody parts are other reads, so
    // R1 on its way (or failed) costs only R1's parts — the tab draws them as pending itself.
    const Panel = NOW_PANELS[active];
    const ownUpdatedAt = reads.now ? nowQ.dataUpdatedAt : (custody?.updatedAt ?? 0);
    // A heading that draws the month read (the overview, «توزيع السيارات») says how old its OLDEST
    // figures are: R1's or the month read's.
    const updatedAt =
      month.enabled && monthQ.data !== undefined && monthQ.dataUpdatedAt > 0
        ? ownUpdatedAt > 0
          ? Math.min(ownUpdatedAt, monthQ.dataUpdatedAt)
          : monthQ.dataUpdatedAt
        : ownUpdatedAt;
    panel = (
      <Panel
        now={nowQ.data ?? null}
        custody={custody}
        lines={lines}
        can={can}
        updatedAt={updatedAt}
        refreshing={nowQ.isFetching || (month.enabled && monthQ.isFetching)}
        onRefresh={refreshNow}
        onRetry={refreshNow}
        month={month}
        tabLink={toTab}
        {...(nowPending === undefined ? {} : { nowPending })}
      />
    );
  }

  return (
    <div data-fleet-dashboard="true" className="mx-auto w-full shrink-0 px-4 pb-10 sm:px-6 lg:px-8">
      <TopNav visible={visible} active={active} badges={badges} onPick={pick} scope={scope} />
      <section
        role="tabpanel"
        data-dash-panel={active}
        aria-label={t(`fleet.dash.shell.tab.${active}`)}
        className="mt-3 min-w-0"
      >
        {panel}
      </section>
    </div>
  );
};

export const FleetDashboardPage = (): JSX.Element => {
  const can = useCan();
  // The custody hooks ask unconditionally: they are mounted only for a reader who may read custody.
  return dashboardReads(can).custody ? (
    <CustodyFundSource>{(figures) => <Dashboard custody={figures} />}</CustodyFundSource>
  ) : (
    <Dashboard custody={null} />
  );
};
