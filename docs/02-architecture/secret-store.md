# Secret Store — where secrets live, decoupled from what needs them

**Layer 1 (platform) · `apps/api/src/platform/secrets/`** · delivered by **A-4.1**

A module that stores a secret should not know *where* secrets live. Today they live in
envelope-encrypted documents with an env-supplied master key (A-1). Tomorrow the master key may
move to a cloud KMS, or the secret itself into a vault with ECMS holding only a pointer. Those are
different integration shapes; this seam is what keeps a module from having to care which one it is
on.

## The interface

```ts
interface SecretStore {
  readonly providerId: string;
  available(): boolean;
  status(): SecretStoreStatusDto;
  seal(plaintext: string, context: string): Promise<SecretRef>;
  open(ref: SecretRef, context: string): Promise<string>;
  rewrap(ref: SecretRef): Promise<SecretRef>;
}
```

A module persists a **`SecretRef`** — `{ provider, keyId, ref }` — in place of the secret. `ref` is
**opaque**: only the store that produced it may read it. For `platformCrypto` it holds a
`SealedValue`; for a vault it would hold a path and a version; for a KMS store a wrapped data key
plus ciphertext. **The difference never reaches the module**, which is the whole point — a module
that reaches into `ref` has welded itself to one backend.

## Async on purpose

Every method returns a `Promise`, even though the only backend today resolves synchronously. A KMS
or vault call is a network round-trip; a sync signature would have to be broken later, and breaking
it later means touching every caller. This is the A-0 lesson applied a second time — pay the
`await` now.

The `platformCrypto` store's methods are written `async` (not `Promise.resolve(...)`) for a related
reason: the crypto primitive throws **synchronously** on a wrong context or a missing key, and
`Promise.resolve(throwingCall())` throws *before* the promise exists — so `.catch()` never fires.
`async` turns every throw into a rejection, which is the contract callers await. There is a unit
test for exactly this (a moved-context open, a foreign-provider ref) precisely because it is the
trap A-0 hit and it is invisible until something rejects.

## keyId in the clear

`SecretRef.keyId` is stored unencrypted. Rotation is "find everything still on a retired key and
re-wrap it", and a sweep that must decrypt in order to *discover* what needs re-wrapping is a sweep
nobody runs. `null` keyId means the backend rotates on its own schedule and ECMS has nothing to
drive.

## rotatable

`status().rotatable` says whether ECMS drives rotation at all. `platformCrypto` holds the master
key, so it rotates itself (`true`); a KMS that rotates its own keys reports `false` and any caller's
rotation sweep leaves it alone. The automation credential sweep checks this before doing anything.

## Provider mismatch is a real state

After a backend switch, an old `SecretRef` still names the store that produced it. A store asked to
open a ref it did not produce raises `SecretStoreMismatchError` rather than mis-parsing another
backend's format. This is the same shape as the crypto service's "key not in the ring" — a clear,
recoverable, named failure instead of a decryption error.

## Adding a backend

1. Implement `SecretStore` (e.g. `AwsKmsSecretStore`), with its own `providerId`.
2. Register it at boot: `setSecretStore(awsKmsStore)`.

Nothing else changes. No credential caller, no collection shape, no module contract. Existing
`SecretRef`s keep their `platformCrypto` provider and keep opening through the old store during a
migration; new values seal under the new one. `SECRET_STORE_IDS` in `@ecms/contracts` names the
shapes the seam is designed to accept — `platformCrypto`, `awsKms`, `azureKeyVault`,
`hashicorpVault` — as intent, not as promises already kept.

## Relationship to platform crypto

`platform/crypto` (A-1) is the AES-GCM envelope primitive. `platform/secrets` (A-4.1) is the seam
*above* it: `platformCryptoStore` is a thin adapter that puts a `SealedValue` inside a `SecretRef`.
Crypto stays a low-level capability other things can use directly; the secret store is what a module
storing a credential should depend on, so that the credential is not welded to AES.
