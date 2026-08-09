# ADR-023: File authorization is derived from the owning entity, not from the file

**Status:** Accepted · **Date:** 2026-08-09

> The frozen IT design (§15) reserved ADR-023 for IT-4 (maintenance). This platform slice takes
> 023 as the earlier decision, and the module's remaining ADRs shift by one: IT-4 → ADR-024,
> and later IT ADRs follow in sequence. Numbering only — no IT decision changes.

## Context

The Files service (ADR-010, ADR-020) authorizes a read with two questions, and neither of them is
about what the file *belongs to*. `FileService.authorizeDownload` checks that the scanner has not
blocked the file, and that a `private` file is only read by a holder of `file.download`. It never
reads `doc.entityRef`.

Nor is there a scope to fall back on: `FileRepository` is constructed as `super(FileModel, {})` —
no branch field, no owner field — so `scopeSelector(ctx, 'file.view')` has no dimension to filter
on. The repository said so in its own comment:

> *Files carry no branch dimension in 3.1: `own` scope = uploader; branch behaves as organization
> (entity-derived authorization arrives with the first module consumer).*

`docs/02-architecture/files-service.md` recorded the same deferral. The consequence is that **any
holder of `file.view` + `file.download` who knows a file id can read any file**, whatever it is
attached to and whoever may see that thing.

That was tolerable while every consumer attached files to records whose readers were roughly the
file's readers. IT-3 is the first consumer where it is not: a help-desk ticket is readable under an
`own` scope by its requester, and an internal comment (FR-7) must never reach that requester at
all. Attaching a file to either under the old rules would publish it to every `file.download`
holder in the company. IT-3 is therefore the "first module consumer" the deferral named, and this
ADR is that arrival.

Three further paths made the gap wider than a single endpoint:

- **`FileService.copy`** streamed the *source* file's bytes with no authorization call at all,
  then wrote them into a new file under a caller-chosen `entityRef`.
- **`GET /platform/files` (`list`)** accepts `moduleId`/`entityType`/`entityId` filters, so file
  metadata for any entity could be enumerated.
- **`GET /platform/files/signed/:id`** is unauthenticated by design; the capability was an HMAC
  over `${fileId}.${expiresAtEpoch}`, so a ticket was a **bearer** token — it worked for whoever
  held the URL until it expired.

## Decision

**Authorization for a file is derived from the entity the file belongs to, and the module that owns
that entity decides.**

The Files service gains a registration seam. A module declares authorizers for its entity types in
its manifest — the same visible, reviewable wiring `eventSubscriptions` and `scheduledTasks`
already use — and the Files service consults them at every point where file data or bytes are
reachable.

No permission is added, and none is changed. The seam asks a module a question; it does not mint
authority.

## Authorization contract

```ts
export interface FileEntityAuthorizer {
  /** The module-local entity type, e.g. 'ticket' or 'ticketComment'. */
  entityType: string;
  /**
   * May this caller reach files owned by this entity?
   *   read  → metadata and bytes
   *   write → replace, update, archive, restore, delete, purge
   * Returning false — or throwing — denies.
   */
  authorize(input: {
    ctx: AuthContext;
    entityId: string;
    intent: 'read' | 'write';
  }): Promise<boolean>;
}
```

Declared as `ModuleManifest.fileEntityAuthorizers?: FileEntityAuthorizer[]`, registered under
`${moduleId}/${entityType}` — the module id comes from the manifest, so a module cannot claim
another's namespace.

The interface lives in `apps/api/src/platform/files/file-authorizers.ts` rather than in
`@ecms/contracts`: it references `AuthContext` and carries a function, both of which are API-side
concerns. Putting it in the contracts package would invert the dependency direction for no gain —
no client ever sees this type.

Three rules make the contract honest:

1. **The entity decision is final.** A file's own `visibility` may narrow access; it may never
   widen it past the authorizer. Otherwise `file.edit` — which can flip `visibility` to `public` —
   would become a way to publish another module's confidential data.
2. **`entityRef` is immutable.** It is set at upload and appears on no update schema. Re-parenting
   a file to a laxer entity is therefore already impossible, and stays that way.
