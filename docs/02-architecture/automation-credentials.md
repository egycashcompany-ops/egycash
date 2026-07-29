# Automation Credentials — write-only secrets

**Layer 2 · `apps/api/src/modules/automation/credentials/`** · delivered by **A-4** · behind
`AUTOMATION_ENABLED`

Secrets a workflow presents to a third party: an SMTP password, an API key, a webhook signing
secret. Sealed with the [platform crypto service](platform-crypto.md), and — the part that matters
— **never readable back through the API**.

## The claim

> A stolen session can *use* a credential. It cannot *exfiltrate* one.

That is not a policy, it is a property of the surface. There are six routes and none of them
returns a value: no `GET /:id/value`, no `?reveal=true`, no permission that unlocks one. The
integration suite is written adversarially — it enumerates every response the API can produce for a
credential, asserts the plaintext is in none of them, then probes the paths an attacker would
guess. A test that only checked the happy path would pass against an API with a reveal flag.

`credential.view` returns metadata: key, name, type, owner, branch, last use, and `keyId`. Enough
to administer the store, nothing to steal.

## What is stored

A `SealedValue` (envelope encryption, A-1), bound by AAD to `automation_credentials:<id>:value`.

The record id is minted **before** the seal rather than by the insert:

```ts
const id = new Types.ObjectId();
const sealed = cryptoService.seal(input.value, `automation_credentials:${id}:value`);
await repository.create({ _id: id, sealed, … });
```

Sealing after the insert would mean either a window where a row exists with no value, or a second
write. One id, one seal, one insert.

The AAD is what makes a **ciphertext swap** fail. Someone with write access to the collection
copying credential A's blob into credential B's row does not get a system authenticating as A — it
gets a decryption failure, and there is a test that performs exactly that attack.

## Replace, never edit

The value goes in; nothing comes back out. There is no "edit the value" showing the old one first,
because a diff requires reading it back. The UI shows a **fixed mask** — `••••••••` — not a prefix
of the real value: a prefix leaks entropy and, for a short secret, most of the secret.

`valueVersion` increments on each replacement, so an execution can record which value it used
without recording the value. The audit trail records **that** a secret changed, never what it was —
audit diffs are built from a snapshot function that has no access to the plaintext.

## Rotation runs unattended

`automation.rotateCredentialKeys`, nightly at 02:30. It re-wraps the **data key** of anything not
sealed under the active master key; the ciphertext is untouched and no plaintext exists at any
point in the operation. That is what makes rotation a scheduled job rather than a project where
people re-enter secrets.

`sealed.keyId` is stored in the clear precisely so "find everything on a retired key" is an indexed
query rather than a decrypt-everything scan.

One credential on a key that has already left the ring counts as a failure and the sweep continues:
that state is recoverable (put the key back), and it must not stop rotation for everything else.

## Redaction is separate, and pure

`redaction.ts` has no dependencies and no I/O, because it is the one thing that must never fail.
Execution snapshots are retained business data; a workflow that authenticates passes its credential
through nodes, so without redaction the secret lands in `automation_executions.inputSnapshot`, in
the timeline a support engineer opens, and in whatever retention exports.

Two independent strategies, neither sufficient alone:

- **By field name** — `pass`, `secret`, `token`, `api[-_]?key`, `authorization`, `private[-_]?key`
  and friends, case-insensitive, matched as substrings. Catches secrets **this process never
  held**, such as a password in a provider node's own output.
- **By value** — every plaintext in play for the execution, replaced as a substring wherever it
  appears. Catches a registered secret in a field with an innocent name: `{ url:
  'https://…?token=…' }`, which no name list anticipates.

It redacts a **deep copy**: the caller is usually holding the real payload to hand to the provider,
and redacting in place would send `[redacted]` to the integration. Depth is bounded — snapshots are
attacker-influenced data, and dropping a subtree is the safe failure, since an omitted branch
cannot leak.

`containsSecret()` is the belt-and-braces check at the write boundary. If it is ever true the
snapshot is dropped whole, because "we think we cleaned it" is not a standard to store a credential
under. Secrets shorter than six characters are ignored by both value-matching functions: they match
inside ordinary words and would shred the snapshot's diagnostic value.

## Failure modes

| Situation | Behaviour |
|---|---|
| No encryption key configured | Writes are **refused** with a clear message. Better than storing a secret in the clear or dropping it silently. |
| Ciphertext tampered or moved | `resolveForExecution` throws. The log line carries the key id and credential key — never the sealed document, and never the underlying error message, which distinguishes tamper from wrong-key and is exactly the oracle an attacker probing the store would want. |
| Credential missing at run time | Throws. A workflow that authenticates with nothing is worse than one that fails. |

## Not here yet

Injection into a running execution (A-6, where the provider first exists) and the execution
snapshots redaction protects (A-7). `resolveForExecution` is the seam both will call; it is
exported from the module barrel for them and is reachable from no HTTP route.
