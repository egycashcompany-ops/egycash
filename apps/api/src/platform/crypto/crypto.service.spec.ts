// Envelope encryption (A-1).
//
// The tests are organised around what an attacker or an operator would actually try, rather than
// around the methods: round-trip, tamper, move a ciphertext to another record, rotate a key,
// retire a key too early. Those are the five things that go wrong with a scheme like this.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

vi.mock('../../infrastructure/config/env', () => ({
  env: {
    PLATFORM_ENCRYPTION_KEYS: '',
    PLATFORM_ENCRYPTION_ACTIVE_KEY: '',
  },
  isTest: true,
  isProduction: false,
}));

const { env } = await import('../../infrastructure/config/env');
const { cryptoService, DecryptionError } = await import('./crypto.service');

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

// ── The basic guarantee ─────────────────────────────────────────────────────

describe('seal / open', () => {
  it('round-trips a secret', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    expect(cryptoService.open(sealed, CONTEXT)).toBe('hunter2');
  });

  it('round-trips non-ASCII, which credentials and Arabic values contain', () => {
    const secret = 'كلمة-السر — ✓ 🔑';
    expect(cryptoService.open(cryptoService.seal(secret, CONTEXT), CONTEXT)).toBe(secret);
  });

  it('never stores the plaintext anywhere in the sealed document', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    expect(JSON.stringify(sealed)).not.toContain('hunter2');
  });

  it('produces a different ciphertext every time the same value is sealed', () => {
    // Each value gets its own data key and IV. Identical ciphertexts would leak that two records
    // hold the same secret — which, for credentials, is itself worth knowing to an attacker.
    const first = cryptoService.seal('same', CONTEXT);
    const second = cryptoService.seal('same', CONTEXT);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
    expect(first.iv).not.toBe(second.iv);
  });

  it('handles the empty string without special-casing it', () => {
    expect(cryptoService.open(cryptoService.seal('', CONTEXT), CONTEXT)).toBe('');
  });
});

// ── Tampering ───────────────────────────────────────────────────────────────

describe('integrity', () => {
  it('refuses a modified ciphertext rather than returning garbage', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(() =>
      cryptoService.open({ ...sealed, ciphertext: bytes.toString('base64') }, CONTEXT),
    ).toThrow(DecryptionError);
  });

  it('refuses a modified auth tag', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    const tag = Buffer.from(sealed.authTag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;

    expect(() => cryptoService.open({ ...sealed, authTag: tag.toString('base64') }, CONTEXT)).toThrow(
      DecryptionError,
    );
  });

  it('refuses a wrapped key that was swapped for another value′s', () => {
    // Combining one record's data key with another's ciphertext must not produce anything.
    const first = cryptoService.seal('secret-one', CONTEXT);
    const second = cryptoService.seal('secret-two', CONTEXT);
    expect(() => cryptoService.open({ ...first, wrappedKey: second.wrappedKey }, CONTEXT)).toThrow(
      DecryptionError,
    );
  });
});

// ── The attack AAD binding exists for ───────────────────────────────────────

describe('context binding', () => {
  it('refuses a ciphertext moved to a different record', () => {
    // The real scenario: someone with write access to the collection copies the encrypted blob
    // from credential A into credential B's row. Without AAD binding the system would decrypt it
    // happily and start authenticating with the wrong secret.
    const sealed = cryptoService.seal('production-api-key', 'automation_credentials:AAA:value');
    expect(() => cryptoService.open(sealed, 'automation_credentials:BBB:value')).toThrow(
      /different record or field/,
    );
  });

  it('refuses a ciphertext moved to a different FIELD of the same record', () => {
    const sealed = cryptoService.seal('v', 'automation_credentials:AAA:value');
    expect(() => cryptoService.open(sealed, 'automation_credentials:AAA:token')).toThrow(
      DecryptionError,
    );
  });

  it('refuses to seal without a context, rather than defaulting to a weak one', () => {
    expect(() => cryptoService.seal('secret', '   ')).toThrow(/requires a context/);
  });

  it('records the context in the clear so a rotation job can find what to re-wrap', () => {
    expect(cryptoService.seal('s', CONTEXT).aad).toBe(CONTEXT);
  });
});

// ── Rotation — the reason for the envelope ──────────────────────────────────

describe('rotation', () => {
  it('re-wraps onto the new key WITHOUT decrypting the secret', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    expect(sealed.keyId).toBe('a');

    useKeys(`a:${KEY_A},b:${KEY_B}`, 'b');
    const rotated = cryptoService.rewrap(sealed);

    expect(rotated.keyId).toBe('b');
    // The payload is untouched — only the wrapping changed. That is what lets a scheduled job
    // roll thousands of credentials with no human and no plaintext in flight.
    expect(rotated.ciphertext).toBe(sealed.ciphertext);
    expect(rotated.wrappedKey).not.toBe(sealed.wrappedKey);
    expect(cryptoService.open(rotated, CONTEXT)).toBe('hunter2');
  });

  it('keeps decrypting values still on the retired key during the overlap', () => {
    // The whole point of a ring: rotation is not a big-bang migration.
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    useKeys(`a:${KEY_A},b:${KEY_B}`, 'b');
    expect(cryptoService.open(sealed, CONTEXT)).toBe('hunter2');
  });

  it('is a no-op for a value already on the active key', () => {
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    expect(cryptoService.rewrap(sealed)).toBe(sealed);
  });

  it('reports the key by name when it was retired too early', () => {
    // Recoverable — put the key back. The message says which one, so an operator is not left
    // guessing at 3am which key they dropped out of the ring.
    const sealed = cryptoService.seal('hunter2', CONTEXT);
    useKeys(`b:${KEY_B}`, 'b');
    expect(() => cryptoService.open(sealed, CONTEXT)).toThrow(/key 'a' is not in the key ring/);
  });
});

// ── Configuration ───────────────────────────────────────────────────────────

describe('configuration', () => {
  it('reports unavailable rather than throwing when no key is configured', () => {
    useKeys('', '');
    expect(cryptoService.available()).toBe(false);
    expect(cryptoService.status()).toMatchObject({ available: false, acceptedKeyIds: [] });
  });

  it('reports which keys can decrypt, so posture is visible without decrypting anything', () => {
    useKeys(`a:${KEY_A},b:${KEY_B}`, 'b');
    expect(cryptoService.status()).toMatchObject({
      available: true,
      activeKeyId: 'b',
      acceptedKeyIds: ['a', 'b'],
    });
  });

  it('rejects a key of the wrong length at parse time, not at first use', () => {
    // A 16-byte key would silently give AES-128 or a runtime error on the first credential save.
    useKeys(`short:${Buffer.alloc(16, 3).toString('base64')}`, 'short');
    expect(() => cryptoService.seal('x', CONTEXT)).toThrow(/expected 32/);
  });

  it('refuses to seal when the active key id is not in the ring', () => {
    useKeys(`a:${KEY_A}`, 'missing');
    expect(() => cryptoService.seal('x', CONTEXT)).toThrow(/not configured/);
  });
});
