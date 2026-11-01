// «Fingerprint or face sign-in» on the Security page (ADR-035): the devices that can sign in to
// this account, adding this one, renaming and removing.
//
// Adding asks for the password again (and the TOTP code when the account has one) before the
// device's prompt — a session left open on a shared computer must not be enough to plant a key
// that outlives it. The form lives in a dialog that is only rendered when opened, so the page's
// markup is the same three password fields it always had until somebody presses «add».
//
// Shared with the gold portal, whose customers manage their own passkeys from its Security tab.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type PasskeyDto } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Field,
  Form,
  FormActions,
  Input,
  PasswordInput,
} from '../../shared/ui';
import { EditIcon, FingerprintIcon, TrashIcon } from '../../shared/ui/icons';
import { toast } from '../../shared/ui/toast/toast-store';
import { ApiError } from '../../shared/lib/api-client';
import { formatDateTime } from '../../shared/lib/format';
import {
  listPasskeysRequest,
  passkeyRegistrationOptionsRequest,
  removePasskeyRequest,
  renamePasskeyRequest,
} from '../auth/api';
import { passkeyFailure } from '../auth/passkey-failure';
import {
  addPasskey,
  cancelPasskeyPrompt,
  detectPasskeySupport,
  rememberPasskeyOffer,
  type PasskeySupport,
} from '../auth/passkeys';

export const PASSKEYS_QUERY_KEY = ['platform', 'auth', 'passkeys'] as const;

const AddPasskeyDialog = ({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}): JSX.Element => {
  const t = useT();
  const totpEnabled = useAppSelector((state) => state.auth.me?.totpEnabled ?? false);
  const userId = useAppSelector((state) => state.auth.me?.id ?? null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every close: an attempt that started before it must not go on to open the device's
  // prompt over a dialog the person has already dismissed (× and Escape work while it is busy).
  const attempt = useRef(0);

  const close = (): void => {
    attempt.current += 1;
    cancelPasskeyPrompt();
    setPassword('');
    setCode('');
    setError(null);
    onClose();
  };

  const submit = async (): Promise<void> => {
    const mine = (attempt.current += 1);
    const current = (): boolean => attempt.current === mine;
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyRegistrationOptionsRequest(
        totpEnabled ? { password, totpCode: code.trim() } : { password },
      );
      if (!current()) return;
      await addPasskey(options);
      if (!current()) return;
      if (userId !== null) rememberPasskeyOffer(userId, 'added');
      toast.success(t('account.security.passkeyAdded'));
      setPassword('');
      setCode('');
      onAdded();
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.code === 'AUTH_INVALID_CREDENTIALS') {
        setError(t('platform.auth.login.wrongPassword'));
      } else if (e instanceof ApiError && e.code === 'AUTH_TOTP_INVALID') {
        setError(t('platform.auth.login.badCode'));
      } else {
        const failure = passkeyFailure(e, navigator.onLine);
        if (failure !== null) setError(t(failure.key, failure.params));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('account.security.passkeyAdd')}
      description={t('account.security.passkeyAddBody')}
      dismissOnOutsideClick={false}
    >
      <Form onSubmit={() => void submit()}>
        {error !== null && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <Field label={t('platform.auth.gate.current')} htmlFor="passkey-add-password">
          <PasswordInput
            id="passkey-add-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {totpEnabled && (
          <Field label={t('platform.auth.login.totpCode')} htmlFor="passkey-add-totp">
            <Input
              id="passkey-add-totp"
              autoComplete="one-time-code"
              inputMode="numeric"
              dir="ltr"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        <FormActions>
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy} leftIcon={<FingerprintIcon className="h-4 w-4" />}>
            {t('account.security.passkeyContinue')}
          </Button>
        </FormActions>
      </Form>
    </Dialog>
  );
};

