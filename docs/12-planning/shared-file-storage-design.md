# Shared File Storage — migration design

**Status:** Draft for approval · **Date:** 2026-08-05 · **Decision:**
[ADR-020](../03-decisions/ADR-020-shared-file-storage.md) · **Supersedes the topology consequence
of** [ADR-010](../03-decisions/ADR-010-file-storage.md)

No code in this document has been written. It exists so the storage decision can be taken on its
own terms, in its own sprint, rather than inside an HR bug fix.

---

## 1. Why this exists

`/applicant-sources` showed a placeholder where a platform logo should be. Tracing that to its root
found a file whose database row was perfect and whose bytes were gone, and tracing *that* found
something larger: **the file store is shared state between two processes, and it is implemented as
a filesystem local to one of them.** The icon was a symptom with a small blast radius. Contract PDFs
and evaluation-batch packages have the same cause and a much larger one.

The decision and its alternatives are in ADR-020. This document is the *how*.

---

## 2. The storage abstraction as it stands

### 2.1 The seam

`apps/api/src/infrastructure/storage/` — one interface, four implementations, chosen once by
`STORAGE_DRIVER`:

```ts
export interface StorageProvider {
  readonly driver: StorageDriver;
  put(key: string, data: Buffer, options: PutOptions): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Presigned URL, or `null` when the provider cannot presign. */
  getSignedUrl(key: string, ttlSeconds: number, options: SignedUrlOptions): Promise<string | null>;
}
```

| `STORAGE_DRIVER` | Implementation | Presigns? |
|---|---|---|
| `local` | `LocalDiskProvider(STORAGE_LOCAL_ROOT)` | no → `null` |
| `railway` | `LocalDiskProvider(RAILWAY_VOLUME_MOUNT_PATH)` | no → `null` |
| `s3` / `minio` | `S3Provider` (`minio` = same class + `S3_ENDPOINT`) | **yes** |
| `azure` | `AzureBlobProvider` | yes, when credentialed |

The provider is a lazily-built singleton (`getStorageProvider`). Keys are service-generated:
`files/{groupId}/{fileVersion}-{uuid}{ext}`, validated by `assertSafeKey` against traversal.

### 2.2 What sits on top

`FileService` owns every rule above the bytes: category mime/size validation, version groups,
sha-256 checksums, soft delete vs permission-gated purge, `visibility`-aware download
authorization, and per-download audit records. **None of that is provider-specific** — which is the
property ADR-010 was buying, and the reason this migration is configuration plus a data move
rather than a rewrite.

### 2.3 How a stored file reaches a browser today

1. `GET /platform/files/:id/download?mode=ticket` → `issueDownloadTicket`
2. `authorizeDownload` — `public` → any authenticated user; `private` → `file.download`
3. `provider.getSignedUrl(...)` → **`null`** on the disk drivers
4. falls back to `appSignedUrl` — an HMAC over `{fileId}.{expiresAt}` with
   `STORAGE_SIGNING_SECRET`, TTL `SIGNED_URL_TTL_SECONDS` (default 300s)
5. the URL is **relative** when this process also serves the SPA (`signed-url.ts`), so the browser
   stays on one origin
6. `GET /api/v1/platform/files/signed/:id?e=&s=` → `streamSignedFile` verifies the HMAC and pipes
   the bytes, with `Cross-Origin-Resource-Policy: cross-origin`

Steps 5 and 6 are load-bearing for the CSP, and §6 explains why.

---

## 3. Inventory — every `FileService` usage, classified

Complete as of `ea86908`. "Process" is where the code actually runs, not where it is declared —
both services run the same image.

### 3.1 Upload — app, from an HTTP request

| # | Call site | What it stores |
|---|---|---|
| 1 | `platform/files/file.controller.ts:31` | `POST /platform/files` — the **generic intake**; applicant-source icons arrive here |
| 2 | `platform/files/file.controller.ts:38` | `POST /platform/files/:id/replace` — version n+1 |
| 3 | `hr/recruitment/applicants/applicant.service.ts:930` | applicant attachments (CV, National-ID images) |
| 4 | `hr/recruitment/hiring-documents/hiring-documents.service.ts:157` | hiring documents |
| 5 | `hr/recruitment/hiring-documents/hiring-documents.service.ts:217` | hiring document replacement (`replace`) |
| 6 | `hr/employee-management/employee-file/employee-file.service.ts:353` | electronic employee-file documents |
| 7 | `hr/recruitment/evaluations/evaluation.service.ts:152` | evaluation attachments |
| 8 | `hr/recruitment/evaluation-batches/evaluation-batch.service.ts:382` | returned batch results |
| 9 | `hr/leave-management/leave-requests/leave-request.service.ts:803` | leave-request attachments |
| 10 | `hr/contracts/branding/contract-branding.service.ts:90` | the company logo |
| 11 | `hr/contracts/contracts/contract.service.ts:548` | contract attachments |

