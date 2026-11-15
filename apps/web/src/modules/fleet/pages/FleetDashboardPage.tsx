// «لوحة تحكم الحركة» — the fleet module's home (/fleet).
//
// Ten tabs on ONE sticky pill strip, and NO page head (owner-decisions #3), in the order the finished
// dashboard will keep (plan D2):
//   نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · الكيلومترات · ترتيب السيارات ·
//   الحوادث · أرقام الفترة · ملخصات · التراخيص
// The first four are the redesigned screens: «نظرة عامة» and «الحركة اليوم» took the content of the
// retired «التنبيهات» and «الحركة الآن» (an old `?tab=alerts` / `?tab=now` opens them);
// «توزيع السيارات» and «الصيانة والورش» were rebuilt under their old keys (an old link opens the new
// body). The other six are the old tabs, unchanged, each standing where its redesign will stand:
//   · R1 `GET /fleet/dashboard/now` (Cairo today, untouched by the filters) — overview, today,
//     distribution, summaries, licences; the overview and «توزيع السيارات» (its km, with the km key)
//     also read R2 over «هذا الشهر» with no page filter;
//   · R2 `GET /fleet/dashboard/period` — km, ranking, accidents, period, under ONE filter bar shared
//     by the four;
//   · «الصيانة والورش» — the first MIXED panel: an R1 «الآن» band and a period band over the page's R2,
//     with the same filter bar drawn between the two; each band wears its own read's face.
// At the strip's end «الفرع: …» says what the figures cover, as the server answered it.
//
// THE ADDRESS BAR IS THE STATE (D14). `tab` names the panel and is never remembered. Of the filters,
// only type / operation / codes are remembered across visits (`REMEMBERED_FILTERS`); the period opens
// on «هذا الشهر» on every visit and a chosen period stays in the address bar while the reader moves
// between tabs (DECISIONS §0c). Switching tabs re-reads nothing: `tab` is in neither query key.
//
// PERMISSIONS ARE THE SERVER'S (R-28). A reader holding no key of a read never asks for it; a section
// the reader may not see comes back `null` and renders nothing; a tab with no section left is not in
// the bar. The custody figures come from the custody screen's own hooks, mounted only with
// `fleetCustody.view` (D3).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  cairoYmd,
  FLEET_DASHBOARD_PERIOD_TABS,
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
import { PeriodTab } from '../components/fleet-dashboard/period-tabs';
import { OverviewTab } from '../components/fleet-dashboard/tab-overview';
import { TodayTab } from '../components/fleet-dashboard/tab-today';
import { DistributionTab } from '../components/fleet-dashboard/tab-distribution';
import { MaintenanceTab } from '../components/fleet-dashboard/tab-maintenance';
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

/** Which of the two reads this reader may ask for at all (a read nobody may see is never sent). */
export const dashboardReads = (
  can: (permission: string) => boolean,
): { now: boolean; period: boolean; custody: boolean } => ({
  now: FLEET_DASHBOARD_NOW_KEYS.some((key) => can(key)),
  period: FLEET_DASHBOARD_PERIOD_KEYS.some((key) => can(key)),
  custody: sectionPermitted('custodyFund', can),
});

type PeriodTabKey = (typeof FLEET_DASHBOARD_PERIOD_TABS)[number];

const isPeriodTab = (tab: FleetDashboardTab): tab is PeriodTabKey =>
  (FLEET_DASHBOARD_PERIOD_TABS as readonly string[]).includes(tab);

/** The panels of R1 and R2 both, each band with its own read's face (plan D3). */
const MIXED_PANELS = { maintenance: MaintenanceTab } as const satisfies Partial<
  Record<FleetDashboardTab, (props: MixedTabProps) => JSX.Element>
>;
type MixedTabKey = keyof typeof MIXED_PANELS;
/**
 * The R2 section each mixed panel draws its period band from: a reader who may read R2 for another
 * tab (km, dealership) but not this section sees no band, so its age and «تحديث» leave R2 out.
 */
const MIXED_PERIOD_SECTION = { maintenance: 'exits' } as const satisfies Record<
  MixedTabKey,
  FleetDashboardSection
>;

const isMixedTab = (tab: FleetDashboardTab): tab is MixedTabKey =>
  (Object.keys(MIXED_PANELS) as readonly string[]).includes(tab);

const NOW_PANELS: Record<
  Exclude<FleetDashboardTab, PeriodTabKey | MixedTabKey>,
  (props: NowTabProps) => JSX.Element
> = {
  overview: OverviewTab,
  today: TodayTab,
  distribution: DistributionTab,
  licences: LicencesTab,
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

  // «هذا الشهر» for the overview's month card and the km of «توزيع السيارات» (only for a reader of
  // the km): the page's filters never reach it. At the default filters it is the page's own R2 key,
  // so the two are one request.
  const monthEnabled =
    reads.period &&
    (active === 'overview' || (active === 'distribution' && sectionPermitted('km', can)));
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

  // R1's face for the tabs that draw it as a band of their own (the overview, «الصيانة والورش»):
  // R1 on its way (or failed) costs only R1's parts.
  const nowView = reads.now ? dashboardView(nowQ) : 'ready';
  const nowPending =
    nowView === 'ready' ? undefined : { state: nowView, error: nowQ.error as unknown };

  let panel: JSX.Element;
  if (isMixedTab(active)) {
    // «الصيانة والورش»: «الآن» (R1) and the period (the page's R2, under the bar it draws between
    // the two). «تحديث» refetches both; the heading's age is the OLDER of the two answers.
    const Panel = MIXED_PANELS[active];
    // R2 counts in the heading only when this tab draws its band (R2 itself stays page-wide).
    const periodDrawn = reads.period && sectionPermitted(MIXED_PERIOD_SECTION[active], can);
    const stamps = [
      ...(reads.now && nowQ.dataUpdatedAt > 0 ? [nowQ.dataUpdatedAt] : []),
      ...(periodDrawn && periodQ.dataUpdatedAt > 0 ? [periodQ.dataUpdatedAt] : []),
    ];
    const refreshBoth = (): void => {
      if (reads.now) void nowQ.refetch({ cancelRefetch: false });
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
        refreshing={(reads.now && nowQ.isFetching) || (periodDrawn && periodQ.isFetching)}
        onRefresh={refreshBoth}
        onRetry={refreshNow}
        month={month}
        tabLink={toTab}
        period={pageRead}
        {...(nowPending === undefined ? {} : { nowPending })}
      />
    );
  } else if (isPeriodTab(active)) {
    panel = (
      <PeriodTab
        tab={active}
        data={periodQ.data}
        loading={reads.period && periodQ.isPending}
        error={periodQ.isError}
        onRetry={refreshPeriod}
        filters={filters}
        onFilters={onFilters}
        updatedAt={periodQ.dataUpdatedAt}
        refreshing={periodQ.isFetching}
        onRefresh={refreshPeriod}
        can={can}
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
