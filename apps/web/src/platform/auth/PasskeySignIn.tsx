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
  passkeyAssertion,
  passkeyOfferSuppressed,
  rememberPasskeyOffer,
  verifyPasskeyAssertion,
  type PasskeySupport,
} from './passkeys';

/**
 * A challenge lives five minutes on the server. The button never uses one older than four (it
 * would fetch a new one between the tap and the prompt instead); the background renews both at
 * three, a full check interval and more before that, so a tap always finds a fresh one and neither
 * is ever spent on a challenge the server has already dropped.
 */
const OPTIONS_FRESH_MS = 4 * 60_000;
const RENEW_AFTER_MS = 3 * 60_000;
/** How often an open sign-in page checks whether its challenges need renewing. */
const FRESHNESS_CHECK_MS = 30_000;

/** The field the autofill suggestion lives in. Gone (TOTP step, offer), there is nothing to arm. */
const autofillField = (): Element | null =>
  document.querySelector("input[autocomplete$='webauthn']");

/** A withdrawn or timed-out conditional request — the only device failures worth re-arming after. */
const endedQuietly = (error: unknown): boolean => {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return name === 'AbortError' || name === 'NotAllowedError' || code === 'ERROR_CEREMONY_ABORTED';
};

type SignedIn = Extract<LoginResponse, { totpRequired: false }>;

export interface PasskeySignIn {
  /** What this browser can do — all «no» until detected AND the server said passkeys are on. */
  support: PasskeySupport;
  busy: boolean;
  signIn: () => void;
}

/** What one mount of the hook exposes to the button: whether it is still on screen, and «re-arm». */
interface Mount {
  alive: () => boolean;
  rearm: () => void;
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
  const prefetched = useRef<{ options: PasskeyAuthenticationOptionsDto; at: number } | null>(null);
  // The button's prompt is open (or about to be). The autofill must not start then: starting it
  // would withdraw the person's Face ID sheet from under them.
  const modalActive = useRef(false);
  // Per mount, not shared: under StrictMode the first mount's async work outlives its cleanup, and
  // a shared «mounted» flag set true again by the second mount would let it carry on.
  const mount = useRef<Mount>({ alive: () => false, rearm: () => undefined });

