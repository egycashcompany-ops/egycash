// «خلاص افصلهم»: SCREEN 1 «العهدة» — the money itself — has three tabs, each its own address and
// each remembering its own filters:
//   «سجل العهدة»         the fund's own history: every «طلب عهدة», «استعاضة», «تسوية» and what the
//                        receipts spent (`/fleet/custody/log`, where «العهدة» opens);
//   «المذكرات»            every memo — صيانة · وقود · كاوتش · غسيل — its status, «مذكرة جديدة»;
//   «لوحة تحكم العهدة»   the fund's part of the dashboard (`/fleet/custody/dashboard`).
// What the fund paid, kind by kind, is SCREEN 2 «مصروفات العهدة» (`/fleet/custody-expenses`), a menu
// row of its own with no tabs. The receipts dialog's switch (the fleet's way of picking one of
// several) on the custody card's surface, the active tab in the site's purple. The badges are the
// fund's own counts — operations made, memos saved — and say nothing until they are known. The head
// over the three (`CustodyFundHeader`) draws them under the fund now and its three actions.
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { useCustodyFundSummary } from '../api/fleet-queries';
import { BoardIcon, NUM, PATH } from './FuelCardBoard';
import { CAIRO } from './custody-dashboard-parts';
import { HISTORY_ICON, MEMO_ICON } from './custody-memo-parts';

export type CustodyTab = 'log' | 'memos' | 'dashboard';

const TAB_TRAY =
  'inline-flex max-w-full items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-[rgba(42,58,84,.65)] dark:bg-[#0d1424] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5)]';
/** The active tab in the site's purple, as a pressed toolbar button; the others in slate. */
export const custodyTabLook = (on: boolean): string =>
  cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-bold transition active:scale-[0.98] sm:gap-2 sm:px-4 sm:py-2 sm:text-sm',
    CAIRO,
    on
      ? 'bg-brand-600 text-white shadow-md shadow-brand-700/30'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white',
  );
const tabCount = (on: boolean): string =>
  cn(
    'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] leading-none',
    NUM,
    on
      ? 'bg-white/20 text-white'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  );

/** Which tab an address is on — the log and the memos with everything under them. */
export const custodyTabOf = (pathname: string): CustodyTab | null => {
  const path = pathname.replace(/\/+$/u, '');
  if (path === '/fleet/custody/log' || path.startsWith('/fleet/custody/log/')) return 'log';
  if (path === '/fleet/custody/memos' || path.startsWith('/fleet/custody/memos/')) return 'memos';
  if (path === '/fleet/custody/dashboard') return 'dashboard';
  return null;
};

const COUNT = new Intl.NumberFormat('en-US');

/**
 * «سجل العهدة · المذكرات · لوحة تحكم العهدة» — under the fund's head on each of the three pages. The
 * fund itself is not repeated here: the head shows it once, over the tabs.
 */
export const CustodyTabs = (): JSX.Element => {
  const t = useT();
  const { pathname } = useLocation();
  const fund = useCustodyFundSummary();
  const active = custodyTabOf(pathname);
  // While the counts are on their way (or failed), no badge: never a «0» that is not true.
  const known = fund.data !== undefined && !fund.isError;
  const tabs: {
    key: CustodyTab;
    to: string;
    label: string;
    icon: readonly string[];
    count: number | null;
    countTitle: string;
  }[] = [
    {
      key: 'log',
      to: '/fleet/custody/log',
      label: t('fleet.custody.tabs.ledger'),
      icon: HISTORY_ICON,
      count: known ? fund.data.operations : null,
      countTitle: t('fleet.custody.tabs.ledgerCount'),
    },
    {
      key: 'memos',
      to: '/fleet/custody/memos',
      label: t('fleet.custody.tabs.memos'),
      icon: MEMO_ICON,
      count: known ? fund.data.memos.count : null,
      countTitle: t('fleet.custody.tabs.memosCount'),
    },
    {
      key: 'dashboard',
      to: '/fleet/custody/dashboard',
      label: t('fleet.custody.dashboard.title'),
      icon: PATH.trend,
      count: null,
      countTitle: '',
    },
  ];
  return (
    <div
      data-custody-tabs="true"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2"
    >
      <nav role="tablist" aria-label={t('fleet.nav.custody')} className={TAB_TRAY}>
        {tabs.map((tab) => {
          const on = active === tab.key;
          return (
            <NavLink
              key={tab.key}
              to={tab.to}
              role="tab"
              aria-selected={on}
              data-custody-tab={tab.key}
              className={custodyTabLook(on)}
            >
              <BoardIcon d={tab.icon} className="h-4 w-4 shrink-0" />
              {tab.label}
              {tab.count !== null && (
                <span
                  data-custody-tab-count={tab.key}
                  title={tab.countTitle}
                  className={tabCount(on)}
                >
                  {COUNT.format(tab.count)}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
