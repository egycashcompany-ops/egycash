// After a password sign-in, «add this device» is offered only while passkeys are switched on. The
// list answers even when they are off (so a device can always be removed), so the offer reads the
// switch from the list's answer instead of relying on the list being refused.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MeDto } from '@ecms/contracts';
import type * as AuthApiModule from './api';
import type * as PasskeysModule from './passkeys';

const listed = vi.hoisted(() => ({ items: [] as unknown[], enabled: true }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApiModule>()),
  listPasskeysRequest: async () => ({ items: listed.items, enabled: listed.enabled }),
}));
vi.mock('./passkeys', async (importOriginal) => ({
  ...(await importOriginal<typeof PasskeysModule>()),
  passkeyOfferSuppressed: () => false,
}));

const { shouldOfferPasskey } = await import('./PasskeySignIn');

const signedIn = {
  totpRequired: false as const,
  accessToken: 'token',
  me: { id: 'u-1' } as MeDto,
  mustChangePassword: false,
  idleMinutes: 10,
};
const capable = { webauthn: true, platform: true, conditional: true };

beforeEach(() => {
  listed.items = [];
  listed.enabled = true;
});

describe('the passkey offer after a password sign-in', () => {
  it('is made on a capable device to an account with no passkey, while switched on', async () => {
    expect(await shouldOfferPasskey(signedIn as never, capable as never)).toBe(true);
  });

  it('is not made while passkeys are switched off, though the list answered', async () => {
    listed.enabled = false;
    expect(await shouldOfferPasskey(signedIn as never, capable as never)).toBe(false);
  });

  it('is not made to an account that already has one', async () => {
    listed.items = [{ id: 'p-1' }];
    expect(await shouldOfferPasskey(signedIn as never, capable as never)).toBe(false);
  });
});
