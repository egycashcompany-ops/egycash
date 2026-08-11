// Arabic ⇄ English switch. Shared by the shell topbar and the login screen so the control (and its
// accessible label) stays identical wherever the user meets it.
//
// Since P9-B the choice is saved to the account when there is one — which is what finally makes the
// UI language and the language the SERVER writes in (the notification email) the same value. On the
// login and activation screens there is no account yet and the switch stays local, as before.
import { useT } from '../localization/useT';
import { usePreferences } from '../preferences/usePreferences';
import { GlobeIcon } from '../../shared/ui/icons';

export const LanguageToggle = (): JSX.Element => {
  const { locale, save } = usePreferences();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => save({ locale: locale === 'ar' ? 'en' : 'ar' })}
      className="flex items-center gap-1.5 rounded-lg p-2 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={locale === 'ar' ? 'English' : 'العربية'}
      title={t('account.preferences.language')}
    >
      <GlobeIcon className="h-5 w-5" />
      <span className="hidden font-medium sm:inline">{locale === 'ar' ? 'EN' : 'ع'}</span>
    </button>
  );
};
