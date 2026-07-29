// The secret-store seam (A-4.1).
//
// The point of the seam is that a module storing a secret depends on the INTERFACE, not on any
// backend. So the tests here are about the contract every backend must honour — round-trip,
// context binding, rotation, provider mismatch — and about the ref staying opaque, rather than
// about AES, which is A-1's concern and lives in crypto.service.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');

vi.mock('../../infrastructure/config/env', () => ({
  env: { PLATFORM_ENCRYPTION_KEYS: '', PLATFORM_ENCRYPTION_ACTIVE_KEY: '' },
  isTest: true,
  isProduction: false,
}));

const { env } = await import('../../infrastructure/config/env');
const { cryptoService } = await import('../crypto/crypto.service');
const { platformCryptoStore } = await import('./providers/platform-crypto.store');
const { SecretStoreMismatchError } = await import('./secret-store');

const settings = env as unknown as {
  PLATFORM_ENCRYPTION_KEYS: string;
  PLATFORM_ENCRYPTION_ACTIVE_KEY: string;
};

const useKeys = (keys: string, active: string): void => {
  settings.PLATFORM_ENCRYPTION_KEYS = keys;
  settings.PLATFORM_ENCRYPTION_ACTIVE_KEY = active;
  cryptoService.resetKeyRing();
};

const CONTEXT = 'automation_credentials:66a1b2c3d4e5f60718293a4b:value';

beforeEach(() => useKeys(`a:${KEY_A}`, 'a'));
afterEach(() => cryptoService.resetKeyRing());

describe('the store contract', () => {
  it('round-trips a secret', async () => {
    const ref = await platformCryptoStore.seal('hunter2', CONTEXT);
    expect(await platformCryptoStore.open(ref, CONTEXT)).toBe('hunter2');
  });

  it('stamps the ref with its provider and the key it is bound to', async () => {
    const ref = await platformCryptoStore.seal('s', CONTEXT);
    expect(ref.provider).toBe('platformCrypto');
    expect(ref.keyId).toBe('a');
  });

  it('refuses a value moved to a different context', async () => {
    // The binding a module relies on: a ref copied into another record must not open.
    const ref = await platformCryptoStore.seal('s', 'automation_credentials:AAA:value');
    await expect(
      platformCryptoStore.open(ref, 'automation_credentials:BBB:value'),
    ).rejects.toThrow();
  });

  it('reports its posture without opening anything', () => {
    expect(platformCryptoStore.status()).toMatchObject({
      provider: 'platformCrypto',
      available: true,
      currentKeyId: 'a',
      rotatable: true,
    });
  });

  it('reports unavailable rather than throwing when no key is configured', () => {
    useKeys('', '');
    expect(platformCryptoStore.available()).toBe(false);
    expect(platformCryptoStore.status()).toMatchObject({ available: false, currentKeyId: null });
  });
});

describe('the ref is opaque to callers', () => {
  it('carries the backend payload without the seam naming its shape', async () => {
    // A caller may persist `ref.ref` but must never reach into it. The store is the only code that
    // knows it is a SealedValue — this test documents that boundary rather than depending on it.
    const ref = await platformCryptoStore.seal('s', CONTEXT);
    expect(ref.ref).toBeDefined();
    // Round-trips purely through the interface, no field access.
    expect(await platformCryptoStore.open(ref, CONTEXT)).toBe('s');
  });

  it('refuses a ref that claims a different provider', async () => {
    // After a backend switch, an old ref names the store that produced it. Opening it with the
    // wrong store fails loudly instead of mis-parsing someone else's format.
    const foreign = { provider: 'awsKms', keyId: null, ref: { arn: 'x' } };
    await expect(platformCryptoStore.open(foreign, CONTEXT)).rejects.toThrow(
      SecretStoreMismatchError,
    );
  });
});

describe('rotation', () => {
  it('re-wraps onto the current key without exposing plaintext, ciphertext untouched', async () => {
    const ref = await platformCryptoStore.seal('hunter2', CONTEXT);
    useKeys(`a:${KEY_A},b:${KEY_B}`, 'b');

    const rotated = await platformCryptoStore.rewrap(ref);
    expect(rotated.keyId).toBe('b');
    // Only the wrapping moved; the payload is the same, which is what makes rotation a no-plaintext
    // operation a scheduled job can run.
    expect((rotated.ref as { ciphertext: string }).ciphertext).toBe(
      (ref.ref as { ciphertext: string }).ciphertext,
    );
    expect(await platformCryptoStore.open(rotated, CONTEXT)).toBe('hunter2');
  });

  it('keeps opening values on the retired key during the overlap', async () => {
    const ref = await platformCryptoStore.seal('hunter2', CONTEXT);
    useKeys(`a:${KEY_A},b:${KEY_B}`, 'b');
    expect(await platformCryptoStore.open(ref, CONTEXT)).toBe('hunter2');
  });
});
