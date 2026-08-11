// Switches the navigation shell: the LAUNCHPAD (one scoped column, modules chosen from the
// full-screen launcher) or the RAIL (a strip of module icons beside the module's page panel).
// Both are the same navigation over the same permissions, so this is a personal preference —
// it lives on the account (`MeDto.navLayout`) and follows the user to any device.
//
// A single button that toggles, not a two-segment control: with exactly two shells, a segmented
// control spends twice the header width to say the same thing. The icon shows the shell you would
// switch TO, and the tooltip names it.
import { type NavLayout } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { usePreferences } from '../preferences/usePreferences';
import { cn } from '../../shared/lib/cn';
import { GridIcon, SidebarIcon } from '../../shared/ui/icons';

export const NavLayoutToggle = (): JSX.Element | null => {
  const t = useT();
  const me = useAppSelector((state) => state.auth.me);
  const { navLayout, saving, save } = usePreferences();

  if (me === null) return null;
  const next: NavLayout = navLayout === 'launchpad' ? 'rail' : 'launchpad';
  const label = t(next === 'rail' ? 'nav.layout.toRail' : 'nav.layout.toLaunchpad');
  // The icon is the destination, matching the label: a rail when you would get the rail.
  const Icon = next === 'rail' ? SidebarIcon : GridIcon;

  const apply = (): void => {
    if (saving) return;
    // The shell flips as soon as the account confirms it — there is no local copy of `navLayout`
    // to move ahead of the record, so unlike the other two this one is not optimistic.
    save({ navLayout: next });
  };

  return (
    <button
      type="button"
      onClick={apply}
      disabled={saving}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100',
        'disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
};
