// Minimal authenticated shell for phase 2.1: identity, effective permissions,
// locale/RTL switch. The manifest-driven sidebar arrives with the first module.
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedOut } from '../../store/authSlice';
import { setLocale } from '../../store/localeSlice';
import { useT } from '../localization/useT';
import { logoutRequest } from '../auth/api';

export const Shell = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);

  if (me === null) return <></>;

  const signOut = async (): Promise<void> => {
    try {
      await logoutRequest();
    } finally {
      dispatch(signedOut());
      navigate('/login');
    }
  };

  const permissions = Object.entries(me.permissions).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between bg-slate-800 px-6 py-3 text-white">
        <span className="font-semibold">ECMS</span>
        <div className="flex items-center gap-4">
          <button
            onClick={() => dispatch(setLocale(locale === 'ar' ? 'en' : 'ar'))}
            className="text-sm underline"
          >
            {t('platform.shell.language')}
          </button>
          <button onClick={() => void signOut()} className="text-sm underline">
            {t('platform.shell.signOut')}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-lg font-semibold text-slate-800">
          {t('platform.shell.home.welcome')} — {me.name.firstName[locale]}{' '}
          {me.name.lastName[locale]}
        </h1>
        <p className="mb-6 text-sm text-slate-500" dir="ltr">
          {me.email}
        </p>
        <h2 className="mb-2 font-medium text-slate-700">
          {t('platform.shell.home.permissions')} ({permissions.length})
        </h2>
        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full text-sm">
            <tbody>
              {permissions.map(([key, scope]) => (
                <tr key={key} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-mono" dir="ltr">
                    {key}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {t('platform.shell.home.scope')}: {scope}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};
