// «حسب الفلاتر» — «أرقام الفترة», the last old period tab still waiting for its redesign: it reads
// R2 alone, under the page's ONE filter state (FLEET_DASHBOARD_PERIOD_TABS).
// The other period screens were rebuilt as MIXED panels (a «الآن» part and a period part both) that
// draw the same filter bar over the same read inside their own bodies: «الصيانة والورش» (between
// its bands), «العدادات والكيلومترات» (at its top; it also holds the old «ترتيب السيارات») and
// «الحوادث ومطالبات التأمين» (between its bands).
//
// HAND-OVER POINT H1 (unified.md §4): W-SHELL writes this file as a stub with the final
// `PeriodTabProps` / `PeriodTab`, and W-PERIOD owns it afterwards. The props are the contract between
// the page and the period tabs; a change to them is a hand-off, not an edit.
//
// The tab: its heading (the range the server echoed, «آخر تحديث قبل …» + «تحديث»), the shared filter
// bar, then the tab's cards. Every label, chip and link comes from the echo (`range`, `vehicleScope`),
// never from the browser's clock. While a new filter loads the previous answer stays on screen
// (R2 keeps its previous data); a read with no answer yet is a skeleton, a read that failed with
// nothing to show is its error and its retry.
import { type FleetDashboardPeriodDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { periodLinks } from '../../lib/fleet-dashboard-links';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { type PeriodFilters } from '../../lib/fleet-dashboard-url';
import { CHIP, I, N, TabHead, type IconPath } from './dash-kit';
import { Phrase, ReadError, RefreshTools, TabSkeleton } from './dash-shell';
import { PeriodFilterBar } from './period-filter-bar';
import { PeriodFiguresTab, type PeriodBodyProps } from './tab-period';

export interface PeriodTabProps {
  tab: 'period';
  data: FleetDashboardPeriodDto | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** The ONE filter state of the period screens, as the address bar holds it. */
  filters: PeriodFilters;
  /** A new filter state: the page writes it to the address bar (`periodFiltersPatch`). */
  onFilters: (next: PeriodFilters) => void;
  /** When R2 last answered (ms since the epoch; 0 = not yet). */
  updatedAt: number;
  /** «تحديث»: refetch R2. */
  onRefresh: () => void;
  /** R2 is on its way: the «تحديث» icon spins and the button holds, as on the other tabs. */
  refreshing?: boolean;
  can: (permission: string) => boolean;
}

const ICON: Record<PeriodTabProps['tab'], IconPath> = {
  period: I.bars,
};

const BODY: Record<PeriodTabProps['tab'], (props: PeriodBodyProps) => JSX.Element> = {
  period: PeriodFiguresTab,
};

export const PeriodTab = (props: PeriodTabProps): JSX.Element => {
  const t = useT();
  const { data } = props;
  const Body = BODY[props.tab];

  let body: JSX.Element | null = null;
  if (data !== undefined) {
    body = <Body data={data} links={periodLinks(data)} can={props.can} onRetry={props.onRetry} />;
  } else if (props.error) {
    body = <ReadError error={null} onRetry={props.onRetry} />;
  } else if (props.loading) {
    body = <TabSkeleton />;
  }

  return (
    <div data-period-tab={props.tab}>
      <TabHead
        icon={ICON[props.tab]}
        tone="sky"
        live={false}
        title={t(`fleet.dash.shell.tab.${props.tab}`)}
        chips={
          data === undefined ? undefined : (
            <span data-period-range="true" className={CHIP}>
              <Phrase
                text={t('fleet.dash.filters.rangeHead')}
                parts={{
                  from: <N>{slashDay(data.range.from)}</N>,
                  to: <N>{slashDay(data.range.to)}</N>,
                }}
              />
            </span>
          )
        }
        end={
          <RefreshTools
            updatedAt={props.updatedAt}
            onRefresh={props.onRefresh}
            refreshing={props.refreshing ?? false}
          />
        }
      />
      <PeriodFilterBar
        filters={props.filters}
        onFilters={props.onFilters}
        data={data}
        can={props.can}
      />
      <div aria-busy={props.loading}>{body}</div>
    </div>
  );
};
