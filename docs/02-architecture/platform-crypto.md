# Platform Crypto — envelope encryption

**Layer 1 (platform) · `apps/api/src/platform/crypto/`** · delivered by **A-1**

For values ECMS must **store and later use**: workflow credentials, integration tokens, anything a
service has to present to a third party. Not for passwords — those are hashed, never encrypted, and
that stays in `user.model.ts`.

A platform service on purpose. Automation needs it first, but Files, Notifications, OCR and every
future integration store secrets too, and two implementations would mean two places a key can leak
from and two places to remember when rotating.

## Using it

```ts
import { cryptoService } from '../../platform/crypto';

const sealed = cryptoService.seal(apiKey, `automation_credentials:${doc.id}:value`);
// …persist `sealed` (a SealedValue document)…
const apiKey = cryptoService.open(sealed, `automation_credentials:${doc.id}:value`);
```

The second argument is the **context**, and it is required. See below.

## Why envelope encryption

Each value gets its own random data key; only the data key is encrypted under the master key. That
buys three things a single-key scheme cannot:

- **Rotation without re-entering secrets.** `rewrap()` unwraps and re-wraps the *data key*, so a
  scheduled job can roll every stored credential without a human and without any plaintext.
- **Blast radius.** A leaked data key exposes one value. The master key never touches ciphertext,
  so it can move into a KMS later without changing a single caller.
- **Key-usage limits.** GCM must never reuse a (key, IV) pair. One key per value makes that
  structurally impossible rather than something a counter has to get right.

## Why the context is mandatory

Every sealed value is bound to `<collection>:<id>:<field>` as AES-GCM additional authenticated
data. Without it, someone with write access to a collection could copy the encrypted blob from
credential **A** into credential **B**'s row, and the system would decrypt it happily and start
authenticating with the wrong secret. With it, the same move fails authentication.

`seal()` has no overload that omits the context, and `open()` compares the expected context against
the stored one before any crypto runs — turning "decryption failed" into a specific, actionable
error instead of an indistinguishable one.

## Key ring and rotation

```bash
PLATFORM_ENCRYPTION_KEYS="a:<base64-32-bytes>,b:<base64-32-bytes>"
PLATFORM_ENCRYPTION_ACTIVE_KEY="b"
```

More than one key so rotation has an **overlap window**: the retired key still decrypts what has
not been re-wrapped, while everything new is sealed under the active one. A single-key scheme forces
a big-bang migration, which is how rotations get postponed indefinitely.

To rotate: add the new key to the ring, point `ACTIVE_KEY` at it, run `rewrap()` over stored values
(`keyId` is in the clear precisely so they can be *found* without decrypting), then drop the old key.

`keyId` is stored per value. Retiring a key too early is recoverable — put it back — and the error
names the missing key rather than saying "failed".

The dev default is a published, worthless key. **`env.ts` refuses to boot production with it**;
reaching production with a key from this repository would mean every stored credential is readable
by anyone who can read the source.

## Reading the errors

| Error | Means |
|---|---|
| `CryptoUnavailableError` | No usable key — misconfiguration, not corruption |
| `…sealed for a different record or field` | Context mismatch: the value was moved, or the caller built the context differently |
| `key 'x' is not in the key ring` | Retired too early. Put it back |
| `authentication failed` | Wrong key or tampered ciphertext — deliberately not distinguished |

## Not covered here

Hardware or cloud KMS (the master key is env-supplied; the seam is ready), searchable encryption,
and field-level encryption at the Mongoose layer. All three are additive later.
