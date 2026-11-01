// Signing in with a fingerprint or face (ADR-035), shared by the staff sign-in and the gold portal's.
//
// `usePasskeySignIn` does the device work for a sign-in screen. On mount it asks the browser what
// it can do and fetches a challenge from the server BEFORE any tap — older iPhones drop the tap's
// permission across a network call, and the server's answer also says whether passkeys are
// switched on at all (no answer, no button). Where the browser supports it, the passkey is also
// offered in the username field's autofill. Everything is withdrawn when the screen goes away.
//
// `PasskeyOffer` is the step after a password sign-in on a device that can hold a passkey: «sign in
// faster next time?». It adds the passkey with the password just typed (and the TOTP code, asking
// again if that one has expired), so the person is not sent to the Security page to retype both.
import { useEffect, useRef, useState } from 'react';
import {
  type LoginResponse,
  type MeDto,
  type PasskeyAuthenticationOptionsDto,
} from '@ecms/contracts';
import { useT } from '../localization/useT';
import { Button, Field, Input } from '../../shared/ui';
import { FingerprintIcon } from '../../shared/ui/icons';
import { toast } from '../../shared/ui/toast/toast-store';
import { ApiError } from '../../shared/lib/api-client';
import {
  listPasskeysRequest,
  passkeyAuthenticationOptionsRequest,
  passkeyRegistrationOptionsRequest,
} from './api';
import { type LoginFailure } from './login-failure';
import { passkeyFailure } from './passkey-failure';
import {
  NO_PASSKEY_SUPPORT,
  addPasskey,
  cancelPasskeyPrompt,
  detectPasskeySupport,
  pageMatchesRelyingParty,
  passkeyOfferSuppressed,
  rememberPasskeyOffer,
  signInWithPasskey,
  type PasskeySupport,
} from './passkeys';

/** A challenge lives five minutes on the server; one older than four is fetched afresh. */
const OPTIONS_FRESH_MS = 4 * 60_000;

type SignedIn = Extract<LoginResponse, { totpRequired: false }>;

export interface PasskeySignIn {
  /** What this browser can do — all «no» until detected AND the server said passkeys are on. */
  support: PasskeySupport;
  busy: boolean;
  signIn: () => void;
}

export const usePasskeySignIn = ({
  autofill,
  onSignedIn,
  onFailure,
}: {
  /** Offer passkeys in the username field — it must carry `autocomplete="username webauthn"`. */
  autofill: boolean;
  onSignedIn: (response: SignedIn) => void;
  onFailure: (failure: LoginFailure) => void;
}): PasskeySignIn => {
  const [support, setSupport] = useState<PasskeySupport>(NO_PASSKEY_SUPPORT);
  const [busy, setBusy] = useState(false);
  const handlers = useRef({ onSignedIn, onFailure });
  handlers.current = { onSignedIn, onFailure };
  const supportRef = useRef(support);
  supportRef.current = support;
  const prefetched = useRef<{ options: PasskeyAuthenticationOptionsDto; at: number } | null>(null);
  // Per mount, not shared: under StrictMode the first mount's async work outlives its cleanup, and
  // a shared «mounted» flag set true again by the second mount would let it carry on.
  const alive = useRef<() => boolean>(() => false);

  const prefetch = async (isAlive: () => boolean): Promise<boolean> => {
    try {
      const options = await passkeyAuthenticationOptionsRequest();
      if (isAlive()) prefetched.current = { options, at: Date.now() };
      return true;
    } catch {
      return false;
    }
  };

  const settle = (response: LoginResponse, isAlive: () => boolean): void => {
    if (isAlive() && !response.totpRequired) handlers.current.onSignedIn(response);
  };

  /** The autofill suggestion: waits in the background until the person picks a passkey there. */
  const armAutofill = async (isAlive: () => boolean): Promise<void> => {
    let options: PasskeyAuthenticationOptionsDto;
    try {
      options = await passkeyAuthenticationOptionsRequest();
    } catch {
      return;
    }
    if (!isAlive()) return;
    try {
      settle(await signInWithPasskey(options, true), isAlive);
    } catch (error) {
      const failure = passkeyFailure(error, true, true);
      // Only a server refusal of a passkey the person picked gets here; offer it again after.
      if (failure !== null && isAlive()) {
        handlers.current.onFailure(failure);
        void armAutofill(isAlive);
      }
    }
  };

  useEffect(() => {
    let disposed = false;
    const isAlive = (): boolean => !disposed;
    alive.current = isAlive;
    void (async () => {
      const detected = await detectPasskeySupport();
      if (disposed || !detected.webauthn) return;
      // Switched off, the server unreachable, or this page on another host than the passkeys'
      // domain: no button rather than one that can only fail.
      if (!(await prefetch(isAlive)) || disposed) return;
      const rpId = prefetched.current?.options.rpId ?? '';
      if (!pageMatchesRelyingParty(rpId)) return;
      setSupport(detected);
      if (autofill && detected.autofill) void armAutofill(isAlive);
    })();
    return () => {
      disposed = true;
      cancelPasskeyPrompt();
    };
    // Once per mount: the handlers are read through a ref, so nothing here goes stale.
  }, []);

  const signIn = (): void => {
    const isAlive = alive.current;
    setBusy(true);
    void (async () => {
      try {
        let entry = prefetched.current;
        prefetched.current = null;
        if (entry === null || Date.now() - entry.at > OPTIONS_FRESH_MS) {
          entry = { options: await passkeyAuthenticationOptionsRequest(), at: Date.now() };
        }
        // Starting this prompt withdraws the autofill one; that one ends quietly.
        settle(await signInWithPasskey(entry.options), isAlive);
      } catch (error) {
        if (!isAlive()) return;
        const failure = passkeyFailure(error, navigator.onLine);
        if (failure !== null) handlers.current.onFailure(failure);
        void prefetch(isAlive);
        if (autofill && supportRef.current.autofill) void armAutofill(isAlive);
      } finally {
        if (isAlive()) setBusy(false);
      }
    })();
  };

  return { support, busy, signIn };
};

