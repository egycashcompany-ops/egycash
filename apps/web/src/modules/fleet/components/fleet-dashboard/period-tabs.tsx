// «حسب الفلاتر» — the five period tabs (6 «أرقام الفترة», 7 «الكيلومترات», 8 «ترتيب السيارات»,
// 9 «الصيانة», 10 «الحوادث»), all read from R2 and all under ONE filter state.
//
// HAND-OVER POINT H1 (unified.md §4): W-SHELL writes this file as a stub with the final
// `PeriodTabProps` / `PeriodTab`, and W-PERIOD owns it afterwards. The props are the contract between
// the page and the period tabs; a change to them is a hand-off, not an edit.
import { type FleetDashboardPeriodDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type PeriodFilters } from '../../lib/fleet-dashboard-url';
import { I, TabHead, type IconPath } from './dash-kit';
import { RefreshTools } from './dash-shell';

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
  can: (permission: string) => boolean;
}

const ICON: Record<PeriodTabProps['tab'], IconPath> = {
  period: I.bars,
  km: I.pin,
  ranking: I.rank,
  maintenance: I.cog,
  accidents: I.warn,
};

/** The stub: the tab's heading only. W-PERIOD draws the filter bar and the tab's cards below it. */
export const PeriodTab = (props: PeriodTabProps): JSX.Element => {
  const t = useT();
  return (
    <div data-period-tab={props.tab}>
      <TabHead
        icon={ICON[props.tab]}
        tone="sky"
        live={false}
        title={t(`fleet.dash.shell.tab.${props.tab}`)}
        end={<RefreshTools updatedAt={props.updatedAt} onRefresh={props.onRefresh} />}
      />
    </div>
  );
};
