# ADR-020: Shared file storage for a multi-service deployment

**Status:** Proposed · **Date:** 2026-08-05 · **Supersedes the storage-topology consequence of**
[ADR-010](ADR-010-file-storage.md)

## Context

[ADR-010](ADR-010-file-storage.md) put binaries behind a `StorageProvider` interface and shipped
`LocalDiskProvider` first, backed by a Railway volume. It recorded the price of that choice
explicitly:

> ⚠️ Local volume ties file availability to a **single service instance** until the cloud adapter
> lands — accepted for the first deployments, and the adapter interface caps the cost of the fix.

That acceptance was sound when one process did everything. It is no longer true. ECMS now deploys
as **two services from the same image** ([ADR-009](ADR-009-bullmq-jobs.md), the BullMQ worker as a
separate service "from day one"), and since Sprint CT-5 and RW8b the worker does not merely
*process* files — it **stores** them:

| Writer | Process | What it stores |
|---|---|---|
| `contract-pdf.ts:78` (`hr.contract.renderRequested`) | **worker** | the contract PDF → `generation.pdfFileId` |
| `evaluation-batch-package.ts:187` (`hr.evaluationBatch.generated`) | **worker** | `list.pdf` + the ZIP package → `package.listPdfFileId` |

And the bytes are read from the other side:

| Reader | Process | What it reads |
|---|---|---|
| `contract.routes.ts:149` → `issueDownloadTicket` → `streamSignedFile` | **app** | the contract PDF the **worker** wrote |
| the evaluation-batch download route | **app** | the package the **worker** wrote |
| `contract-branding.service.ts:121` (`resolveRenderBranding`, called during PDF render) | **worker** | the company logo the **app** uploaded |
| `evaluation-batch-package.ts:134` | **worker** | applicant attachments the **app** uploaded |

The dependency runs **both ways**. The file store is no longer a private detail of one process: it
is **shared state between two of them**. A filesystem local to a container cannot be shared state,
and a Railway volume attaches to **exactly one service**, so there is no assignment of
`STORAGE_DRIVER=railway|local` that makes the current topology correct.

This is not a misconfiguration. It is an invariant of ADR-010 that stopped holding when the work
moved to the worker, and was never re-examined. It has been failing silently, because the
`readBuffer` call sites swallow the miss (`.catch(() => null)`) and every screen that displays a
stored file renders a failed read as its own ordinary empty state — a contract generated without
its letterhead, and a batch package built without its attachments, both look like a deliberate
absence.

## Decision

**Adopt an S3-compatible object store as the file store for every deployment that runs more than
one process.** `LocalDiskProvider` remains supported and is the right choice for exactly one case:
a single-process deployment (a developer machine, CI, an evaluation install).

Concretely:

1. `STORAGE_DRIVER=s3` (or `minio`) becomes the supported production setting; both are already
   served by the existing `S3Provider`.
2. `railway` and `local` are documented as **single-process drivers**. A deployment that runs the
   worker alongside the api must not use them.
3. The choice between a **managed** S3-compatible service and a **self-hosted MinIO** is decided on
   one axis — where the data is legally allowed and operationally required to live — and is left to
   the platform owner. The code path is identical either way.
4. Download URLs continue to be issued by the app's own signing endpoint; the object store's native
   presigning is **not** enabled in the first migration. See Consequences.

No call site changes. That is precisely the property ADR-010 bought.

## Alternatives considered

### A. Shared volume between the two services

Give app and worker the same mounted filesystem.

- ✅ No new infrastructure; `LocalDiskProvider` keeps working unchanged.
- ❌ **Not available on the current platform.** Railway attaches a volume to one service. This is
  not a setting we have failed to find; it is the product's model.
- ❌ Where it *is* available (EFS, an RWX PVC, an NFS export), it buys a filesystem with weaker
  guarantees than the local one it imitates — no atomic cross-host rename, surprising locking,
  latency that turns a `put` into a network round trip anyway.
- ❌ It also caps horizontal scaling of the api at one replica, which is the same ceiling ADR-010
  flagged, merely widened by one service.

Rejected: unavailable today, and a downgrade even where available.

### B. Managed S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, Spaces)

- ✅ Genuinely shared: both processes address the same bytes by key, with no filesystem semantics
  to emulate.
- ✅ `S3Provider` already exists and is covered by `storage.spec.ts` — this is configuration and a
  data move, not new architecture.