const RenamePasskeyDialog = ({
  passkey,
  onClose,
  onRenamed,
}: {
  passkey: PasskeyDto | null;
  onClose: () => void;
  onRenamed: () => void;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(passkey?.name ?? ''), [passkey]);

  const submit = async (): Promise<void> => {
    if (passkey === null) return;
    setBusy(true);
    try {
      await renamePasskeyRequest(passkey.id, name.trim());
      toast.success(t('account.security.passkeyRenamed'));
      onRenamed();
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.message !== '' ? e.message : t('platform.auth.login.unexpected'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={passkey !== null}
      onClose={onClose}
      title={t('account.security.passkeyRename')}
      dismissOnOutsideClick={false}
    >
      <Form onSubmit={() => void submit()}>
        <Field label={t('account.security.passkeyName')} htmlFor="passkey-rename">
          <Input
            id="passkey-rename"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy} disabled={name.trim() === ''}>
            {t('common.save')}
          </Button>
        </FormActions>
      </Form>
    </Dialog>
  );
};

const RemovePasskeyDialog = ({
  passkey,
  onClose,
  onRemoved,
}: {
  passkey: PasskeyDto | null;
  onClose: () => void;
  onRemoved: () => void;
}): JSX.Element => {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const remove = async (): Promise<void> => {
    if (passkey === null) return;
    setBusy(true);
    try {
      await removePasskeyRequest(passkey.id);
      toast.success(t('account.security.passkeyRemoved'));
      onRemoved();
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.message !== '' ? e.message : t('platform.auth.login.unexpected'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={passkey !== null}
      onClose={onClose}
      title={t('account.security.passkeyRemoveTitle')}
      description={t('account.security.passkeyRemoveBody', { name: passkey?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t('account.security.passkeyRemove')}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
};

export const PasskeysCard = (): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // Null until the browser has answered — «not supported» is not said before it is known.
  const [support, setSupport] = useState<PasskeySupport | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<PasskeyDto | null>(null);
  const [removing, setRemoving] = useState<PasskeyDto | null>(null);
  const {
    data: passkeys = [],
    error,
    refetch,
  } = useQuery({ queryKey: PASSKEYS_QUERY_KEY, queryFn: listPasskeysRequest, retry: false });

  useEffect(() => {
    let disposed = false;
    void detectPasskeySupport().then((detected) => {
      if (!disposed) setSupport(detected);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const code = error instanceof ApiError ? error.code : null;
  // An account that may not hold passkeys (none reach this page today) sees no card at all.
  if (code === 'AUTH_PASSKEY_NOT_ALLOWED') return null;
  const switchedOff = code === 'AUTH_PASSKEYS_DISABLED';

  return (
    <Card>
      <CardHeader
        title={t('account.security.passkeys')}
        actions={
          !switchedOff && support?.webauthn === true ? (
            <Button
              size="sm"
              leftIcon={<FingerprintIcon className="h-4 w-4" />}
              onClick={() => setAdding(true)}
            >
              {t('account.security.passkeyAdd')}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {switchedOff ? t('account.security.passkeysOff') : t('account.security.passkeysHint')}
        </p>
        {!switchedOff && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {passkeys.length === 0 && (
              <li className="py-3 text-sm text-slate-400">{t('account.security.passkeysEmpty')}</li>
            )}
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <FingerprintIcon className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium text-slate-700 dark:text-slate-200">
                      <span className="truncate">{passkey.name}</span>
                      {passkey.backedUp && (
                        <span title={t('account.security.passkeySyncedHint')}>
                          <Badge tone="neutral">{t('account.security.passkeySynced')}</Badge>
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {t('account.security.passkeyAddedOn', {
                        date: formatDateTime(passkey.createdAt, locale),
                      })}
                      {' · '}
                      {passkey.lastUsedAt === null
                        ? t('account.security.passkeyNeverUsed')
                        : t('account.security.passkeyLastUsed', {
                            date: formatDateTime(passkey.lastUsedAt, locale),
                          })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('account.security.passkeyRename')}
                    title={t('account.security.passkeyRename')}
                    onClick={() => setRenaming(passkey)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost-danger"
                    aria-label={t('account.security.passkeyRemove')}
                    title={t('account.security.passkeyRemove')}
                    onClick={() => setRemoving(passkey)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!switchedOff && support?.webauthn === false && (
          <p className="text-xs text-slate-400">{t('account.security.passkeyUnsupported')}</p>
        )}
      </CardBody>
      <AddPasskeyDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void refetch();
        }}
      />
      <RenamePasskeyDialog
        passkey={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          void refetch();
        }}
      />
      <RemovePasskeyDialog
        passkey={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          void refetch();
        }}
      />
    </Card>
  );
};
