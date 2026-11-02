// «لوحة تحكم الحركة» — the fleet module's home (/fleet), Phase 1 (plan §5, unified.md W-SHELL).
//
// Ten tabs in two groups on one sticky pill bar, and NO page head (owner-decisions #3):
//   «الآن»         التنبيهات · الحركة الآن · توزيع السيارات · التراخيص وآخر ما سُجّل · ملخصات
//                  — R1 `GET /fleet/dashboard/now`, Cairo today, untouched by the filters;
//   «حسب الفلاتر»  أرقام الفترة · الكيلومترات · ترتيب السيارات · الصيانة · الحوادث
//                  — R2 `GET /fleet/dashboard/period`, under ONE filter state shared by the five.
//
// THE ADDRESS BAR IS THE STATE (D14). `tab` names the panel and is never remembered; the filters
// (`REMEMBERED_FILTERS`) are remembered for the page, so a return visit and every period tab keep
// them. Switching tabs re-reads nothing: `tab` is in neither query key.
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
import { periodLiveness } from '../lib/fleet-dashboard-refresh';
import {
  alertLines,
  alertSummary,
  sectionPermitted,
  tabBadges,
  visibleTabs,
} from '../lib/fleet-dashboard-tabs';
import {
  CustodyFundSource,
  type CustodyFigures,
} from '../components/fleet-dashboard/custody-fund-line';
import {
  ReadError,
  TabSkeleton,
  TopNav,
  type NowTabProps,
} from '../components/fleet-dashboard/dash-shell';
import { PeriodTab } from '../components/fleet-dashboard/period-tabs';
import { AlertsTab } from '../components/fleet-dashboard/tab-alerts';
import { NowTab } from '../components/fleet-dashboard/tab-now';
import { DistributionTab } from '../components/fleet-dashboard/tab-distribution';
import { LicencesTab } from '../components/fleet-dashboard/tab-licences';
import { SummariesTab } from '../components/fleet-dashboard/tab-summaries';

/** The filters the page keeps across tabs and visits — never `tab` (a link names its tab). */
export const REMEMBERED_FILTERS = [
  'period',
  'from',
  'to',
  'type',
  'operation',
  'vehicleCodes',
] as const;

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

const isPeriodTab = (tab: FleetDashboardTab): tab is (typeof FLEET_DASHBOARD_PERIOD_TABS)[number] =>
  (FLEET_DASHBOARD_PERIOD_TABS as readonly string[]).includes(tab);

const NOW_PANELS: Record<
  Exclude<FleetDashboardTab, (typeof FLEET_DASHBOARD_PERIOD_TABS)[number]>,
  (props: NowTabProps) => JSX.Element
> = {
  alerts: AlertsTab,
  now: NowTab,
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
  useCairoMidnightRefresh(nowQ.data?.asOf, nowQ.dataUpdatedAt);
  // R1's `today` once it has answered; until then (and for a reader without R1) the browser's own
  // Cairo day — so a custom range that ended before today is `past` from the first render, and its
  // key does not flip (and R2 is not read twice) when R1 lands.
  const periodQ = useFleetDashboardPeriod(
    query,
    periodLiveness(query, nowQ.data?.today ?? cairoYmd(new Date())),
    reads.period,
  );

  const answers = { can, now: nowQ.data, period: periodQ.data };
  const visible = visibleTabs(answers);
  const active = readTab(asked, visible);
  const lines = alertLines(nowQ.data?.alerts ?? [], custody?.lines ?? null);
  const badges = tabBadges(answers, alertSummary(lines));

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
    custody?.refetch();
  };
  const refreshPeriod = (): void => {
    if (reads.period) void periodQ.refetch({ cancelRefetch: false });
  };

  let panel: JSX.Element;
  if (isPeriodTab(active)) {
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
  } else if (reads.now && dashboardView(nowQ) !== 'ready') {
    panel =
      dashboardView(nowQ) === 'error' ? (
        <ReadError error={nowQ.error} onRetry={refreshNow} />
      ) : (
        <TabSkeleton />
      );
  } else {
    const Panel = NOW_PANELS[active];
    panel = (
      <Panel
        now={nowQ.data ?? null}
        custody={custody}
        lines={lines}
        can={can}
        updatedAt={reads.now ? nowQ.dataUpdatedAt : (custody?.updatedAt ?? 0)}
        refreshing={nowQ.isFetching}
        onRefresh={refreshNow}
        onRetry={refreshNow}
      />
    );
  }

  return (
    <div data-fleet-dashboard="true" className="mx-auto w-full shrink-0 px-4 pb-10 sm:px-6 lg:px-8">
      <TopNav visible={visible} active={active} badges={badges} onPick={pick} />
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
