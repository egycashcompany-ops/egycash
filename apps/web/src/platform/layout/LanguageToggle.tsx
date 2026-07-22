// Arabic ⇄ English switch. Shared by the shell topbar and the login screen so the control (and its
// accessible label) stays identical wherever the user meets it.
import { useAppDispatch, useAppSelector } from '../../store';
import { setLocale } from '../../store/localeSlice';
import { GlobeIcon } from '../../shared/ui/icons';

export const LanguageToggle = (): JSX.Element => {
  const dispatch = useAppDispatch();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <button
      type="button"
      onClick={() => dispatch(setLocale(locale === 'ar' ? 'en' : 'ar'))}
      className="flex items-center gap-1.5 rounded-lg p-2 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={locale === 'ar' ? 'English' : 'العربية'}
    >
      <GlobeIcon className="h-5 w-5" />
      <span className="hidden font-medium sm:inline">{locale === 'ar' ? 'EN' : 'ع'}</span>
    </button>
  );
};