3. **The authorizer is pure authorization.** It answers a question; it does not mutate, and its
   answer is not cached across requests.

## Registration lifecycle

At boot, `bootPlatform` walks each manifest and registers its authorizers into a module-scoped
registry, exactly as it registers subscriptions today. Registration is:

- **Additive** — `fileEntityAuthorizers` is optional, so `requiresPlatform: '^2.1'` stays valid and
  no existing manifest changes.
- **Startup-only** — nothing registers at request time, so the set of guarded entity types is a
  property of the deployment, inspectable at boot.
- **Unique** — a duplicate `${moduleId}/${entityType}` is a boot error, not a silent last-wins.

## Fail-closed behaviour

| Situation | Behaviour |
|---|---|
| No authorizer registered for the entity type | **Exactly the previous behaviour** — unchanged |
| Authorizer returns `false` | Deny |
| Authorizer throws | **Deny**, and audit `permissionDenied` |
| Authorizer exceeds its 1 s budget | **Deny**, and audit |
| Authorizer registered, entity no longer exists | Deny |

The asymmetry is the point: fail-closed applies **only** where a module has opted in. Files whose
entity types have no authorizer — HR employee files, applicant attachments, contract branding
logos, OCR sources, evaluation packages — keep the previous rules to the letter. This is what makes
the slice safe to merge before any of those modules is ready to register.

Denial shape follows the platform's existing convention: a read the caller may not perform answers
**404**, not 403, because the existence of a file attached to an invisible entity is itself
information. Write intents answer 403, since the caller already proved they can see the file.

## Signed-ticket model

For entity types **with** a registered authorizer, the download ticket stops being a bearer token:

- The signature covers `${fileId}.${expiresAtEpoch}.${userId}`.
- `GET /platform/files/signed/:id` requires authentication for these files, and re-runs the
  authorizer **at stream time**.
- A leaked URL is useless to anyone but its subject, and a revoked grant takes effect immediately
  rather than at ticket expiry.

For every other file the ticket is unchanged: an unauthenticated capability URL, which is what lets
a branding logo load in an `<img>` from another origin (the `Cross-Origin-Resource-Policy`
reasoning in the file controller stands untouched).

The cost is explicit: a guarded file cannot be embedded via a plain `<img src>`. Ticket attachments
are downloads, not inline images, so IT-3 pays nothing. A future module that needs inline display
of guarded images will need a session-carrying fetch — a real constraint, recorded here rather than
discovered later.

## Presigned URL behaviour

`STORAGE_PRESIGNED_URLS=true` makes `issueDownloadTicket` return the storage provider's own URL.
That URL is outside the application entirely: no re-check, no subject binding, no revocation.

**For entity types with a registered authorizer, presigned provider URLs are not used.** The
service falls back to its own signed URL regardless of the flag. Without this rule, one environment
variable silently reopens everything this ADR closes — and it would reopen it in production, where
the flag is most likely to be on.

## Security model

Enforcement is **one private method in `FileService`**, called from every path that can reach file
data or bytes — not from the download endpoint alone:

| Path | Intent | Enforcement |
|---|---|---|
| `getById` | read | deny → 404 |
| `list` | read | **filter**, not throw — a listing spans many entities |
| `listVersions` | read | deny → 404 |
| `issueDownloadTicket` | read | deny **before** the ticket is minted |
| `openSignedStream` | read | re-check at stream time (guarded types) |
| `readBuffer` | read | deny — used by OCR, branding, evaluation packages |
| `copy` | read (**source**) | deny — closes an existing hole |
| `replace`, `update`, `archive`, `restore`, `softDelete`, `permanentDelete` | write | deny → 403 |

Threats closed: reading by known file id; enumeration via `list`; version listing; ticket issuance;
ticket leakage between users; server-side byte reads; copy-to-own-entity exfiltration; widening via
`visibility`; and the presigned-URL bypass.

Threats explicitly **not** in scope: a user who legitimately holds access and then forwards the
*bytes*; compromise of `STORAGE_SIGNING_SECRET`; and direct access to the storage bucket outside
the application. These are credential and infrastructure concerns, not authorization ones.

