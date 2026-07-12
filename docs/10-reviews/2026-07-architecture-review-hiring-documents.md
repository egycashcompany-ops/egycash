# Architecture Review — HR / Recruitment: Hiring Documents (Stage 6)

**Subject:** [PR #27](https://github.com/egycashcompany-ops/egycash/pull/27) — Hiring Documents
(Stage 6), module version `0.11.0` · **Reviewer role:** independent enterprise-architecture
review of the implementation · **Date:** 2026-07-12 · **Verdict:** ✅ **Approvable** — no
Critical or High findings; one small, low-risk mitigation applied in-PR (HD-01), everything
else documented for later sprints. **Not merged** pending EGYCASH sign-off.

This review deliberately looks for weaknesses and does not defend the design. It evaluates the
implementation as shipped, not the intent.

## 0. Scope reviewed

`packages/contracts/src/modules/hr-hiring-documents.ts` and
`apps/api/src/modules/hr/recruitment/hiring-documents/**` (document-type catalog + hiring
documents aggregate, service, repositories, controller, routes, mapper, Files-category seam),
plus the manifest/seed wiring and the integration + mapper tests. Stage 7 (Electronic File) and
earlier stages were out of scope except at their integration seams.

## 1. Summary of findings

| ID | Area | Severity | Action |
|----|------|----------|--------|
| HD-01 | Non-atomic file write + aggregate update | Medium | **Fix in this PR** (mitigation) + Future (reconciliation) |
| HD-02 | Mirrored file metadata can drift from Files aggregate | Medium | Next Sprint |
| HD-03 | Document download needs platform `file.download`, not `hiringDocuments.view` | Medium | Next Sprint |
| HD-04 | `versions` endpoint returns full `FileDto` (internal fields) | Low | Next Sprint |
| HD-05 | Per-item `required` flag denormalized (can go stale) | Low | Next Sprint |
| HD-06 | No remove/clear of a wrongly-slotted document | Low | Future |
| HD-07 | PDF validation is MIME-only (no content sniff) | Low | Future |
| HD-08 | Events are in-process tier, emitted post-commit | Low | Future |
| HD-09 | Document event payload carries ad-hoc `typeKey` not in schema | Low | Next Sprint |
| HD-10 | Completion gate not transactional with the type catalog | Low | Won't Fix (documented) |
| HD-11 | Whole-`documents`-array read-modify-write per mutation | Low | Future |
| HD-12 | Global document-type catalog (not per branch/role) | Low | Future |
| HD-13 | No document expiry / validity dates | Low | Future |
| HD-14 | No per-document approval/verification sub-state | Low | Future |
| HD-15 | Branch scope derives from the offer's unvalidated `branchId` | Low | Future |
| HD-16 | Test-coverage gaps | Low | **Fix in this PR** (partial) + Next Sprint |
| HD-17 | `displayName`/`fileName`/`typeName` divergence | Low | Won't Fix (documented) |
| HD-18 | `search` is an unanchored regex over `employeeCode` | Low | Future |

No Critical/High findings. The two Medium items (HD-01, HD-02, HD-03) are correctness/robustness
concerns with safe interim behavior, not release blockers.

---

## 2. Detailed findings

### HD-01 — File write and aggregate update are not one atomic unit
- **Area:** Transaction boundaries, concurrency, failure handling, file versioning.
- **Description:** `uploadDocument`/`replaceDocument` write bytes to the Files service first,
  then update the aggregate's `documents` array under optimistic concurrency. Object storage
  cannot enlist in a Mongo transaction, so the two writes are not atomic. A lost optimistic
  race — or a crash between the file write and the aggregate update — leaves an **orphaned file
  version** (upload) or a **newer file version the item never points to** (replace).
- **Severity:** Medium.
- **Business Impact:** Wasted storage and a confusing "latest version exists but isn't current"
  state; no corruption of existing referenced data and no user-visible failure on the happy path.
- **Recommendation / Action:** **Fixed (mitigation) in this PR** — the service now rejects a
  stale `version` *before* writing bytes, collapsing the window to the narrow gap between the
  in-request `getById` and `updateById` (the authoritative atomic check still runs there). Full
  closure is a **Future** item: a reconciliation sweep that reaps hiring-document file
  versions/groups not referenced by any aggregate item, or an "attach a pre-uploaded file"
  two-step that makes the aggregate the single commit point.

### HD-02 — Mirrored file metadata can drift from the Files aggregate
- **Area:** Aggregate boundaries, file versioning, data integrity.
- **Description:** Each item mirrors `fileId`/`fileName`/`fileVersion` from the File doc. Files
  are stored under `entityType: 'hiringDocuments'`, but the platform Files API can still be
  invoked directly (`replace`/`archive`/`softDelete`) by any holder of file permissions,
  desyncing the mirror (e.g., the item points at an archived version).
- **Severity:** Medium.
- **Business Impact:** A hiring document could display stale metadata or point to an archived
  file if someone manipulates it outside the hiring-documents workflow.
- **Recommendation / Action:** **Next Sprint.** Either resolve the current file via the file
  *group* at read time (treat the aggregate item as an authority over "which group", not "which
  version"), or restrict direct Files-API mutation for module-owned `entityType`s. Low
  likelihood in practice (no UI drives direct file edits), hence not a blocker.

### HD-03 — Downloading the PDF requires platform `file.download`
- **Area:** Authorization, security, workflow usability.
- **Description:** `hiringDocuments.view` exposes document *metadata* and the version list, but
  the bytes are `private`-visibility files whose download goes through the platform Files
  download-ticket path gated by `file.download`. A reviewer holding only `hiringDocuments.view`
  cannot retrieve the actual document.
- **Severity:** Medium (usability), Low (security — it fails closed).
- **Business Impact:** HR reviewers can't open hiring documents unless their role also carries
  the platform `file.download` permission; the coupling is implicit and undocumented.
- **Recommendation / Action:** **Next Sprint.** Add a feature-scoped download endpoint that
  authorizes via `hiringDocuments.view` and proxies `fileService.openSignedStream`, or
  explicitly bundle `file.download` into HR reviewer roles and document the dependency.

### HD-04 — `versions` endpoint returns the full `FileDto`
- **Area:** Security (information exposure), API surface.
- **Description:** `GET /:id/documents/:typeId/versions` returns `fileService.toDto(...)` —
  including `storedName`, `storageDriver`, `checksum`, `groupId`, and `entityRef`. More than a
  hiring-documents consumer needs. (Consistent with the existing applicant-attachments listing,
  so not a regression.)
- **Severity:** Low.
- **Business Impact:** Minor internal-detail leakage to `hiringDocuments.view` holders.
- **Recommendation / Action:** **Next Sprint.** Map to a slim version DTO (`fileVersion`,
  `fileName`, `size`, `uploadedBy`, `uploadedAt`, `isLatest`).

### HD-05 — Per-item `required` flag is denormalized and can go stale
- **Area:** Domain correctness, maintainability.
- **Description:** An item copies the type's `required` at upload. The **completion gate is
  correct** (it queries the live catalog), but the DTO's per-item `required` can disagree with
  the current catalog if an admin later flips the flag.
- **Severity:** Low.
- **Business Impact:** Cosmetic — a per-document badge may mislead; gate behavior is unaffected.
- **Recommendation / Action:** **Next Sprint.** Derive the display `required` from the live
  catalog in the mapper, or intentionally keep the historical value and label it as such.

### HD-06 — No remove/clear of a wrongly-slotted document
- **Area:** Domain, future extensibility.
- **Description:** A document uploaded to the wrong type can only be re-versioned (`replace`) —
  a slot can never be emptied.
- **Severity:** Low. **Action:** **Future** — add an audited soft-remove for in-progress sets
  if the business needs it (kept out now to preserve the "never delete a document" property).

### HD-07 — PDF validation is MIME-only
- **Area:** Security, file versioning.
- **Description:** The Files category checks the client-supplied MIME; a non-PDF with a spoofed
  `application/pdf` header passes. The Files service's scan/OCR extension point (`scanStatus`)
  is the intended content-level defense and is not enabled for this category.
- **Severity:** Low. **Action:** **Future** — register a magic-byte/scan processor for the
  hiring-documents category.

### HD-08 — Events are in-process and emitted post-commit
- **Area:** Event consistency, failure handling.
- **Description:** `hr.hiringDocuments.*` use the in-process event tier and are emitted after the
  DB commit; a crash in between drops the event. No subscribers exist today. Consistent with all
  prior HR stages.
- **Severity:** Low. **Action:** **Future** — switch to the reliable/outbox tier when a durable
  consumer (e.g., Stage 7 Electronic File) subscribes.

### HD-09 — Document event payload carries an ad-hoc `typeKey`
- **Area:** Event consistency, technical debt.
- **Description:** `HiringDocumentsEventPayloadV1` omits `typeKey`, yet `documentUploaded`/
  `documentReplaced` spread it into the emitted payload. `emit` doesn't validate, so it's
  harmless but the declared contract is incomplete.
- **Severity:** Low. **Action:** **Next Sprint** — add a dedicated document-event payload schema
  that includes `typeKey`.

### HD-10 — Completion gate not transactional with the type catalog
- **Area:** Concurrency, transaction boundaries.
- **Description:** Between reading active-required types and committing `status: completed`, an
  admin could add a new required type; the set completes without it. Documents can't be removed,
  so the only race is admin timing.
- **Severity:** Low. **Action:** **Won't Fix** (documented) — admin-timed and rare; a
  transactional re-check would add cost for negligible benefit.

### HD-11 — Whole-array read-modify-write per mutation
- **Area:** Performance, scalability, aggregate boundaries.
- **Description:** Every upload/replace rewrites the entire `documents` array under optimistic
  concurrency; concurrent uploads to the *same* set serialize (the loser gets 409 and retries).
  Correct and cheap for the expected handful of document types.
- **Severity:** Low. **Action:** **Future** — if per-employee document counts ever grow large,
  model documents as their own collection keyed by hiring-set id.

### HD-12 — Global document-type catalog
- **Area:** Future extensibility, workflow compatibility.
- **Description:** Every hire is measured against one global required/optional set; different
  branches, job families, or employment types may need different documents. Mirrors the accepted
  "global interview stages" decision (OQ-31).
- **Severity:** Low. **Action:** **Future** — document-set profiles keyed by job title/branch.

### HD-13 — No document expiry / validity dates
- **Area:** Domain, future extensibility.
- **Description:** IDs and certificates expire; the model has no validity window or renewal
  reminder.
- **Severity:** Low. **Action:** **Future.**

### HD-14 — No per-document approval/verification sub-state
- **Area:** Domain correctness.
- **Description:** "Present" == uploaded; there is no HR "verified/rejected" state per document.
  Completion checks presence, not acceptance.
- **Severity:** Low. **Action:** **Future** — add a per-document review state if document-level
  sign-off is required.

### HD-15 — Branch scope derives from the offer's unvalidated `branchId`
- **Area:** Multi-branch behavior, data integrity.
- **Description:** The aggregate is branch-scoped by the employee's `branchId`, which ultimately
  originates from the offer terms — a structurally-validated id not dereferenced against a real
  Branch. A cross-stage limitation noted in earlier reviews.
- **Severity:** Low. **Action:** **Future** — validate org references when the Requisition/Org
  integration lands.

### HD-16 — Test-coverage gaps
- **Area:** Testing.
- **Description:** Integration covers the happy paths and key guards, but not (originally):
  optimistic-concurrency stale-version rejection, branch-scope isolation, a deactivated required
  type changing completability, and `versions`-endpoint authorization. Service logic is covered
  only through integration (no service-level unit tests).
- **Severity:** Low. **Action:** **Fixed (partial) in this PR** — added a stale-version
  rejection integration test (also exercises HD-01's mitigation). **Next Sprint** — the
  remaining cases.

### HD-17 — `displayName` / `fileName` / `typeName` divergence
- **Area:** Maintainability, i18n.
- **Description:** The File doc's `displayName` is set to `type.name.en`; the aggregate keeps
  `fileName` (the upload's `originalName`) and localized `typeName`. Three overlapping "names".
- **Severity:** Low. **Action:** **Won't Fix** (documented) — behavior is correct; a future
  cleanup could standardize display naming.

### HD-18 — `search` is an unanchored regex over `employeeCode`
- **Area:** Repository design, performance, scalability.
- **Description:** The list `search` builds a case-insensitive unanchored `RegExp`, which cannot
  use an index efficiently at volume. Mirrors the applicant-search item already in the backlog.
- **Severity:** Low. **Action:** **Future** — prefix-anchor or add a dedicated index/text search.

---

## 3. Area-by-area assessment

- **Domain correctness:** Sound. Statuses (`inProgress`/`completed`), required-vs-optional types,
  and the completion invariant match the approved workflow. Gaps are extensions (HD-13/14), not
  errors. The completion gate correctly consults the *live* catalog (HD-05 is display-only).
- **Aggregate boundaries:** Clean split — bytes/versions in the Files aggregate, metadata mirror
  in the HR aggregate; cross-feature reads go through the Employee barrel and the Files/platform
  barrels only. HD-02 is the boundary's soft spot (mirror drift).
- **Repository design:** Standard `BaseRepository` extension, branch-scoped, indexed
  (`ux_employee`, status/branch). HD-18 (regex search) is the only weakness.
- **Transaction boundaries:** `create`/`complete` are single atomic updates. Upload/replace are
  the intentional exception (HD-01) — object storage can't join the DB transaction; mitigated.
- **Concurrency / races:** Optimistic concurrency on the aggregate is correct; the stale-check
  now runs before the file write. HD-10 (admin-timed) and HD-11 (serialized same-set writes) are
  low.
- **File versioning:** Correctly delegated to the Files service (`upload` → v1, `replace` →
  v_n+1, original preserved, `listVersions`). This stage adds no binary-storage code — a
  strength.
- **Authorization:** Route-level `authorize` on every endpoint; `upload`/`complete` are separate
  grants; catalog admin is its own grant. HD-03 (download coupling) is the real gap.
- **Audit consistency:** Every mutation (create, upload, replace, complete) records an audit
  entry via the platform audit service; consistent with prior stages. No findings.
- **Event consistency:** Named per ADR-008; HD-08 (tier) and HD-09 (payload hygiene) are the
  only notes.
- **Failure handling:** Notifications are fire-and-forget (never block); the Files service
  cleans up its own orphan binary on a failed store. HD-01 is the residual failure mode.
- **Performance / scalability:** Fine at expected volumes; HD-11/HD-18 flagged for growth. One
  extra `activeRequiredKeys` query per response is negligible and page-batched for lists.
- **Multi-branch:** Correctly branch-scoped; HD-15 is the upstream (unvalidated ref) caveat.
- **Security:** Fails closed on downloads; HD-04 (over-exposure) and HD-07 (MIME-only) are low.
- **Test coverage:** Good happy-path + guard coverage; HD-16 lists the gaps (one now closed).
- **Technical debt / maintainability:** Small and localized (HD-05/09/17). The feature follows
  the established module structure closely, which aids maintainability.

## 4. Changes applied in this PR (small, low-risk only)

1. **HD-01 mitigation** — `uploadDocument` and `replaceDocument` reject a stale optimistic
   `version` *before* calling the Files service.
   - **Why it is safe:** it only adds an early rejection when `before.__v !== meta.version` (the
     caller is provably stale); the happy path is unchanged; the authoritative atomic version
     check in `updateById` remains; and `StaleDocumentError` maps to the same HTTP 409 the
     update would have returned — so the API contract is identical, only the wasted upload is
     avoided.
2. **HD-16 (partial)** — added an integration test asserting a stale-version upload returns 409.

No redesign, refactor, feature, or scope expansion was performed. All architectural items above
are **documented only**.

## 5. Verification after changes

- `lint` (incl. layer-boundary rules) ✅ · `typecheck` (strict) ✅ · `build` (contracts + api +
  web) ✅
- unit tests **135 passed**; contracts **18/18** ✅ · `check:permission-matrix` ✅ ·
  `check:flag-expiry` ✅
- Integration suite `tests/integration/hr-hiring-documents.spec.ts` (now including the
  stale-version case) runs in CI.

## 6. Recommendation

**Approve for merge** on EGYCASH sign-off. Track HD-02, HD-03, HD-04, HD-05, HD-09, HD-16
(remainder) as **Next Sprint** backlog, and HD-06/07/08/10/11/12/13/14/15/17/18 as **Future**.
HD-01's residual (reconciliation sweep) should be scheduled when a hiring-documents admin UI or
higher upload concurrency is introduced.
