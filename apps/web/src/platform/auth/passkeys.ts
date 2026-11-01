// The device side of passkeys (ADR-035): asking the browser what it can do, and running the two
// prompts. Everything that touches the browser library is here, and nothing here runs at import:
// every function reads browser globals, so callers use them from effects and handlers only — the
// screens render in node for their specs.
import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  type LoginResponse,
  type PasskeyAuthenticationOptionsDto,
  type PasskeyCreationOptionsDto,
  type PasskeyDto,
} from '@ecms/contracts';
import { passkeyAuthenticationVerifyRequest, passkeyRegistrationVerifyRequest } from './api';

export interface PasskeySupport {
  /** WebAuthn at all — a phone can be used through a QR code even where the computer has no reader. */
  webauthn: boolean;
  /** A built-in fingerprint / face / PIN check — what "add this device" needs. */
  platform: boolean;
  /** Passkeys offered in the username field's autofill. */
  autofill: boolean;
}

export const NO_PASSKEY_SUPPORT: PasskeySupport = {
  webauthn: false,
  platform: false,
  autofill: false,
};

/** What this browser can do. Never throws; anything unknown is «no». */
export const detectPasskeySupport = async (): Promise<PasskeySupport> => {
  try {
    if (!browserSupportsWebAuthn()) return NO_PASSKEY_SUPPORT;
    const [platform, autofill] = await Promise.all([
      platformAuthenticatorIsAvailable().catch(() => false),
      browserSupportsWebAuthnAutofill().catch(() => false),
    ]);
    return { webauthn: true, platform, autofill };
  } catch {
    return NO_PASSKEY_SUPPORT;
  }
};

/**
 * Is this page on the host the server's passkeys belong to? A passkey is bound to one domain
 * (ADR-035 §4); opened from another (the platform's raw deployment URL, say) the browser refuses the
 * prompt outright, so the screen offers no button there rather than one that can only fail.
 */
export const pageMatchesRelyingParty = (rpId: string): boolean => {
  try {
    const host = window.location.hostname;
    return host === rpId || host.endsWith(`.${rpId}`);
  } catch {
    return false;
  }
};

/**
 * Sign in: the device's prompt, then the server's check. `autofill` runs it as the username field's
 * suggestion instead of a prompt — it waits, silently, until the person picks a passkey there.
 */
export const signInWithPasskey = async (
  options: PasskeyAuthenticationOptionsDto,
  autofill = false,
): Promise<LoginResponse> => {
  const response = await startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
    useBrowserAutofill: autofill,
  });
  return passkeyAuthenticationVerifyRequest(response);
};

/** Add this device: the device's prompt makes the key, the server keeps its public half. */
export const addPasskey = async (
  options: PasskeyCreationOptionsDto,
  name?: string,
): Promise<PasskeyDto> => {
  const response = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  return passkeyRegistrationVerifyRequest(response, name);
};

/** Withdraw any prompt this page has open — on leaving the page, or before starting another. */
export const cancelPasskeyPrompt = (): void => {
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch {
    // Nothing was open.
  }
};

// ── The offer after a password sign-in ──────────────────────────────────────
//
// Remembered per account on this browser, so «not now» is not asked again at every sign-in.
// Browser storage is a convenience here and may be missing (private window, blocked storage):
// then the offer simply comes back next time.

const OFFER_KEY = (userId: string): string => `ecms.passkeyOffer.${userId}`;
/** «Not now» holds for thirty days; after that the offer comes back once. */
const DECLINE_DAYS = 30;

export const passkeyOfferSuppressed = (userId: string, now = Date.now()): boolean => {
  try {
    const stored = window.localStorage.getItem(OFFER_KEY(userId));
    if (stored === null) return false;
    if (stored === 'added') return true;
    const declinedAt = Number(stored);
    return Number.isFinite(declinedAt) && now - declinedAt < DECLINE_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

export const rememberPasskeyOffer = (userId: string, outcome: 'added' | 'declined'): void => {
  try {
    window.localStorage.setItem(
      OFFER_KEY(userId),
      outcome === 'added' ? 'added' : String(Date.now()),
    );
  } catch {
    // Storage unavailable: the offer comes back next time, which is harmless.
  }
};
