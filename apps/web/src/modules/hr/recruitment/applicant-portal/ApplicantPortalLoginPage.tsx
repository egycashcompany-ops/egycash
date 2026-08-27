// The candidate's own sign-in — two numbers, then a code (P-HR-APP §4).
//
// EVERY REFUSAL LOOKS THE SAME, and the screen is built so it cannot accidentally stop being true.
// The first step always advances to the code form, because the server always answers the same
// `accepted: true` whether the two numbers matched a candidate, matched nobody, or matched
// somebody who was refused after screening. A screen that skipped ahead only for real candidates
// would hand anybody holding a national ID a way to ask this company whether its owner applied
// here — which is exactly the leak the undistinguishing answer exists to prevent.
//
// So the wrong-number case is indistinguishable from the right one until a code is entered, and
// then it is one message: «الرقم غير صحيح».
//
// The layout is the gold portal's login re-dressed, which is itself the platform login's skeleton.
// Two numbers instead of a password is the only structural difference, and it is the point.
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PORTAL_CHALLENGE_CODE_LENGTH, type MeDto } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../../../store';
import { signedIn } from '../../../../store/authSlice';
import { useT } from '../../../../platform/localization/useT';
import { ThemeToggle } from '../../../../platform/layout/ThemeToggle';
import { LanguageToggle } from '../../../../platform/layout/LanguageToggle';
import { completePortalChallenge, startPortalChallenge } from '../../../../platform/auth/api';
import { Button, Field, Form, Input } from '../../../../shared/ui';
import { AlertIcon } from '../../../../shared/ui/icons';
import { APPLICANT_PORTAL_SUBJECT } from './subject';

type Step = 'identify' | 'code';

/** Digits only, and only as many as a code has — a paste of «كود: 123456» still works. */
const digits = (value: string, max: number): string => value.replace(/\D/g, '').slice(0, max);

export const ApplicantPortalLoginPage = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useAppSelector((state) => state.auth.status);
  const external = useAppSelector((state) => state.auth.me?.external ?? null);

  const [step, setStep] = useState<Step>('identify');
  const [nationalId, setNationalId] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // The resend timer. Purely a courtesy — the server rations sends whatever this shows, so a
  // reloaded page cannot buy anybody an extra message.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = window.setTimeout(() => {
      setCooldown((n) => n - 1);
    }, 1000);
    return () => {
      window.clearTimeout(id);
    };
  }, [cooldown]);

  if (status === 'signedIn' && external !== null && external.subjectType === APPLICANT_PORTAL_SUBJECT) {
    return <Navigate to="/applicant-portal" replace />;
  }

  const finish = (me: MeDto): void => {
    dispatch(signedIn(me));
    navigate('/applicant-portal', { replace: true });
  };

  const send = async (): Promise<void> => {
    const answer = await startPortalChallenge(
      APPLICANT_PORTAL_SUBJECT,
      nationalId.trim(),
      phone.trim(),
    );
    setCooldown(answer.retryAfterSeconds);
    // ALWAYS forward. See the header: branching here is the leak.
    setStep('code');
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (step === 'identify') {
        await send();
        return;
      }
      const response = await completePortalChallenge(
        APPLICANT_PORTAL_SUBJECT,
        nationalId.trim(),
        phone.trim(),
        code,
      );
      if (!response.totpRequired) finish(response.me);
    } catch {
      // One message for every way this fails — wrong code, expired code, spent attempts, and a
      // national ID that belongs to nobody are one answer here by design.
      setError(t('hr.applicantPortal.login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCode('');
    try {
      await send();
    } catch {
      setError(t('hr.applicantPortal.login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const identifying = step === 'identify';
  const canSubmit = identifying
    ? nationalId.trim() !== '' && phone.trim() !== ''
    : code.length === PORTAL_CHALLENGE_CODE_LENGTH;

  return (
    <div className="relative flex min-h-screen bg-white dark:bg-slate-950">
      <aside className="relative hidden w-[46%] max-w-2xl overflow-hidden bg-[#0b0b0d] lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute -start-32 top-1/4 h-[28rem] w-[28rem] rounded-full bg-sky-500/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-sky-600/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-300 to-sky-600 text-base font-bold text-black"
            >
              E
            </span>
            <span className="text-xl font-semibold tracking-tight text-white">EGYCASH</span>
          </div>
          <div className="max-w-md space-y-4">
            <h2 className="text-3xl font-semibold leading-[1.2] tracking-tight text-white xl:text-4xl">
              {t('hr.applicantPortal.login.tagline')}
            </h2>
            <p className="text-base leading-relaxed text-slate-400">
              {t('hr.applicantPortal.login.taglineBody')}
            </p>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-end gap-2 p-4">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm space-y-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {t('hr.applicantPortal.login.title')}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {identifying
                  ? t('hr.applicantPortal.login.subtitle')
                  : t('hr.applicantPortal.login.codeSubtitle')}
              </p>
            </header>

            {error !== null && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
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
              {identifying ? (
                <>
                  <Field label={t('hr.applicantPortal.login.nationalId')} htmlFor="portal-national-id">
                    <Input
                      id="portal-national-id"
                      inputMode="numeric"
                      autoComplete="off"
                      value={nationalId}
                      onChange={(e) => {
                        setNationalId(digits(e.target.value, 14));
                      }}
                    />
                  </Field>
                  <Field label={t('hr.applicantPortal.login.phone')} htmlFor="portal-phone">
                    <Input
                      id="portal-phone"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(digits(e.target.value, 15));
                      }}
                    />
                  </Field>
                </>
              ) : (
                <Field
                  label={t('hr.applicantPortal.login.code')}
                  htmlFor="portal-code"
                  hint={t('hr.applicantPortal.login.codeHint')}
                >
                  <Input
                    id="portal-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    className="text-center text-lg tracking-[0.5em]"
                    value={code}
                    onChange={(e) => {
                      setCode(digits(e.target.value, PORTAL_CHALLENGE_CODE_LENGTH));
                    }}
                  />
                </Field>
              )}

              <Button type="submit" className="w-full" disabled={busy || !canSubmit}>
                {identifying
                  ? t('hr.applicantPortal.login.send')
                  : t('hr.applicantPortal.login.signIn')}
              </Button>
            </Form>

            {!identifying && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-slate-600 underline-offset-4 hover:underline dark:text-slate-400"
                  onClick={() => {
                    setStep('identify');
                    setCode('');
                    setError(null);
                  }}
                >
                  {t('hr.applicantPortal.login.changeNumbers')}
                </button>
                <button
                  type="button"
                  className="text-sky-700 underline-offset-4 hover:underline disabled:opacity-50 dark:text-sky-400"
                  disabled={busy || cooldown > 0}
                  onClick={() => {
                    void resend();
                  }}
                >
                  {cooldown > 0
                    ? t('hr.applicantPortal.login.resendIn', { seconds: String(cooldown) })
                    : t('hr.applicantPortal.login.resend')}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