### 3.2 Worker writes — no HTTP request involved

| # | Call site | Trigger | What it stores |
|---|---|---|---|
| 12 | `hr/contracts/contracts/contract-pdf.ts:78` | `hr.contract.renderRequested` (reliable) | the contract PDF → `generation.pdfFileId` |
| 13 | `hr/recruitment/evaluation-batches/evaluation-batch-package.ts:187` | `hr.evaluationBatch.generated` (reliable) | `list.pdf` **and** the ZIP package → `package.listPdfFileId` |

### 3.3 Read (server-side buffer, `readBuffer`)

| # | Call site | Process | Reads |
|---|---|---|---|
| 14 | `hr/recruitment/applicants/paddle-ocr-provider.ts:75` | **app** (`POST /hr/applicants/ocr/national-id`) | the National-ID image it is about to OCR |
| 15 | `hr/contracts/branding/contract-branding.service.ts:121` via `contract.service.ts:258` (generate) and `:625` (preview) | **app** | the company logo → data URI in the render |
| 16 | the same, via `evaluation-batch-package.ts:163` | **worker** | the company logo, during package build |
| 17 | `hr/recruitment/evaluation-batches/evaluation-batch-package.ts:134` | **worker** | applicant attachments, to place inside the ZIP |

### 3.4 Signed download — app only

| # | Call site | Notes |
|---|---|---|
| 18 | `platform/files/file.controller.ts:100` → `issueDownloadTicket` | the generic ticket endpoint; every image in the console |
| 19 | `platform/files/file.controller.ts:109` → `streamSignedFile` | the one unauthenticated route, guarded by HMAC + expiry |
| 20 | `hr/contracts/contracts/contract.routes.ts:149` → `issueDownloadTicket` | **the app issuing a ticket for the PDF the worker wrote** |

### 3.5 Defined but unused

`fileService.copyTo` (`file.service.ts:280`) has no call site outside the service. It reads bytes
and writes them into a new group, so it inherits whatever the store is; noted so the migration
covers it rather than discovering it later.

### 3.6 What the inventory says