  useEffect(() => {
    let disposed = false;
    let detected: PasskeySupport = NO_PASSKEY_SUPPORT;
    let armedAt = 0;
    let generation = 0;
    const alive = (): boolean => !disposed;

    const prefetch = async (): Promise<boolean> => {
      try {
        const options = await passkeyAuthenticationOptionsRequest();
        if (!disposed) prefetched.current = { options, at: Date.now() };
        return true;
      } catch {
        return false;
      }
    };

    /** The username field's suggestion, armed with its own challenge. */
    const armAutofill = async (): Promise<void> => {
      if (disposed || modalActive.current || !autofill || !detected.autofill) return;
      if (autofillField() === null) return;
      const mine = (generation += 1);
      let options: PasskeyAuthenticationOptionsDto;
      try {
        options = await passkeyAuthenticationOptionsRequest();
      } catch {
        return;
      }
      // Left the page, the button was pressed, or a newer arm took over while this one fetched.
      if (disposed || modalActive.current || mine !== generation) return;
      armedAt = Date.now();
      let answer: Awaited<ReturnType<typeof passkeyAssertion>>;
      try {
        answer = await passkeyAssertion(options, true);
      } catch (error) {
        // The device side never speaks: withdrawn (a newer arm, the button, leaving the page),
        // timed out, or unsupported. Withdrawn or timed out, the freshness check re-arms it; any
        // other failure waits out the normal cadence rather than retrying every tick.
        if (mine === generation && endedQuietly(error)) armedAt = 0;
        return;
      }
      // This arm is spent whatever the server says next; if re-arming after a refusal fails (no
      // connection yet), the freshness check tries again on its next tick.
      if (mine === generation) armedAt = 0;
      // The person picked a passkey: from here on a refusal — a locked account, a rate limit, a
      // dropped connection — is theirs to see, and the suggestion is offered again.
      try {
        const result = await verifyPasskeyAssertion(answer);
        if (!disposed && !result.totpRequired) handlers.current.onSignedIn(result);
      } catch (error) {
        if (disposed) return;
        const failure = passkeyFailure(error, navigator.onLine);
        if (failure !== null) handlers.current.onFailure(failure);
        void armAutofill();
      }
    };

    /**
     * Keep both challenges younger than the server's five minutes while the sign-in form is on
     * screen. Never while the person may be using the autofill suggestion — its field focused, or
     * the window handed to the device's own prompt — because re-arming withdraws whatever the
     * suggestion has started (a fingerprint sheet, a phone QR code). A challenge that does run out
     * during a long prompt is answered «expired, try again» and re-armed.
     */
    const keepFresh = (): void => {
      if (disposed || modalActive.current || !detected.webauthn) return;
      const field = autofillField();
      if (field === null) return;
      const now = Date.now();
      const entry = prefetched.current;
      if (entry === null || now - entry.at > RENEW_AFTER_MS) void prefetch();
      const inUse = document.activeElement === field || !document.hasFocus();
      if (autofill && detected.autofill && !inUse && now - armedAt > RENEW_AFTER_MS) {
        void armAutofill();
      }
    };

    mount.current = {
      alive,
      rearm: () => {
        void prefetch();
        void armAutofill();
      },
    };

    void (async () => {
      const found = await detectPasskeySupport();
      if (disposed || !found.webauthn) return;
      // Switched off, the server unreachable, or this page not the address the server accepts
      // answers from: no button rather than one that can only fail.
      if (!(await prefetch()) || disposed) return;
      const entry = prefetched.current;
      if (entry === null || !pageMatchesRelyingParty(entry.options)) return;
      detected = found;
      setSupport(found);
      void armAutofill();
    })();

    const timer = window.setInterval(keepFresh, FRESHNESS_CHECK_MS);
    // Background tabs run timers late, and a window that was elsewhere skipped its renewals:
    // coming back to it is when a stale challenge matters.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') keepFresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', keepFresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', keepFresh);
      cancelPasskeyPrompt();
    };
    // Once per mount: the handlers are read through a ref, so nothing here goes stale.
  }, []);

  const signIn = (): void => {
    const { alive, rearm } = mount.current;
    modalActive.current = true;
    setBusy(true);
    void (async () => {
      try {
        let entry = prefetched.current;
        prefetched.current = null;
        if (entry === null || Date.now() - entry.at > OPTIONS_FRESH_MS) {
          entry = { options: await passkeyAuthenticationOptionsRequest(), at: Date.now() };
        }
        // With a fresh challenge there is no await between the tap and the device prompt. Starting
        // it withdraws the autofill request, which ends quietly.
        const answer = await passkeyAssertion(entry.options);
        const result = await verifyPasskeyAssertion(answer);
        if (alive() && !result.totpRequired) handlers.current.onSignedIn(result);
      } catch (error) {
        if (!alive()) return;
        const failure = passkeyFailure(error, navigator.onLine);
        if (failure !== null) handlers.current.onFailure(failure);
      } finally {
        modalActive.current = false;
        if (alive()) {
          setBusy(false);
          // A new challenge for the next tap, and the suggestion back in the username field.
          rearm();
        }
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
  /** The password the person typed to sign in, used once to add the passkey and then dropped. */
  proof: { password: string };
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An account with TOTP is asked for a CURRENT code here. The one typed at sign-in has usually
  // rolled over by the time «turn on» is pressed (a code lives thirty seconds, and a backup code
  // cannot confirm this at all) — resending it would only burn one of the account's TOTP attempts
  // and write a failed sign-in for somebody who made no mistake.
  const askCode = me.totpEnabled;
  const [code, setCode] = useState('');

  useEffect(() => () => cancelPasskeyPrompt(), []);

  const enable = async (): Promise<void> => {
    // The code field is showing: a malformed code is answered here, not by a validation error.
    if (askCode && !/^\d{6}$/.test(code.trim())) {
      setError(t('platform.auth.login.badCode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyRegistrationOptionsRequest({
        password: proof.password,
        ...(askCode ? { totpCode: code.trim() } : {}),
      });
      await addPasskey(options);
      rememberPasskeyOffer(me.id, 'added');
      toast.success(t('platform.auth.passkey.offer.done'));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUTH_TOTP_INVALID') {
        setError(t('platform.auth.login.badCode'));
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
