import { z } from 'zod';

// Secret storage — the seam between "a module needs to store a secret" and "where secrets live"
// (A-4.1). A PLATFORM capability, like crypto and automation providers before it.
//
// Today the only implementation is envelope encryption with an env-supplied master key
// (`platformCrypto`). Tomorrow the master key may live in a KMS, or the secret itself may live in
// a vault and ECMS may hold only a pointer. Those are different integration shapes, and the point
// of this file is that a module storing a credential does not have to know which one it is on.
//
// The rule that makes that true: **`ref` is opaque.** Nothing outside the store that produced it
// may read, parse or reason about its contents. A module that peeks at `ref.ciphertext` has
// welded itself to one backend, and swapping backends becomes a migration of that module.

/**
 * What a module PERSISTS in place of a secret.
 *
 * For an inline store the ref carries the sealed envelope; for a vault it carries a path and a
 * version; for a KMS-backed store it carries a wrapped data key plus ciphertext. All three are
 * `ref`, and the difference never reaches the module.
 */
export const SecretRefSchema = z.object({
  /** Which store produced this and must be asked to read it back. */
  provider: z.string().min(1).max(40),
  /**
   * The key/version this secret is currently bound to, in the CLEAR — `null` when the backend
   * rotates on its own schedule and ECMS has nothing to drive.
   *
   * Stored unencrypted on purpose: "find everything still on the retired key" has to be an indexed
   * query, and a rotation sweep that must decrypt to discover what needs rotating is a rotation
   * sweep nobody runs.
   */
  keyId: z.string().min(1).max(64).nullable(),
  /** Provider-owned payload. Opaque to every caller. */
  ref: z.unknown(),
});
export type SecretRef = z.infer<typeof SecretRefSchema>;

/**
 * Stores ECMS knows how to construct. Adding one is a new entry plus an implementation — never a
 * change to a module that stores secrets.
 *
 * `platformCrypto` — envelope encryption, master key from `PLATFORM_ENCRYPTION_KEYS` (A-1).
 * The rest are named here as the shapes the seam is designed to accept, not as promises.
 */
export const SECRET_STORE_IDS = [
  'platformCrypto',
  'awsKms',
  'azureKeyVault',
  'hashicorpVault',
] as const;
export const SecretStoreIdSchema = z.enum(SECRET_STORE_IDS);
export type SecretStoreId = z.infer<typeof SecretStoreIdSchema>;

/** Reported by `/health`, so an operator can see where secrets live without reading any. */
export const SecretStoreStatusDtoSchema = z.object({
  provider: z.string(),
  available: z.boolean(),
  /** What everything should be rotated onto; `null` when the backend manages its own rotation. */
  currentKeyId: z.string().nullable(),
  /** Whether ECMS drives rotation at all — false for a backend that rotates itself. */
  rotatable: z.boolean(),
});
export type SecretStoreStatusDto = z.infer<typeof SecretStoreStatusDtoSchema>;