- **Cross-process reads exist in both directions.** #20 is the app reading what the worker wrote
  (#12, #13). #16 and #17 are the worker reading what the app wrote (#3, #10).
- **Every user-facing download is served by the app** (#18–#20). The worker has no public route, so
  it never serves bytes to a browser.
- **All 20 call sites go through `FileService`.** No feature reaches `getStorageProvider` directly.
  The migration therefore has exactly one seam to change.

---

## 4. What changes

**Configuration, one provider selection, and a data move. No call site is touched.**

| Area | Today | After |
|---|---|---|
| `STORAGE_DRIVER` (app + worker) | `railway` | `s3` or `minio` |
| New variables (both services) | — | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (MinIO / R2) |
| Railway volume on **app** | holds the files | no longer holds files; keep until cutover is verified, then release |
| `files.storage.driver` on existing rows | `railway` | rows written after cutover say `s3`/`minio`; **old rows keep their old value** |
| Download URL | app-signed, relative | **unchanged** — see §6/§7 |

### 4.1 The one code change the migration needs

`issueDownloadTicket` prefers `provider.getSignedUrl(...)` and only falls back to the app's own
signing when it returns `null`. `S3Provider` **does** presign, so switching the driver silently
changes every download URL in the product from a relative same-origin path to an absolute
cross-origin one — §6 explains why that breaks images and §7 what it costs beyond them.

The migration therefore needs a way to say *"use this store, but keep serving the bytes yourself"*.
Two candidate shapes, to be settled in the implementation sprint:

- **a setting** (`STORAGE_PRESIGN=false`, default `false`) read where the ticket is issued; or
- **a provider capability** — construct `S3Provider` with presigning disabled, so it reports `null`
  like the disk providers and the existing fallback does the rest.

The second keeps the decision inside the storage seam and leaves `FileService` untouched, which
suits the layering better; the first is easier to flip per environment. Either is small. What must
*not* happen is switching the driver and discovering the URL shape changed.

### 4.2 What deliberately does not change

- The `StorageProvider` interface.
- `FileService` and all 20 call sites.
- The `files` / `file_groups` schema, checksums, version groups, categories, permissions, audit.
- The app-signed download endpoint and its HMAC.
- The CSP.

---

## 5. File migration plan

### 5.1 Copy, verify, then cut over

1. **Provision** the bucket. Private, no public read; versioning on if the provider offers it.
2. **Copy** every object at its existing key — keys are already store-agnostic
   (`files/{groupId}/{...}`), so nothing is rewritten and no database update is needed for the key.
3. **Verify** each copy by sha-256 against `files.checksum`. This is free integrity checking that
   the schema already pays for. Objects that cannot be read at the source, or whose checksum does
   not match, are **recorded and skipped, never patched over** — they feed the validation report in
   §9.2 rather than being resolved silently mid-copy.
4. **Cut over** in one deploy: set the new variables on **both** services and redeploy together.
   They must not run split across two stores, or a file written in the gap lands in the old one.
5. **Verify live** — the checklist in §9.1.
6. **Report** — the full validation pass, §9.2.
7. **Retain** the old volume, read-only and unmounted from the write path, for a defined window
   (suggest 30 days) before releasing it.

### 5.2 What about `files.storage.driver` on old rows?

Leave it. It records where a file **was written**, which is history, not routing — `getStream` uses
the active provider and the key. Rewriting it would erase the only in-database evidence of which
files predate the migration, and that evidence is useful precisely while diagnosing a bad cutover.

### 5.3 Worker-written files already lost

Contract PDFs and batch packages written by the worker are on the worker's container filesystem and
are gone at its next redeploy. They are **regenerable**, unlike an uploaded document:
`hr.contract.renderRequested` can be re-emitted per contract, and a batch package can be rebuilt
from its (still intact) database rows. Whether to re-run them in bulk after cutover, and for which
date range, is a business call — the mechanism exists either way.

---

## 6. CSP impact

The app serves the SPA, so helmet's Content-Security-Policy governs the app document itself.
Today's image directive, after the PR #146/#147 fixes:

```
img-src 'self' data: blob:
```

CSP matches origins **byte for byte**. A presigned S3 URL is an absolute URL on the bucket's
origin, so every stored image would be refused by the browser with no server-side error — the
server sees no request at all. That is exactly the failure that took three passes to diagnose for
applicant-source icons, and the migration must not reintroduce it.

Two ways out:

| | Effect on CSP | Trade-off |
|---|---|---|
| **Keep serving bytes through the app** (§4.1) | **none** — URLs stay relative and same-origin | one network hop: object store → app → browser, and the app's egress |
| **Add the bucket origin to `img-src`** | widens `img-src` to a third-party host | the browser fetches from the store directly; the policy now names an infrastructure provider, and it must be widened again if the store moves |

**Recommendation: the first.** Not only for the CSP — see §7. If the second is ever taken, note
that `img-src` is not sufficient on its own: anything fetched with `fetch`/XHR rather than `<img>`
also needs `connect-src`, and the bucket must send permissive CORS/CORP headers of its own.

---

## 7. Download-ticket impact

`issueDownloadTicket` is where every download is **authorized** and **audited**:

```
authorizeDownload(ctx, doc)          // visibility + file.download + scanStatus
auditService.record({ action: 'download' })
```

That is unchanged by the store. What changes with presigning is what happens **after** the ticket:

| | Today (app-signed) | With presigning |
|---|---|---|
| Who serves the bytes | the app (`streamSignedFile`) | the object store, directly |
| Origin | same as the app | the bucket's |
| Capability | HMAC over `{fileId}.{expiresAt}`, `STORAGE_SIGNING_SECRET` | the provider's signature |
| TTL | `SIGNED_URL_TTL_SECONDS` (300s) | the same value, passed through |
| Does anything observe the fetch? | yes — the request reaches the app | **no** |
| Can access be revoked mid-TTL? | in principle, at the app | no |

Both models audit at ticket issue, not at byte fetch, so neither gives a true "was it actually
downloaded" record today. But the app-signed model **keeps the door in the building**: one place
that could later log, throttle or revoke a fetch. Presigning hands out a capability that nothing we
run will ever see used again.

For a platform holding National-ID images, signed contracts and hiring documents, that is the
stronger reason to keep serving bytes through the app — the CSP is merely the loudest one.

---

## 8. Rollback plan

The migration is **reversible for its entire duration**, because §5.1 copies rather than moves and
the old volume is retained (§5.1 step 7).

| Failure | Detection | Rollback |
|---|---|---|
| Copy or verification incomplete | the copy pass itself (§5.1 steps 2–3), before cutover | none needed — cutover has not happened |
| Cutover deploy is bad (bucket unreachable, credentials wrong) | `/health/ready`, boot log, first download 404/500 | set `STORAGE_DRIVER` back to `railway` on both services and redeploy; the volume still holds everything |
| Downloads break for a subset | §9.1 checklist, `FILE_OBJECT_MISSING`-shaped errors | same rollback; investigate the subset against the §9.2 report |
| Problem found **after** new uploads have landed in the bucket | audit log / `files.uploadedAt` after cutover | rollback also needs those new objects copied **back** to the volume — which is why the retention window matters and why the rollback window should be declared explicitly (suggest 7 days) |

Rollback is a **configuration change plus a redeploy**, not a data restore, for as long as both
stores hold the same bytes. The moment the volume is released, rollback becomes a restore from the
object store's own backups — that is the point of no return, and it should be a deliberate, dated
decision rather than a cleanup task.

---

## 9. Verification

### 9.1 Live checklist (post-cutover, before releasing the volume)

Each line is a thing to observe, not to assume:

1. Boot log on **both** services names the new driver.
2. Upload an applicant-source icon → it renders in the `/applicant-sources` table; zero CSP
   violations and zero failed requests in the console.
3. Open a pre-migration document (a hiring document uploaded before cutover) → it downloads and its
   bytes match its stored checksum.
4. Generate a contract → the worker renders it → **the app serves the PDF** (this is the cross-
   process read that does not work today, #12 → #20).
5. The generated contract carries the company **letterhead** (the worker reading what the app wrote,
   #16 — also broken today).
6. Issue an evaluation batch → the ZIP package downloads and **contains applicant attachments**
   (#17, likewise broken today).
7. National-ID OCR still reads its image (#14).
8. A `private` file still refuses a user without `file.download`, and the refusal is still audited.
9. Every download URL in the network tab is **relative** and same-origin.

Items 4, 5 and 6 are the ones that prove the migration achieved its purpose; the rest prove it broke
nothing.

### 9.2 Post-migration validation report

A read-only pass over the whole `files` collection against the **new** store, producing one report:

| Bucket | Meaning |
|---|---|
| **existing** | the object is there and its sha-256 matches `files.checksum` |
| **missing** | the row exists, the object does not — **already lost**, and not recoverable by this migration |
| **corrupted / checksum mismatch** | the object is there and its bytes are not the ones recorded — investigate individually, never overwrite |
| **summary by module** | the three buckets grouped by `entityRef.moduleId` / `entityType` and by `uploadedAt` period |

Grouping matters more than the totals: the answer that is useful is "which documents, belonging to
whom, from which period", not a count. Expect worker-written contract PDFs and evaluation-batch
packages to appear as **missing** even where nothing was ever erased — they were written to the
worker's own filesystem, which the app could never read (§3.6).

**This runs after the migration, deliberately.** Run against the old topology it would be a snapshot
of an architecture about to be replaced — and it could not distinguish "lost" from "written to the
other container", because in that topology the two are indistinguishable from either process. Run
against the finished shared store, every remaining miss is a real one, and the report doubles as the
proof that the migration moved what it claimed to.

The output is the input to the last decision: for each **missing** record, re-upload (documents), or
re-generate (contract PDFs and batch packages, per §5.3), or accept the loss and record it.

---

## 10. Open questions for the owner

These are decisions, not research tasks — the implementation sprint should not start until they are
answered:

1. **Managed S3-compatible store, or self-hosted MinIO?** ADR-020 recommends deciding on data
   residency: may applicant National-ID images, hiring documents and signed contracts leave Egypt?
   That is a legal/compliance question, and it is the only one that should decide this.
2. **Presigning** — confirm the recommendation to keep serving bytes through the app (§6, §7).
3. **Re-generating worker-written artefacts** (§5.3) — re-run contract PDFs and batch packages in
   bulk after cutover, and for which period? The §9.2 report is what turns this from a guess into a
   list.
4. **Rollback window** (§8) and **volume retention window** (§5.1) — the suggested 7 and 30 days
   are placeholders.

*(Settled 2026-08-05: the loss report runs **after** the migration, not before — §9.2. Against the
old topology it could not tell "lost" from "written to the other container", and it would be a
snapshot of an architecture about to be replaced.)*
