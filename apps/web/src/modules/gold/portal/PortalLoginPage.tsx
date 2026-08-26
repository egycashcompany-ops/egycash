// The customer's own sign-in.
//
// It is the SAME login: `loginRequest` against `POST /auth/login`, the same argon2id check, the
// same lockout, the same TOTP step (rendered because an administrator can force enrollment on any
// account), the same in-memory access token and the same refresh cookie. Only two things differ,
// and both are navigation rather than authentication: the branding says whose portal this is, and
// a successful sign-in lands on `/portal` instead of the staff home.
//
// The LAYOUT is the platform login's — a picture panel beside the form, the panel hidden on small
// screens so the form stays front and centre. What changes is the dress: the panel is black with a
// gold wash because that is what this vault looks like, and the picture in it is swappable
// (`PortalLoginArt`). Two logins, one skeleton.
//
// What this screen deliberately does NOT have, however common it is on a screen shaped like this:
// social sign-in and a "create an account" link. A portal account is issued by EGYCASH staff
// against a specific customer record — there is no self sign-up to link to, and no Google identity
// that could be mapped to a vault customer. A button that cannot work is worse than no button.
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
import { PortalLoginArt } from './PortalLoginArt';

type Step = { kind: 'credentials' } | { kind: 'totp'; challengeToken: string };

/**
 * EGYCASH, as this screen says it.
 *
 * The mark is the platform's `BrandMark` letter tile re-cut for a black panel — a real logo file
 * dropped in later replaces the `<span>` and nothing else on the page moves, because the wordmark
 * beside it carries the name either way.
 */
const EgycashLockup = ({ onDark = false }: { onDark?: boolean }): JSX.Element => (
  <div className="flex items-center gap-3">
    <span
      aria-hidden="true"
      className={
        onDark
          ? 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-base font-bold text-black shadow-[0_0_24px_-6px_rgba(251,191,36,0.7)]'
          : 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-sm font-bold text-black'
      }
    >
      E
    </span>
    <span
      className={
        onDark
          ? 'text-xl font-semibold tracking-tight text-white'
          : 'text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50'
      }
    >
      EGYCASH
    </span>
  </div>
);

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

  const onCredentials = step.kind === 'credentials';

  return (
    <div className="relative flex min-h-screen bg-white dark:bg-slate-950">
      {/*
        The picture panel. Black in BOTH themes, deliberately: it is a picture surface rather than
        a reading surface, and the artwork it holds is lit for black. The form beside it still
        follows the theme, so the toggle in the corner keeps meaning what it says.
      */}
      <aside className="relative hidden w-[46%] max-w-2xl overflow-hidden bg-[#0b0b0d] lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute -start-32 top-1/4 h-[28rem] w-[28rem] rounded-full bg-amber-500/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-amber-600/10 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <EgycashLockup onDark />

          <div className="my-8 flex min-h-0 flex-1 items-center justify-center">
            <div className="h-full max-h-[26rem] w-full max-w-md">
              <PortalLoginArt alt={t('gold.portal.login.artAlt')} />
            </div>
          </div>

          <div className="max-w-md space-y-4">
            <h2 className="text-3xl font-semibold leading-[1.2] tracking-tight text-white xl:text-4xl">
              {t('gold.portal.login.tagline')}
            </h2>
            <p className="text-base leading-relaxed text-slate-400">
              {t('gold.portal.login.taglineBody')}
            </p>
          </div>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 flex-col">
        <div className="absolute end-3 top-3 flex items-center gap-0.5">
          <ThemeToggle />
          <LanguageToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <div className="w-full max-w-sm">
            {/* On small screens the picture panel is hidden, so the mark is surfaced here. */}
            <div className="mb-10 lg:hidden">
              <EgycashLockup />
            </div>

            <header className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {onCredentials ? (
                  <>
                    {t('gold.portal.login.welcome')}{' '}
                    <span className="text-amber-600 dark:text-amber-400">
                      {t('gold.portal.login.welcomeAccent')}
                    </span>
                  </>
                ) : (
                  t('gold.portal.login.totp')
                )}
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                {onCredentials ? t('gold.portal.login.subtitle') : t('gold.portal.login.totpHint')}
              </p>
            </header>

            {error !== null && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Form
              onSubmit={() => {
                void submit();
              }}
            >
              {onCredentials ? (
                <>
                  <Field label={t('gold.portal.login.username')} required>
                    <Input
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      autoComplete="username"
                      placeholder={t('gold.portal.login.usernamePlaceholder')}
                    />
                  </Field>
                  <Field label={t('gold.portal.login.password')} required>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      placeholder={t('gold.portal.login.passwordPlaceholder')}
                    />
                  </Field>
                </>
              ) : (
                <Field label={t('gold.portal.login.totp')} required>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </Field>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="w-full justify-center border-0 bg-gradient-to-r from-amber-400 to-amber-600 font-semibold text-black shadow-[0_8px_24px_-10px_rgba(217,119,6,0.9)] hover:from-amber-300 hover:to-amber-500 focus-visible:outline-amber-500 disabled:opacity-60"
              >
                {busy ? t('gold.portal.login.busy') : t('gold.portal.login.submit')}
              </Button>
            </Form>

            <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('gold.portal.login.help')}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
