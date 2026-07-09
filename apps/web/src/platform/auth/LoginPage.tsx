import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { type MeDto } from '@ecms/contracts';
import { useAppDispatch } from '../../store';
import { signedIn } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { loginRequest, totpChallengeRequest, totpEnrollWithChallengeRequest } from './api';

type Step =
  { kind: 'credentials' } | { kind: 'totp'; challengeToken: string; enrollSecret: string | null };

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

  const submitCredentials = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await loginRequest(email, password);
      if (!response.totpRequired) {
        finish(response.me);
        return;
      }
      let enrollSecret: string | null = null;
      if (response.enrollmentRequired) {
        const enrollment = await totpEnrollWithChallengeRequest(response.challengeToken);
        enrollSecret = enrollment.secret;
      }
      setStep({ kind: 'totp', challengeToken: response.challengeToken, enrollSecret });
    } catch {
      setError(t('platform.auth.login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-semibold text-slate-800">
          {t('platform.auth.login.title')}
        </h1>
        {step.kind === 'credentials' ? (
          <form onSubmit={(e) => void submitCredentials(e)} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">
                {t('platform.auth.login.email')}
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
                dir="ltr"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">
                {t('platform.auth.login.password')}
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
                dir="ltr"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-slate-800 py-2 text-white disabled:opacity-50"
            >
              {t('platform.auth.login.submit')}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void submitTotp(e)} className="space-y-4">
            {step.enrollSecret !== null && (
              <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                {t('platform.auth.login.enrollHint')}
                <code className="mt-2 block break-all text-xs" dir="ltr">
                  {step.enrollSecret}
                </code>
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">
                {t('platform.auth.login.totpCode')}
              </span>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
                dir="ltr"
                autoComplete="one-time-code"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-slate-800 py-2 text-white disabled:opacity-50"
            >
              {t('platform.auth.login.totpSubmit')}
            </button>
          </form>
        )}
        {error !== null && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
};
