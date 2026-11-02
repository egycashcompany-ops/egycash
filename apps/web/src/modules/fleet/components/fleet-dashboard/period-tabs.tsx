// «حسب الفلاتر» — the five period tabs (6 «أرقام الفترة», 7 «الكيلومترات», 8 «ترتيب السيارات»,
// 9 «الصيانة», 10 «الحوادث»), all read from R2 and all under ONE filter state.
//
// HAND-OVER POINT H1 (unified.md §4): W-SHELL writes this file as a stub with the final
// `PeriodTabProps` / `PeriodTab`, and W-PERIOD owns it afterwards. The props are the contract between
// the page and the period tabs; a change to them is a hand-off, not an edit.
//
// Each tab: its heading (the range the server echoed, «آخر تحديث قبل …» + «تحديث»), the shared filter
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
import { AccidentsTab } from './tab-accidents';
import { KmTab } from './tab-km';
import { MaintenanceTab } from './tab-maintenance';
import { PeriodFiguresTab, type PeriodBodyProps } from './tab-period';
import { RankingTab } from './tab-ranking';

export interface PeriodTabProps {
  tab: 'period' | 'km' | 'ranking' | 'maintenance' | 'accidents';
  data: FleetDashboardPeriodDto | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** The ONE filter state of the five tabs, as the address bar holds it. */
  filters: PeriodFilters;
  /** A new filter state: the page writes it to the address bar (`periodFiltersPatch`). */
  onFilters: (next: PeriodFilters) => void;
  /** When R2 last answered (ms since the epoch; 0 = not yet). */
  updatedAt: number;
  /** «تحديث»: refetch R2. */
  onRefresh: () => void;
  /** R2 is on its way: the «تحديث» icon spins and the button holds, as on tabs 1–5. */
  refreshing?: boolean;
  can: (permission: string) => boolean;
}

const ICON: Record<PeriodTabProps['tab'], IconPath> = {
  period: I.bars,
  km: I.pin,
  ranking: I.rank,
  maintenance: I.cog,
  accidents: I.warn,
};

const BODY: Record<PeriodTabProps['tab'], (props: PeriodBodyProps) => JSX.Element> = {
  period: PeriodFiguresTab,
  km: KmTab,
  ranking: RankingTab,
  maintenance: MaintenanceTab,
  accidents: AccidentsTab,
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
