// The passkey card's state from the list query (ADR-036): switched off, the list still shows so a
// device can be removed, and adding waits for both the switch and the browser.
import { describe, expect, it } from 'vitest';
import { type PasskeyDto } from '@ecms/contracts';
import { ApiError } from '../../shared/lib/api-client';
import { canAddPasskey, passkeyCardState } from './passkey-card-state';

const passkey: PasskeyDto = {
  id: 'pk1',
  name: 'iPhone',
  backedUp: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  lastUsedAt: null,
};

describe('passkeyCardState', () => {
  it('on: the list as the server sent it', () => {
    expect(passkeyCardState({ items: [passkey], enabled: true }, null)).toEqual({
      hidden: false,
      switchedOff: false,
      passkeys: [passkey],
    });
  });

  it('off: still the list, so «حذف» stays reachable', () => {
    expect(passkeyCardState({ items: [passkey], enabled: false }, null)).toEqual({
      hidden: false,
      switchedOff: true,
      passkeys: [passkey],
    });
  });

  it('an API from before ADR-036 refused the list while off: switched off, nothing listed', () => {
    const error = new ApiError('AUTH_PASSKEYS_DISABLED', 'Passkeys are switched off', 403);
    expect(passkeyCardState(undefined, error)).toEqual({
      hidden: false,
      switchedOff: true,
      passkeys: [],
    });
  });

  it('an account that may not hold passkeys sees no card', () => {
    const error = new ApiError('AUTH_PASSKEY_NOT_ALLOWED', 'Not for this account', 403);
    expect(passkeyCardState(undefined, error).hidden).toBe(true);
  });

  it('still loading, or another failure: on, with nothing listed', () => {
    expect(passkeyCardState(undefined, null)).toEqual({
      hidden: false,
      switchedOff: false,
      passkeys: [],
    });
    expect(passkeyCardState(undefined, new Error('offline')).switchedOff).toBe(false);
  });
});

describe('canAddPasskey', () => {
  const support = (webauthn: boolean) => ({ webauthn, platform: webauthn, autofill: webauthn });

  it('only with passkeys on and once the browser has said it can', () => {
    expect(canAddPasskey(false, support(true))).toBe(true);
    expect(canAddPasskey(true, support(true))).toBe(false);
    expect(canAddPasskey(false, support(false))).toBe(false);
    // Not asked yet: no button that might not work.
    expect(canAddPasskey(false, null)).toBe(false);
  });
});
