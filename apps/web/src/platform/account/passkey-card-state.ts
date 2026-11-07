// What the Security page's passkey card shows, from the list query alone — kept apart from the
// component so each case is tested without a browser.
import { type PasskeyDto } from '@ecms/contracts';
import { ApiError } from '../../shared/lib/api-client';
import { type PasskeyList } from '../auth/api';
import { type PasskeySupport } from '../auth/passkeys';

export interface PasskeyCardState {
  /** An account that may not hold passkeys (none reach this page today): no card at all. */
  hidden: boolean;
  /**
   * Passkeys switched off for the organization. The list still comes (the server answers it
   * either way) so a device can be removed; adding and renaming wait for the switch. The error
   * code is what an API from before ADR-036 sent instead of the list.
   */
  switchedOff: boolean;
  passkeys: PasskeyDto[];
}

export const passkeyCardState = (
  data: PasskeyList | undefined,
  error: unknown,
): PasskeyCardState => {
  const code = error instanceof ApiError ? error.code : null;
  return {
    hidden: code === 'AUTH_PASSKEY_NOT_ALLOWED',
    switchedOff: data?.enabled === false || code === 'AUTH_PASSKEYS_DISABLED',
    passkeys: data?.items ?? [],
  };
};

/**
 * The removal confirmation. «You can add it again at any time» is true only with passkeys on:
 * switched off, adding is refused until the switch comes back.
 */
export const removeConfirmKey = (switchedOff: boolean): string =>
  switchedOff ? 'account.security.passkeyRemoveBodyOff' : 'account.security.passkeyRemoveBody';

/** «Add» is offered only with passkeys on and once the browser has said it can make one. */
export const canAddPasskey = (switchedOff: boolean, support: PasskeySupport | null): boolean =>
  !switchedOff && support?.webauthn === true;
