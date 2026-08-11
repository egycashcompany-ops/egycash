// Self-service Security page (frozen auth design §6.3): change password, manage the
// authenticator (enroll with QR / disable), and review + revoke active sessions.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn } from '../../store/authSlice';
import { useT } from '../localization/useT';
import { PageContainer, PageHeader } from '../layout/PageContainer';
import { Badge, Button, Card, CardBody, CardHeader, Field, Form, FormActions, Input, PasswordInput } from '../../shared/ui';
import { toast } from '../../shared/ui/toast/toast-store';
import { ApiError } from '../../shared/lib/api-client';
import { formatDateTime } from '../../shared/lib/format';
import { usePasswordPolicy } from '../auth/password-policy';
import { PasswordRequirements } from '../auth/PasswordRequirements';
import {
  changePasswordRequest,
  fetchMe,
  listSessionsRequest,
  revokeSessionRequest,
  totpDisableRequest,
  totpEnrollRequest,
  totpVerifyRequest,
} from '../auth/api';

const ChangePasswordCard = (): JSX.Element => {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: policy } = usePasswordPolicy();

  const submit = async (): Promise<void> => {
    if (next !== confirm) {
      toast.error(t('platform.auth.gate.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await changePasswordRequest(current, next);
      toast.success(t('account.security.passwordChanged'));
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast.error(e instanceof ApiError && e.message !== '' ? e.message : t('platform.auth.gate.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t('account.security.password')} />
      <CardBody>
        <Form onSubmit={() => void submit()}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('platform.auth.gate.current')} htmlFor="security-current">
              <PasswordInput id="security-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field label={t('platform.auth.gate.next')} htmlFor="security-next">
              <PasswordInput id="security-next" autoComplete="new-password" aria-describedby="security-next-rules" value={next} onChange={(e) => setNext(e.target.value)} required />
            </Field>
            <Field label={t('platform.auth.gate.confirm')} htmlFor="security-confirm">
              <PasswordInput id="security-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </Field>
          </div>
          {/* Below the row rather than under the middle column: the checklist is a paragraph of
              text and would squeeze the three-column grid into unreadable strips. */}
          <PasswordRequirements id="security-next-rules" password={next} policy={policy} />
          <FormActions>
            <Button type="submit" loading={busy}>{t('platform.auth.gate.submit')}</Button>
          </FormActions>
        </Form>
      </CardBody>
    </Card>
  );
};

const TotpCard = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((state) => state.auth.me?.totpEnabled ?? false);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMe = async (): Promise<void> => {
    dispatch(signedIn(await fetchMe()));
  };

  const begin = async (): Promise<void> => {
    setBusy(true);
    try {
      setEnrollment(await totpEnrollRequest());
      setBackupCodes(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await totpVerifyRequest(code.trim());
      setBackupCodes(result.backupCodes);
      setEnrollment(null);
      setCode('');
      await refreshMe();
      toast.success(t('account.security.totpEnabled'));
    } catch {
      toast.error(t('account.security.totpBadCode'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (): Promise<void> => {
    setBusy(true);
    try {
      await totpDisableRequest(code.trim());
      setCode('');
      await refreshMe();
      toast.success(t('account.security.totpDisabled'));
    } catch {
      toast.error(t('account.security.totpBadCode'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('account.security.totp')}
        actions={
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? t('account.security.totpOn') : t('account.security.totpOff')}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {backupCodes !== null && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/40">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t('account.security.backupCodes')}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-amber-900 dark:text-amber-100" dir="ltr">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
        )}
        {!enabled && enrollment === null && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500">{t('account.security.totpHint')}</p>
            <Button size="sm" onClick={() => void begin()} loading={busy}>
              {t('account.security.totpEnable')}
            </Button>
          </div>
        )}
        {enrollment !== null && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3 shadow-card ring-1 ring-slate-200">
                <QRCodeSVG value={enrollment.otpauthUrl} size={168} marginSize={0} />
              </div>
            </div>
            <details className="text-xs text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer select-none">{t('platform.auth.login.enrollManual')}</summary>
              <code className="mt-2 block break-all rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200" dir="ltr">
                {enrollment.secret}
              </code>
            </details>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field label={t('platform.auth.login.totpCode')}>
                  <Input dir="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
                </Field>
              </div>
              <Button onClick={() => void verify()} loading={busy}>
                {t('account.security.totpConfirm')}
              </Button>
            </div>
          </div>
        )}
        {enabled && (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label={t('account.security.totpDisableCode')}>
                <Input dir="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </div>
            <Button variant="danger" onClick={() => void disable()} loading={busy}>
              {t('account.security.totpDisable')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

const SessionsCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data: sessions = [], refetch } = useQuery({
    queryKey: ['platform', 'auth', 'sessions'],
    queryFn: listSessionsRequest,
  });

  const revoke = async (id: string): Promise<void> => {
    await revokeSessionRequest(id);
    toast.success(t('account.security.sessionRevoked'));
    await refetch();
  };

  return (
    <Card>
      <CardHeader title={t('account.security.sessions')} />
      <CardBody>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-slate-700 dark:text-slate-200" dir="ltr">
                  {s.userAgent ?? t('account.security.unknownDevice')}
                </p>
                <p className="text-xs text-slate-400" dir="ltr">
                  {s.ip ?? '—'} · {formatDateTime(s.lastUsedAt, locale)}
                </p>
              </div>
              {s.current ? (
                <Badge tone="success">{t('account.security.thisDevice')}</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)}>
                  {t('account.security.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
};

export const SecurityPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('account.security.title')} description={t('account.security.subtitle')} />
      <div className="space-y-6">
        <ChangePasswordCard />
        <TotpCard />
        <SessionsCard />
      </div>
    </PageContainer>
  );
};

export default SecurityPage;
