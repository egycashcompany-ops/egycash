// «جاهزون للتعيين»'s bar — A28: «عاوز اعمل toggle switch في جاهزون للتعيين … بين مستندات الوظائف و حاجه
// اسمها المعينون … و هيبقا منظر ال toggle … زي اللي موجود فيي الاعدادت فال hr»; «شبه اللي موجوده
// فالاعدات فوق كدا ملهاش دعوه باللي فالجدول و تبقا مستندات الوظائف و المعينون بس».
//
// The settings bar itself (`SettingsTabBar`), stuck to the top of the page above the screen under it,
// with two sections only. «جاهزون للتعيين»'s own table is the page with neither pressed; pressing a
// section opens it under the bar, and pressing it again closes it back to the table — the toggle.
// Each section is a link with its own address, so it can be bookmarked and reached with Back. A
// reader sees only the sections whose permission he holds — the same keys the routes check.
import { Outlet, useLocation } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { UsersIcon } from '../../../../../shared/ui/icons';
import { SettingsTabBar, type SettingsTab } from '../../../settings/components/SettingsTabBar';

export const READY_ROUTE = '/employees/ready';

/** The bar's sections, in order, each with the permission its route checks. */
export const READY_SECTIONS = [
  { key: 'job-papers', permission: 'contractTemplate.manage', label: 'employees.readyHub.jobPapers' },
  { key: 'hired', permission: 'contract.print', label: 'employees.readyHub.hired' },
] as const;

/** The open section in `pathname`, or null on the table itself. */
export const readySectionOf = (pathname: string): string | null => {
  const rest = pathname.startsWith(`${READY_ROUTE}/`) ? pathname.slice(READY_ROUTE.length + 1) : '';
  const key = rest.split('/')[0] ?? '';
  return READY_SECTIONS.some((section) => section.key === key) ? key : null;
};

/** A section's link: open it — or, when it is the open one, close it back to the table. */
export const readySectionLink = (key: string, active: string | null): string =>
  key === active ? READY_ROUTE : `${READY_ROUTE}/${key}`;

export const ReadyHubLayout = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { pathname } = useLocation();
  const active = readySectionOf(pathname);
  const tabs: SettingsTab[] = READY_SECTIONS.filter((section) => can(section.permission)).map((section) => ({
    key: section.key,
    label: t(section.label),
    to: readySectionLink(section.key, active),
    group: 'ready',
  }));

  return (
    <>
      {tabs.length > 0 && (
        // As the settings bar sits: stuck to the top, the page fading out under it, PageContainer's
        // side padding so it lines up with the screen below.
        <div
          data-ready-bar="true"
          className="sticky top-0 z-20 bg-[linear-gradient(to_bottom,#f8fafc_0,#f8fafc_calc(100%-14px),rgba(248,250,252,0))] px-4 pb-2 pt-6 sm:px-6 lg:px-8 lg:pt-8 dark:bg-[linear-gradient(to_bottom,#020617_0,#020617_calc(100%-14px),rgba(2,6,23,0))]"
        >
          <SettingsTabBar
            tabs={tabs}
            active={active}
            label={t('employees.readyHub.label')}
            groupLabel={() => t('employees.readyHub.label')}
            icon={UsersIcon}
          />
        </div>
      )}
      <Outlet />
    </>
  );
};
