// The secret-store seam (A-4.1) — "a module needs to store a secret" decoupled from "where
// secrets live" (approver request, 2026-07-29).
//
// Today the only backend is envelope encryption with an env-supplied master key (A-1). Tomorrow
// the master key may live in a cloud KMS, or the secret itself in a vault with ECMS holding only a
// pointer. Those are different integration shapes; this interface is what keeps a module that
// stores a credential from having to know which one it is on.
//
// The interface is ASYNC on purpose, even though the only implementation today resolves
// synchronously. The A-0 lesson: a KMS or vault call is a network round-trip, so a sync signature
// would have to be broken later — and breaking it later means touching every caller. Better to pay
// the `await` now than to weld the seam to an in-process primitive.
import {
  SecretRefSchema,
  type SecretRef,
  type SecretStoreStatusDto,
} from '@ecms/contracts';

export { SecretRefSchema };
export type { SecretRef, SecretStoreStatusDto };

/**
 * What a backend must do. Nothing here mentions AES, a key ring, a vault path or a KMS ARN — those
 * live inside `SecretRef.ref`, which is opaque to every caller. A store that leaks its internals
 * through the interface has defeated the point of the interface.
 */
export interface SecretStore {
  /** Stable id, e.g. `platformCrypto`. Recorded on every `SecretRef` this store produces. */
  readonly providerId: string;

  /** Whether the store can be used at all — misconfiguration, not a per-value failure. */
  available(): boolean;

  /** Posture without reading any secret: where they live, what to rotate onto, whether ECMS drives rotation. */
  status(): SecretStoreStatusDto;

  /**
   * Turn a plaintext into a persistable `SecretRef`. `context` is bound to the value (as AAD, or a
   * vault policy, or a KMS encryption context) so a ref moved to another record fails rather than
   * decrypting into the wrong place.
   */
  seal(plaintext: string, context: string): Promise<SecretRef>;

  /** Recover the plaintext. Must reject a `context` that does not match the one it was sealed for. */
  open(ref: SecretRef, context: string): Promise<string>;

  /**
   * Re-bind a value to the current key WITHOUT exposing plaintext — key rotation's engine. A no-op
   * when the ref is already current, and a store whose backend rotates itself (`rotatable: false`)
   * returns the ref unchanged.
   */
  rewrap(ref: SecretRef): Promise<SecretRef>;
}

/** A ref produced by a different store than the one now asked to read it — a real state after a backend switch. */
export class SecretStoreMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`secret was sealed by store '${actual}', which is not the active store '${expected}'`);
    this.name = 'SecretStoreMismatchError';
  }
}

// ── Registry ──────────────────────────────────────────────────────────────
// One active store per deployment, swappable at boot. The default is set by the platform-crypto
// provider's own module (below), so this file depends on no concrete backend — the seam stays
// clean even here.

let activeStore: SecretStore | null = null;

export const setSecretStore = (store: SecretStore): void => {
  activeStore = store;
};

export const getSecretStore = (): SecretStore => {
  if (activeStore === null) {
    throw new Error('no secret store is configured; call setSecretStore() at boot');
  }
  return activeStore;
};

/** Test seam. */
export const resetSecretStore = (): void => {
  activeStore = null;
};
