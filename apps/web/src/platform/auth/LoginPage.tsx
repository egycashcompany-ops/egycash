// The first thing anyone sees. A branded split screen: an ECMS identity panel (brand gradient,
// wordmark, promise) beside a focused sign-in card built from the shared form primitives — so the
// login speaks the same design language as the rest of the shell, in light or dark, LTR or RTL.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { type MeDto } from '@ecms/contracts';
import { useAppDispatch } from '../../store';
import { signedIn } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { ThemeToggle } from '../layout/ThemeToggle';
import { LanguageToggle } from '../layout/LanguageToggle';
import { BrandMark, Button, Field, Form, Input } from '../../shared/ui';
import { AlertIcon } from '../../shared/ui/icons';
import { loginRequest, totpChallengeRequest, totpEnrollWithChallengeRequest } from './api';

interface Enrollment {
  secret: string;
  otpauthUrl: string;
}
type Step =
  | { kind: 'credentials' }
  | { kind: 'totp'; challengeToken: string; enroll: Enrollment | null };

export const LoginPage = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (me: MeDto): void => {
    dispatch(signedIn(me));
    navigate('/');
  };

  const submitCredentials = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await loginRequest(email, password);
      if (!response.totpRequired) {
        finish(response.me);
        return;
      }
      let enroll: Enrollment | null = null;
      if (response.enrollmentRequired) {
        enroll = await totpEnrollWithChallengeRequest(response.challengeToken);
      }
      setStep({ kind: 'totp', challengeToken: response.challengeToken, enroll });
    } catch {
      setError(t('platform.auth.login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (): Promise<void> => {
    if (step.kind !== 'totp') return;
    setBusy(true);
    setError(null);
    try {
      const response = await totpChallengeRequest(step.challengeToken, code);
      if (!response.totpRequired) finish(response.me);
    } catch {
      setError(t('platform.auth.login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const onCredentials = step.kind === 'credentials';

  return (
    <div className="relative flex min-h-screen bg-white dark:bg-slate-950">
      {/* Brand panel — the ECMS personality. Hidden on small screens to keep the form front and centre. */}
      <aside className="relative hidden w-[46%] max-w-2xl overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.14)_1px,transparent_0)] [background-size:22px_22px]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -start-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-28 -end-16 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative flex flex-1 flex-col justify-between p-12 text-white xl:p-16">
          <div className="flex items-center gap-3">
            <BrandMark variant="onBrand" size="md" />
            <span className="text-lg font-semibold tracking-tight">ECMS</span>
          </div>

          <div className="max-w-md space-y-5">
            <h2 className="text-4xl font-semibold leading-[1.15] tracking-tight">
              {t('platform.auth.brand.tagline')}
            </h2>
            <p className="text-lg leading-relaxed text-brand-100/90">
              {t('platform.auth.brand.subtitle')}
            </p>
          </div>

          <p className="text-sm font-medium tracking-wide text-brand-200/80">
            {t('platform.auth.brand.footer')}
          </p>
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
            {/* On small screens the brand panel is hidden, so surface the mark here. */}
            <div className="mb-10 flex items-center gap-2.5 lg:hidden">
              <BrandMark size="sm" />
              <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">ECMS</span>
            </div>

            <header className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {onCredentials ? t('platform.auth.login.welcome') : t('platform.auth.login.totpSubmit')}
              </h1>
              {onCredentials && (
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  {t('platform.auth.login.subtitle')}
                </p>
              )}
            </header>

            {error !== null && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {onCredentials ? (
              <Form onSubmit={() => void submitCredentials()}>
                <Field label={t('platform.auth.login.email')} htmlFor="login-email">
                  <Input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="username"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label={t('platform.auth.login.password')} htmlFor="login-password">
                  <Input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Button type="submit" loading={busy} className="mt-2 w-full">
                  {t('platform.auth.login.submit')}
                </Button>
              </Form>
            ) : (
              <Form onSubmit={() => void submitTotp()}>
                {step.kind === 'totp' && step.enroll !== null && (
                  <div className="space-y-3">
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                      {t('platform.auth.login.enrollHint')}
                    </p>
                    <div className="flex justify-center">
                      {/* White backing so the code stays scannable in dark mode. */}
                      <div className="rounded-xl bg-white p-3 shadow-card ring-1 ring-slate-200">
                        <QRCodeSVG
                          value={step.enroll.otpauthUrl}
                          size={168}
                          marginSize={0}
                          aria-label={t('platform.auth.login.enrollQrAlt')}
                        />
                      </div>
                    </div>
                    <details className="text-xs text-slate-500 dark:text-slate-400">
                      <summary className="cursor-pointer select-none">
                        {t('platform.auth.login.enrollManual')}
                      </summary>
                      <code
                        className="mt-2 block break-all rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        dir="ltr"
                      >
                        {step.enroll.secret}
                      </code>
                    </details>
                  </div>
                )}
                <Field label={t('platform.auth.login.totpCode')} htmlFor="login-totp">
                  <Input
                    id="login-totp"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    dir="ltr"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <Button type="submit" loading={busy} className="mt-2 w-full">
                  {t('platform.auth.login.totpSubmit')}
                </Button>
              </Form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
