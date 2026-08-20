// The customer's own sign-in.
//
// It is the SAME login: `loginRequest` against `POST /auth/login`, the same argon2id check, the
// same lockout, the same TOTP step (rendered because an administrator can force enrollment on any
// account), the same in-memory access token and the same refresh cookie. Only two things differ,
// and both are navigation rather than authentication: the branding says whose portal this is, and
// a successful sign-in lands on `/portal` instead of the staff home.
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { type MeDto } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../../store';
import { signedIn } from '../../../store/authSlice';
import { useT } from '../../../platform/localization/useT';
import { ThemeToggle } from '../../../platform/layout/ThemeToggle';
import { LanguageToggle } from '../../../platform/layout/LanguageToggle';
import { loginRequest, totpChallengeRequest } from '../../../platform/auth/api';
import { Button, Field, Form, Input, PasswordInput } from '../../../shared/ui';
import { AlertIcon } from '../../../shared/ui/icons';
import { ApiError } from '../../../shared/lib/api-client';
import { KeyIcon } from '../components/GoldIcons';

type Step = { kind: 'credentials' } | { kind: 'totp'; challengeToken: string };

export const PortalLoginPage = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useAppSelector((state) => state.auth.status);
  const external = useAppSelector((state) => state.auth.me?.external ?? null);

  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in as a customer — go straight in. An EMPLOYEE who lands here is left on the
  // form rather than bounced, because their session is not a portal session.
  if (status === 'signedIn' && external !== null && external.moduleId === 'gold') {
    return <Navigate to="/portal" replace />;
  }

  const finish = (me: MeDto): void => {
    dispatch(signedIn(me));
    navigate('/portal', { replace: true });
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (step.kind === 'credentials') {
        const response = await loginRequest(identifier.trim(), password);
        if (!response.totpRequired) {
          finish(response.me);
          return;
        }
        setStep({ kind: 'totp', challengeToken: response.challengeToken });
        return;
      }
      const response = await totpChallengeRequest(step.challengeToken, code);
      if (!response.totpRequired) finish(response.me);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'AUTH_ACCOUNT_NOT_ACTIVATED'
          ? t('gold.portal.login.notActivated')
          : t('gold.portal.login.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center bg-slate-50 px-6 py-16 dark:bg-slate-950">
      <div className="absolute end-3 top-3 flex items-center gap-0.5">
        <ThemeToggle />
        <LanguageToggle />
      </div>

      <div className="w-full max-w-sm">
        <header className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
            <KeyIcon className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {t('gold.portal.login.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('gold.portal.subtitle')}</p>
          </div>
        </header>

        <Form
          onSubmit={() => {
            void submit();
          }}
        >
          {step.kind === 'credentials' ? (
            <>
              <Field label={t('gold.portal.login.username')} required>
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                />
              </Field>
              <Field label={t('gold.portal.login.password')} required>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
            </>
          ) : (
            <Field label={t('gold.portal.login.totp')} required>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            </Field>
          )}

          {error !== null && (
            <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertIcon className="h-4 w-4" /> {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? t('gold.portal.login.busy') : t('gold.portal.login.submit')}
          </Button>
        </Form>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          {t('gold.portal.login.help')}
        </p>
      </div>
    </div>
  );
};