- ✅ Durability, replication and backup are the provider's problem, not ours.
- ✅ Removes the api's single-replica ceiling as a side effect.
- ⚠️ An external dependency in the request path for uploads and downloads.
- ⚠️ Egress cost on downloads (R2 charges none, which is why it is the usual pick for this shape).
- ⚠️ **Data residency**: applicant National-ID images, hiring documents and signed contracts would
  live in the provider's region. Whether that is acceptable is a legal/compliance question about
  Egyptian personal-data and labour record-keeping rules — outside what this ADR can settle, and it
  must be answered before a region is picked.

### C. Self-hosted MinIO

The same `S3Provider`, pointed at a MinIO service with `S3_ENDPOINT`.

- ✅ Identical code path to B — the decision is reversible in one variable.
- ✅ The data stays in infrastructure you control, which is the answer if residency is a
  requirement.
- ✅ No egress billing.
- ❌ You operate it: durability, backups, upgrades, monitoring, capacity.
- ❌ On Railway, MinIO itself needs a volume — so a single-service-single-volume topology returns,
  now holding *all* the platform's files with no managed replication behind it. That is a supported
  topology (one writer, one volume) rather than the impossible one we have, but it concentrates
  risk in a component we would then own.

Rejected as the *default*, retained as the residency answer.

### D. Proxy every worker file operation through the app's HTTP API

The worker stops touching storage and calls `POST /platform/files` on the app instead.

- ✅ Restores a single writer; `LocalDiskProvider` plus one volume becomes correct again.
- ✅ No new infrastructure at all.
- ❌ Requires a **machine identity** — a service credential, its issuance, rotation and audit
  representation. None of that exists today, and inventing an authentication surface is a larger
  change than adopting a store the abstraction was designed for.
- ❌ Inverts the layering: the worker would call a public HTTP surface to reach a service it already
  holds in-process (ADR-003).
- ❌ Routes multi-megabyte PDFs and ZIP packages through the api, and couples worker progress to app
  availability — a queue that exists to survive the api being busy would now wait on it.
- ❌ Leaves the api's single volume as the scaling ceiling.

Rejected: highest new-mechanism cost, and it preserves the constraint rather than removing it.

## Recommendation

**Take option B, with option C as the residency variant.** Reasons, in order of weight:

1. **The bug is present, not hypothetical.** Contract PDFs and batch packages the worker writes are
   already unreadable by the app. Every option except a genuinely shared store leaves that standing.
2. **The abstraction was built for this.** ADR-010 named the cloud adapter as the eventual answer
   and capped the cost of the change at "an adapter + a data-move script". The adapter is written.
   This is the moment it was written for.
3. **A and D preserve the single-writer constraint** that the two-service topology has already
   outgrown; both would have to be undone again the first time the api needs a second replica.

Between B and C: pick on **data residency**, not on cost or effort — they are close enough that
residency should decide. If personal documents may leave the country, take a managed S3-compatible
store (R2 for zero egress). If they may not, take MinIO and accept that its durability becomes an
operational responsibility.

## Consequences

- ✅ Both processes address one store; the worker↔app dependency in both directions is satisfied by
  construction rather than by hoping they share a disk.
- ✅ The api is free to scale beyond one replica.
- ✅ Migration is verifiable end to end: every `files` row already carries `checksum`
  (`sha256:…`), so a copy can be proved byte-identical rather than assumed.
- ⚠️ **Presigning changes two things and is therefore deferred.** `S3Provider.getSignedUrl` returns
  a presigned URL, and `issueDownloadTicket` prefers it over the app's own signed URL. That would
  (a) hand the browser an **absolute, cross-origin** URL, which the app's
  `img-src 'self' data: blob:` Content-Security-Policy refuses — the exact failure mode that took
  three rounds to diagnose for applicant-source icons — and (b) move the byte transfer out of the
  app entirely, so nothing observes the fetch. Keeping the app's signed endpoint preserves both the
  same-origin URL and a single place where a download is served.
- ⚠️ Uploads and downloads acquire a network hop to the object store. For the file sizes in this
  platform (≤ 25 MB by `MAX_UPLOAD_MB`, contracts and IDs in the low megabytes) this is not a
  concern worth designing around, but it is no longer a local write.
- ⚠️ Files already stored on a container filesystem must be moved, and files already lost to a
  redeploy cannot be. The inventory of affected records is part of the migration
  ([design document](../12-planning/shared-file-storage-design.md)).
- ⚠️ `railway` and `local` remain in `STORAGE_DRIVER`. They are not deprecated — they are correct
  for a single-process install — but the deployment guide must stop presenting `railway` as the
  production answer for a topology that includes the worker.
