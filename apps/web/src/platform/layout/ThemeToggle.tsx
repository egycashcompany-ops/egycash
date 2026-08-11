// Light → dark → system theme cycle. Lives on its own so the shell topbar and the login screen
// render the exact same control instead of two drifting copies.
//
// Since P9-B the choice is saved to the account when there is one, so it follows the user to any
// device — and it is applied locally first, so the screen changes under their hand rather than
// after a round trip. On the login and activation screens there is no account yet and the cycle
// stays local, exactly as it always was.
import { useT } from '../localization/useT';
import { usePreferences } from '../preferences/usePreferences';
import { MonitorIcon, MoonIcon, SunIcon } from '../../shared/ui/icons';
import { type ThemeMode } from '@ecms/contracts';

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };

export const ThemeToggle = (): JSX.Element => {
  const { theme, save } = usePreferences();
  const t = useT();
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      onClick={() => save({ theme: NEXT[theme] })}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={t(`common.theme.${theme}`)}
      title={t(`common.theme.${theme}`)}
    >
      <Icon />
    </button>
  );
};
