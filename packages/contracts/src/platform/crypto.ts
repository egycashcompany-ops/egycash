import { z } from 'zod';

// Envelope-encryption contracts (A-1). A PLATFORM capability, not an Automation one: Files,
// Notifications, OCR and any future integration store secrets too, and a second implementation
// would mean a second place a key can leak from and a second place to remember to rotate.
//
// `SealedValue` is what gets persisted. It is a document rather than an opaque blob so that key
// rotation can find what needs re-wrapping without decrypting anything: `keyId` is queryable.

export const SealedValueSchema = z.object({
  /** Format version. Bumped only if the envelope layout itself changes; readers switch on it. */
  v: z.literal(1),
  /**
   * Which master key wrapped this value's data key. Rotation is "re-wrap everything not on the
   * active key", and that query is only possible because this is stored in the clear.
   */
  keyId: z.string().min(1).max(40),
  /** The per-value data key, encrypted under the master key. */
  wrappedKey: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string(),
  /**
   * The context this value was sealed for, e.g. `automation_credentials:66a1…:value`.
   *
   * Bound as AES-GCM additional authenticated data, so a ciphertext moved to a different record
   * FAILS TO DECRYPT rather than decrypting into the wrong place. Without it, an attacker with
   * write access to the collection could swap one credential's blob for another's and the system
   * would faithfully use the wrong secret.
   */
  aad: z.string().min(1).max(300),
});
export type SealedValue = z.infer<typeof SealedValueSchema>;

/** Reported by `/health` so an operator can see the posture without decrypting anything. */
export const CryptoStatusDtoSchema = z.object({
  available: z.boolean(),
  activeKeyId: z.string(),
  /** Key ids accepted for DECRYPTION — the active one plus any retired keys still in the ring. */
  acceptedKeyIds: z.array(z.string()),
});
export type CryptoStatusDto = z.infer<typeof CryptoStatusDtoSchema>;
