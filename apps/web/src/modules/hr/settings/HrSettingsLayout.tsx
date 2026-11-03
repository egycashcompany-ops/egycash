// «الإعدادات» — one HR page over the six screens that configure HR rather than run it.
//
// The bar above, the open section below. Each section is the screen it always was (its own header,
// its own actions), mounted under `/hr-settings/<key>`; the bar stays put while they change, so its
// pill slides from one to the next. A reader sees only the sections whose permission he holds —
// the same keys the routes check — so the page never offers a door that opens onto a 403.
import { Outlet, useLocation } from 'react-router-dom';
import { HR_SETTINGS_HUB } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SettingsTabBar, type SettingsTab } from './components/SettingsTabBar';

/** The sections this reader may open, in the hub's order. */
export const useSettingsTabs = (): SettingsTab[] => {
  const t = useT();
  const can = useCan();
  return HR_SETTINGS_HUB.tabs
    .filter((tab) => can(tab.permission))
    .map((tab) => ({
      key: tab.key,
      label: t(`hr.settings.tab.${tab.key}`),
      to: `${HR_SETTINGS_HUB.route}/${tab.key}`,
      group: tab.group,
    }));
};

export const HrSettingsLayout = (): JSX.Element => {
  const t = useT();
  const tabs = useSettingsTabs();
  const { pathname } = useLocation();
  const open = pathname.slice(HR_SETTINGS_HUB.route.length + 1).split('/')[0] ?? '';
  const active = tabs.some((tab) => tab.key === open) ? open : null;

  return (
    <>
      {/* Stuck to the top of the scrolling page like the Fleet bar, the page fading out under it.
          The side padding is PageContainer's, so the bar lines up with the section below. */}
      <div
        data-settings-sticky="true"
        className="sticky top-0 z-20 bg-[linear-gradient(to_bottom,#f8fafc_0,#f8fafc_calc(100%-14px),rgba(248,250,252,0))] px-4 pb-2 pt-6 sm:px-6 lg:px-8 lg:pt-8 dark:bg-[linear-gradient(to_bottom,#020617_0,#020617_calc(100%-14px),rgba(2,6,23,0))]"
      >
        <SettingsTabBar
          tabs={tabs}
          active={active}
          label={t('hr.settings.navLabel')}
          groupLabel={(group) => t(`hr.settings.group.${group}`)}
        />
      </div>
      <Outlet />
    </>
  );
};