## Backward compatibility

- No HTTP shape changes. No new endpoint. No upload path added or altered.
- No permission added, removed or re-scoped.
- No data migration. `entityRef` has been written on every file since upload; nothing stored
  changes shape. Existing files behave identically until their module registers an authorizer.
- The only behavioural change is intentional: requests that previously reached files of guarded
  entities outside the caller's reach now fail.

## IT-3 integration

IT registers two authorizers, both expressed in rules the module already enforces:

- **`it/ticket`** — may I read this ticket? Resolved through the same
  `scopeSelector(ctx, 'itTicket.view')` the ticket endpoints use, so FR-8's `own` scope applies
  with no special case.
- **`it/ticketComment`** — may I read the ticket, **and**, if the comment is `internal`, do I hold
  `itTicket.edit`? This is FR-7's rule reused, not a second copy of it.

With this in place, comment attachments follow their comment's visibility (design §13-Q9) through
the same query-layer guarantee that governs the comment itself — and the direct file path is closed
rather than merely bypassed. IT-3 is not complete until this holds.

## Future HR integration

HR is untouched by this slice, and gains the same protection whenever it chooses, by registering
`hr/employeeFile`, `hr/applicant` and the evaluation-package types. No change to the Files service
is required at that point — which is the whole return on building a seam instead of an IT-specific
guard.

One consequence to plan for when HR does register: the applicant→employee promotion calls
`FileService.copy`, which now authorizes the **source**. That path will need to run under a context
that may read the applicant's file. Nothing breaks before HR registers.

## Testing strategy

Security tests assert the *absence* of a bypass on every path, not the presence of a check on one:

- Read by known file id, holding `file.view` and `file.download`, for a ticket outside scope.
- `list` filtered to another entity's `entityId`.
- `listVersions` on a guarded file.
- Ticket issuance for an invisible entity.
- A ticket minted for user A replayed by user B.
- `readBuffer` and `copy` against a guarded source.
- `visibility` flipped to `public` by a `file.edit` holder — must not widen access.
- Authorizer throwing, and exceeding its budget — both deny.
- `STORAGE_PRESIGNED_URLS=true` — no provider URL for guarded entities.
- Internal comment attachment: invisible to the requester on **every** path.
- Regression: unregistered entity types (HR files, branding logos, OCR reads) behave exactly as
  before, asserted against the existing suites.

## Alternatives rejected

**An IT-owned read endpoint that checks the parent comment.** The obvious local fix, and it does
not work: `GET /platform/files/:id/download` stays open, so it adds a safe path beside an unsafe
one. A second door does not lock the first.

**Make attachments `private` and keep `file.download` away from help-desk roles.** Authorization by
role configuration rather than by code. Any role holding `file.download` for an unrelated reason —
HR, an administrator — reopens it, and nothing fails when someone grants it.

**Give files a real data scope (branch/owner) instead of a seam.** Cheaper, and wrong: a ticket's
readability is not a branch or an uploader question. It is `own`-scoped for its requester and
comment-visibility-scoped for its notes. No generic dimension expresses that.

**Enforce in each module's own endpoints and leave the platform alone.** Every module would
re-implement the same guard, and the platform's direct routes would remain the hole. This is the
`buildItTimelineModel` argument in the opposite direction: one idiom, one implementation.

**Bind every ticket to its subject, not just guarded ones.** Simpler to reason about, but it breaks
inline image embedding for branding and any future public asset — a real regression paid for no
security gain, since unguarded files are readable by their permission anyway.

## Consequences

- The Files service acquires a dependency direction it did not have: it asks modules questions.
  Kept acyclic by the registry — modules push authorizers in at boot; the service imports nothing
  from any module.
- Every guarded read costs one module callback. For IT that is one indexed ticket lookup; the
  200 ms budget and the fail-closed timeout keep a slow authorizer from becoming an availability
  problem.
- A file attached to a guarded entity is no longer embeddable as a plain `<img src>`.
- The deferral in `docs/02-architecture/files-service.md` is discharged and that text now describes
  the seam.
