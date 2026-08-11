// Public account-setup page (auth design §14): the employee opens the one-time link from
// WhatsApp/email (`/activate?token=…`), chooses their own policy-checked password, and the
// account activates. No session exists here — after success they sign in normally.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useT } from '../localization/useT';
import { ThemeToggle } from '../layout/ThemeToggle';
import { LanguageToggle } from '../layout/LanguageToggle';
import { BrandMark, Button, Field, Form, PasswordInput } from '../../shared/ui';
import { AlertIcon } from '../../shared/ui/icons';
import { ApiError } from '../../shared/lib/api-client';
import { activateRequest } from './api';
import { usePasswordPolicy } from './password-policy';
import { PasswordRequirements } from './PasswordRequirements';

export const ActivationPage = (): JSX.Element => {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: policy } = usePasswordPolicy();

  const submit = async (): Promise<void> => {
    if (password !== confirm) {
      setError(t('platform.auth.gate.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activateRequest(token, password);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'AUTH_ACTIVATION_TOKEN_INVALID'
          ? t('platform.auth.activate.invalid')
          : e instanceof ApiError && e.message !== ''
            ? e.message
            : t('platform.auth.gate.failed'),
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
          {t('platform.auth.activate.title')}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          {t('platform.auth.activate.subtitle')}
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

        {done ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('platform.auth.activate.done')}
            </p>
            <Link
              to="/login"
              className="inline-flex text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('platform.auth.login.submit')}
            </Link>
          </div>
        ) : token === '' ? (
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            {t('platform.auth.activate.missing')}
          </p>
        ) : (
          <div className="mt-6">
            <Form onSubmit={() => void submit()}>
              <Field label={t('platform.auth.gate.next')} htmlFor="activate-password">
                <PasswordInput
                  id="activate-password"
                  required
                  autoComplete="new-password"
                  aria-describedby="activate-password-rules"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {/* The rules the server is about to apply, read from it — this page has no session,
                    which is why the policy endpoint is public. */}
                <PasswordRequirements
                  id="activate-password-rules"
                  password={password}
                  policy={policy}
                />
              </Field>
              <Field label={t('platform.auth.gate.confirm')} htmlFor="activate-confirm">
                <PasswordInput
                  id="activate-confirm"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Button type="submit" loading={busy} className="mt-2 w-full">
                {t('platform.auth.activate.submit')}
              </Button>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
};
