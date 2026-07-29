// Envelope encryption for values ECMS must store and later use — AES-256-GCM (A-1).
//
// A PLATFORM service, deliberately. Automation needs it first (workflow credentials), but Files,
// Notifications, OCR and every future integration store secrets too. Two implementations would mean
// two places a key can leak from and two places to remember when rotating.
//
// ── Why envelope encryption rather than encrypting with the master key directly ──
//
// Each value gets its own random data key; only the DATA KEY is encrypted with the master key.
// That buys three things a single-key scheme cannot:
//
//   * **Rotation without re-entering secrets.** Re-wrapping a data key needs no plaintext, so
//     `rewrap()` can roll thousands of stored credentials without anyone knowing what they are.
//   * **Blast radius.** A leaked data key exposes one value. A leaked master key is catastrophic
//     either way, but the master key never touches ciphertext and can live in a KMS later without
//     changing any caller.
//   * **Key-usage limits.** GCM must not reuse an (key, iv) pair. With one key per value that is
//     structurally impossible rather than something a counter has to get right.
//
// ── Why AAD binding is not optional ──
//
// Every sealed value is bound to a context string — `<collection>:<id>:<field>`. Without it, an
// attacker with write access to a collection could copy one record's ciphertext into another
// record and the system would decrypt it happily and use the wrong secret. With it, the same move
// fails authentication. This is cheap and it closes a real hole, so `seal()` REQUIRES the context;
// there is no overload that omits it.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { type CryptoStatusDto, type SealedValue } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — the size GCM is specified for; anything else costs security

export class CryptoUnavailableError extends Error {
  constructor() {
    super(
      'encryption is not configured: set PLATFORM_ENCRYPTION_KEYS and PLATFORM_ENCRYPTION_ACTIVE_KEY',
    );
    this.name = 'CryptoUnavailableError';
  }
}

export class DecryptionError extends Error {
  constructor(reason: string) {
    // Deliberately vague to the caller, specific in the message we control. A decryption failure
    // is either a wrong key, a tampered ciphertext or a moved record, and telling an attacker
    // which is a gift.
    super(`could not decrypt sealed value: ${reason}`);
    this.name = 'DecryptionError';
  }
}

/**
 * The key ring, parsed from `PLATFORM_ENCRYPTION_KEYS` as `id:base64,id:base64`.
 *
 * More than one key exists so that rotation has an overlap window: the retired key still decrypts
 * everything not yet re-wrapped, while everything new is sealed under the active one. A scheme
 * with a single key forces a big-bang migration, which is how rotations get postponed forever.
 */
const parseKeyRing = (raw: string): Map<string, Buffer> => {
  const ring = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const id = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `PLATFORM_ENCRYPTION_KEYS: key '${id}' is ${key.length} bytes, expected ${KEY_BYTES}`,
      );
    }
    ring.set(id, key);
  }
  return ring;
};

let ring: Map<string, Buffer> | null = null;

const keyRing = (): Map<string, Buffer> => {
  ring ??= parseKeyRing(env.PLATFORM_ENCRYPTION_KEYS);
  return ring;
};

const activeKey = (): { id: string; key: Buffer } => {
  const id = env.PLATFORM_ENCRYPTION_ACTIVE_KEY;
  const key = keyRing().get(id);
  if (key === undefined) throw new CryptoUnavailableError();
  return { id, key };
};

/** Wrap/unwrap the data key under a master key. Same primitive, different scope. */
const wrapKey = (dataKey: Buffer, master: Buffer, aad: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, master, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  // iv ‖ tag ‖ wrapped — one field, because these three are meaningless apart.
  return Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString('base64');
};

const unwrapKey = (wrapped: string, master: Buffer, aad: string): Buffer => {
  const raw = Buffer.from(wrapped, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const body = raw.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, master, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
};

export const cryptoService = {
  /** Whether encryption can be used at all. Callers that store secrets check this at boot. */
  available(): boolean {
    try {
      activeKey();
      return true;
    } catch {
      return false;
    }
  },

  status(): CryptoStatusDto {
    const available = cryptoService.available();
    return {
      available,
      activeKeyId: available ? env.PLATFORM_ENCRYPTION_ACTIVE_KEY : '',
      acceptedKeyIds: available ? [...keyRing().keys()] : [],
    };
  },

  /**
   * Encrypt `plaintext`, bound to `context`.
   *
   * `context` identifies WHERE this value lives — `<collection>:<id>:<field>` — and must be
   * reproducible at decryption time. See the header: it is what stops a ciphertext being moved
   * between records.
   */
  seal(plaintext: string, context: string): SealedValue {
    if (context.trim() === '') {
      throw new Error('seal() requires a context — see crypto.service.ts on AAD binding');
    }
    const { id, key: master } = activeKey();
    const dataKey = randomBytes(KEY_BYTES);
    const iv = randomBytes(IV_BYTES);

    const cipher = createCipheriv(ALGORITHM, dataKey, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      v: 1,
      keyId: id,
      wrappedKey: wrapKey(dataKey, master, context),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      aad: context,
    };
  },

  /**
   * Decrypt, verifying that the value is still where it was sealed.
   *
   * `expectedContext` is checked against the stored `aad` BEFORE any crypto runs. GCM would reject
   * a mismatch anyway; checking first turns "decryption failed" into a specific, actionable error
   * rather than an indistinguishable one.
   */
  open(sealed: SealedValue, expectedContext: string): string {
    const stored = Buffer.from(sealed.aad, 'utf8');
    const expected = Buffer.from(expectedContext, 'utf8');
    if (
      stored.length !== expected.length ||
      !timingSafeEqual(stored, expected)
    ) {
      throw new DecryptionError('the value was sealed for a different record or field');
    }

    const master = keyRing().get(sealed.keyId);
    if (master === undefined) {
      // The key that sealed this is no longer in the ring — retired too early. Recoverable by
      // putting it back, so the message says which key rather than just "failed".
      throw new DecryptionError(`key '${sealed.keyId}' is not in the key ring`);
    }

    try {
      const dataKey = unwrapKey(sealed.wrappedKey, master, sealed.aad);
      const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(sealed.iv, 'base64'));
      decipher.setAAD(Buffer.from(sealed.aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new DecryptionError('authentication failed — wrong key or tampered ciphertext');
    }
  },

  /**
   * Move a sealed value onto the active master key **without learning the plaintext**.
   *
   * This is the whole reason for the envelope: rotation unwraps and re-wraps the DATA KEY, so a
   * scheduled job can roll every stored credential in the system without a human, without
   * downtime, and without any secret ever being decrypted.
   */
  rewrap(sealed: SealedValue): SealedValue {
    const { id, key: master } = activeKey();
    if (sealed.keyId === id) return sealed;

    const old = keyRing().get(sealed.keyId);
    if (old === undefined) throw new DecryptionError(`key '${sealed.keyId}' is not in the key ring`);

    const dataKey = unwrapKey(sealed.wrappedKey, old, sealed.aad);
    return { ...sealed, keyId: id, wrappedKey: wrapKey(dataKey, master, sealed.aad) };
  },

  /** Test-only: forget the parsed ring so a suite can change the environment. */
  resetKeyRing(): void {
    ring = null;
  },
};