/** «or», then the button — rendered only once the browser and the server both said yes. */
export const PasskeySignInButton = ({
  state,
  className,
}: {
  state: PasskeySignIn;
  className?: string;
}): JSX.Element | null => {
  const t = useT();
  if (!state.support.webauthn) return null;
  return (
    <div className={className}>
      <div className="my-5 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        {t('platform.auth.passkey.or')}
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-center"
        loading={state.busy}
        leftIcon={<FingerprintIcon className="h-5 w-5" />}
        onClick={state.signIn}
      >
        {t('platform.auth.passkey.signIn')}
      </Button>
    </div>
  );
};

/**
 * Should the person be offered a passkey after this password sign-in? Only on a device that can
 * hold one, with passkeys switched on, when the account has none yet anywhere (somebody who already
 * signs in with a phone is not asked again at every computer), not right before the forced password
 * change, and not if they said «not now» on this browser in the last thirty days.
 */
export const shouldOfferPasskey = async (
  response: SignedIn,
  support: PasskeySupport,
): Promise<boolean> => {
  if (!support.platform || response.mustChangePassword) return false;
  if (passkeyOfferSuppressed(response.me.id)) return false;
  try {
    return (await listPasskeysRequest()).length === 0;
  } catch {
    return false;
  }
};

export const PasskeyOffer = ({
  me,
  proof,
  onDone,
}: {
  me: MeDto;
  /** What the person typed to sign in, used once to add the passkey and then dropped. */
  proof: { password: string; totpCode?: string };
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The code typed at sign-in may have expired by the time «turn on» is pressed; then ask again.
  const [askCode, setAskCode] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => () => cancelPasskeyPrompt(), []);

  const enable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const totpCode = askCode ? code.trim() : proof.totpCode;
    try {
      const options = await passkeyRegistrationOptionsRequest({
        password: proof.password,
        ...(totpCode === undefined ? {} : { totpCode }),
      });
      await addPasskey(options);
      rememberPasskeyOffer(me.id, 'added');
      toast.success(t('platform.auth.passkey.offer.done'));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUTH_TOTP_INVALID') {
        if (askCode) setError(t('platform.auth.login.badCode'));
        setAskCode(true);
        return;
      }
      // Already on this device: nothing to add, and nothing to offer again.
      if ((e as { code?: unknown }).code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        rememberPasskeyOffer(me.id, 'added');
        onDone();
        return;
      }
      const failure = passkeyFailure(e, navigator.onLine);
      if (failure !== null) setError(t(failure.key, failure.params));
    } finally {
      setBusy(false);
    }
  };

  const later = (): void => {
    rememberPasskeyOffer(me.id, 'declined');
    onDone();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/60 dark:bg-brand-950/40">
        <FingerprintIcon className="mt-0.5 h-8 w-8 shrink-0 text-brand-600 dark:text-brand-400" />
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          {t('platform.auth.passkey.offer.body')}
        </p>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {askCode && (
        <Field label={t('platform.auth.passkey.offer.totpHint')} htmlFor="passkey-offer-totp">
          <Input
            id="passkey-offer-totp"
            autoComplete="one-time-code"
            inputMode="numeric"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      )}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="w-full justify-center"
          loading={busy}
          leftIcon={<FingerprintIcon className="h-5 w-5" />}
          onClick={() => void enable()}
        >
          {t('platform.auth.passkey.offer.enable')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-center"
          disabled={busy}
          onClick={later}
        >
          {t('platform.auth.passkey.offer.later')}
        </Button>
      </div>
    </div>
  );
};
