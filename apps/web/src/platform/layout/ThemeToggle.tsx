// Light → dark → system theme cycle. Lives on its own so the shell topbar and the login screen
// render the exact same control instead of two drifting copies.
import { useTheme } from '../theme/useTheme';
import { useT } from '../localization/useT';
import { MonitorIcon, MoonIcon, SunIcon } from '../../shared/ui/icons';

export const ThemeToggle = (): JSX.Element => {
  const { theme, cycle } = useTheme();
  const t = useT();
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={t(`common.theme.${theme}`)}
      title={t(`common.theme.${theme}`)}
    >
      <Icon />
    </button>
  );
};
