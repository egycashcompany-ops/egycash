// Switches the navigation shell: the LAUNCHPAD (one scoped column, modules chosen from the
// full-screen launcher) or the RAIL (a strip of module icons beside the module's page panel).
// Both are the same navigation over the same permissions, so this is a personal preference —
// it lives on the account (`MeDto.navLayout`) and follows the user to any device.
//
// A single button that toggles, not a two-segment control: with exactly two shells, a segmented
// control spends twice the header width to say the same thing. The icon shows the shell you would
// switch TO, and the tooltip names it.
import { useState } from 'react';
import { type NavLayout } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { GridIcon, SidebarIcon } from '../../shared/ui/icons';
import { updateMyPreferencesRequest } from '../auth/api';

export const NavLayoutToggle = (): JSX.Element | null => {
  const t = useT();
  const dispatch = useAppDispatch();
  const me = useAppSelector((state) => state.auth.me);
  const [saving, setSaving] = useState(false);

  if (me === null) return null;
  const current: NavLayout = me.navLayout;
  const next: NavLayout = current === 'launchpad' ? 'rail' : 'launchpad';
  const label = t(next === 'rail' ? 'nav.layout.toRail' : 'nav.layout.toLaunchpad');
  // The icon is the destination, matching the label: a rail when you would get the rail.
  const Icon = next === 'rail' ? SidebarIcon : GridIcon;

  const apply = (): void => {
    if (saving) return;
    setSaving(true);
    // The shell flips as soon as the account confirms it; a failure leaves the current shell in
    // place rather than showing one thing and storing another.
    void updateMyPreferencesRequest(next)
      .then((updated) => dispatch(signedIn(updated)))
      .finally(() => setSaving(false));
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
