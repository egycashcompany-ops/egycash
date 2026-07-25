// First-login gate screen (frozen auth design 4.2): shown instead of the app while the
// account carries `mustChangePassword`. There is nothing to escape to — the server rejects
// every other call with PASSWORD_CHANGE_REQUIRED; this screen is the only way forward.
import { useState } from 'react';
import { useAppDispatch } from '../../store';
import { signedIn } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { ThemeToggle } from '../layout/ThemeToggle';
import { LanguageToggle } from '../layout/LanguageToggle';
import { BrandMark, Button, Field, Form, Input } from '../../shared/ui';
import { AlertIcon } from '../../shared/ui/icons';
import { ApiError } from '../../shared/lib/api-client';
import { changePasswordRequest, fetchMe } from './api';

export const ForcePasswordChangePage = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (next !== confirm) {
      setError(t('platform.auth.gate.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePasswordRequest(current, next);
      // The gate cleared server-side — refresh the identity so the app unlocks.
      dispatch(signedIn(await fetchMe()));
    } catch (e) {
      setError(
        e instanceof ApiError && e.message !== '' ? e.message : t('platform.auth.gate.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <div className="absolute end-3 top-3 flex items-center gap-0.5">
        <ThemeToggle />
        <LanguageToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark size="sm" />
          <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">ECMS</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {t('platform.auth.gate.title')}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          {t('platform.auth.gate.subtitle')}
        </p>

        {error !== null && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6">
          <Form onSubmit={() => void submit()}>
            <Field label={t('platform.auth.gate.current')} htmlFor="gate-current">
              <Input
                id="gate-current"
                type="password"
                required
                autoComplete="current-password"
                dir="ltr"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label={t('platform.auth.gate.next')} htmlFor="gate-next">
              <Input
                id="gate-next"
                type="password"
                required
                autoComplete="new-password"
                dir="ltr"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field label={t('platform.auth.gate.confirm')} htmlFor="gate-confirm">
              <Input
                id="gate-confirm"
                type="password"
                required
                autoComplete="new-password"
                dir="ltr"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={busy} className="mt-2 w-full">
              {t('platform.auth.gate.submit')}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
};
