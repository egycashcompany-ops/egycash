# Recruitment — Applicants (Sprint 4.1 / Release v0.6)

Implementation reference for the **first Layer 2 business module**: `hr` → `recruitment`
→ **applicants** (Stage 1). Frozen plan:
[sprint-4.1-plan.md](../12-planning/sprint-4.1-plan.md). Backend-first (OQ-29); the
frontend is a later sprint. Unbuilt dependencies are swappable seams (OQ-30).

## 1. Where it sits

The HR module plugs into the Platform Core through one manifest
(`modules/hr/hr.module.ts`, [Module Structure §2.1](module-structure.md)). The kernel
validates it at boot (unique id, `hr.` permission naming, `hr_` collection prefix, `/hr`
route prefix) and **fails the boot** on violation. Deleting `modules/hr/` leaves the rest
compiling.

- **Collections (owned):** `hr_applicants`, `hr_applicant_sources`, `hr_sequences`.
- **Routes:** `/api/v1/hr/applicants`, `/api/v1/hr/applicant-sources`.
- **Permissions:** `applicant.{view,create,edit,delete,export}`, `applicant.verifyIdentity`
  (special), `applicantSource.manage` (special) — declared in the manifest, synced to the
  RBAC registry at boot (module permissions are not part of the platform permission-matrix
  catalog, which is contracts-only).
- **Seed:** the 10 applicant sources, idempotently, on every boot.

### 1.1 The module boundary and the platform web kit

Modules may import `platform` and `shared` but **not `infrastructure`** (ESLint boundary).
HTTP helpers (`respond`, `validate`, `asyncHandler`) live in `infrastructure/http`, so the
platform re-exports them through **`platform/web`** — the module imports from there
(module → platform → infrastructure). Auth (`authenticate`/`authContext`), RBAC
(`authorize`), Files (`fileService`), audit, events, and the kernel are consumed the same
way, as platform services — the module never touches Multer/Mongo of another feature
directly.

## 2. Requisition-driven (BD-001) & the Stage-0 seam

Every applicant carries a **mandatory, immutable `jobRequisitionId`** (BD-001 — no
free-floating applicants). The Job Requisition itself is **Stage 0, planned separately and
not built here**. Reference *validation* is deferred behind
`RequisitionReferenceValidator` (`requisition-ref.ts`); the default performs structural
validation only (valid ObjectId, echoes the caller's branch). When the Requisition module
lands, a real validator (existence + approved + branch resolution) replaces it with no
change to the applicant service.

## 3. Intake pipeline

One pipeline serves every registration path (§2.1 of the plan). This sprint builds only
the **authenticated internal path**; the unauthenticated public/mobile surface and
external-platform adapters are **not built** (their governing decisions OQ-17/18 are open)
— they would call the same `applicantService.register()` seam once decided.

```
register(input)
  → source active?              (hr_applicant_sources)
  → requisition ref valid?      (RequisitionReferenceValidator seam)
  → intakeKey idempotency       (retried intake returns the first applicant)
  → National ID: parse+derive   (parseNationalId — birth date/gender/governorate, real)
                 live-uniqueness (unique partial index among status:new)
  → allocate code               (APP-{YYYY}-{seq:6}, atomic hr_sequences, BD-002)
  → create applicant (unverified)
  → heuristic duplicate flag     (national id / phone / name+birthdate → flag, never block)
  → audit 'create' · emit hr.applicant.created
```

Identity is **never auto-verified** — OCR/manual data is confirmed by a human via
`POST /:id/verify-identity` (§2.1 rule 4), which supplies/re-derives the National ID, flips
`identityVerification` to `verified`, and audits the transition. Registration without an ID
is permitted (identity-unverified).

## 4. OCR seam (National ID) — real derivation, stubbed extraction

Image→text OCR depends on a capability (ADR-014) that is not built (OQ-30), so it lives
behind `NationalIdOcrProvider` with a **null stub** default: `POST /applicants/ocr/national-id`
returns `{ available: false, … }` until a real provider is registered. What *is* real: once
a 14-digit number exists (OCR or manual), birth date / gender / governorate derivation and
structural validation are deterministic (`parseNationalId`, contracts) and always applied.

## 5. Applicant data & lifecycle (Stage 1)

`ApplicantDoc` holds the §7 business-data groups (identity, contact, address, military,
education, experience, licenses, references, application context, marital). Stage-1 status
is `new` | `withdrawn` only — **nothing from Screening (Stage 2) or later exists**.
National ID is stored raw but **masked in every DTO** (`290*******0018`); the unmasked value
leaves the service only through the audited export path.

| Field | Rule |
| --- | --- |
| `code` | `APP-{YYYY}-{seq:6}`, organization-wide, yearly reset (BD-002); unique index |
| `nationalId` | unique among **live** applicants (partial index `status:new`); masked in DTOs |
| `searchName` | Arabic-normalized `fullNameAr` (+En) for fold-insensitive search (§9) |
| `identityVerification` | `unverified` at registration → `verified` only by a human, audited |
| `duplicateFlag` / `duplicateOf` | set by the heuristic probe; a first-class filter |
| `sourceId` / `intakeChannel` | source mandatory & immutable; channel ≠ source |

## 6. API

Base `/api/v1/hr` · standard envelope, pagination, error codes.

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `POST /applicants` | `applicant.create` | register (intake pipeline) |
| `GET /applicants` | `applicant.view` | filter: status, source, channel, requisition, branch, identity-verified, duplicate-only, has-attachments, date range; `search` (Arabic-normalized) |
| `GET /applicants/:id` | `applicant.view` | masked National ID |
| `PATCH /applicants/:id` | `applicant.edit` | optimistic `version`; recomputes `searchName` |
| `POST /applicants/:id/verify-identity` | `applicant.verifyIdentity` | ID gate → `verified` |
| `POST /applicants/:id/withdraw` | `applicant.edit` | terminal (Stage 1) |
| `POST /applicants/bulk` | `applicant.edit` | generic per-row-audited executor (action: `withdraw`) |
| `GET /applicants/export` | `applicant.export` | CSV, **masked by default**, **audited** (row count) |
| `POST /applicants/ocr/national-id` | `applicant.create` | OCR seam (null stub → `available:false`) |
| `POST /applicants/:id/attachments` | `applicant.edit` | multipart → `fileService.upload` (title/category/notes), count++ |
| `GET /applicants/:id/attachments` | `applicant.view` | via `fileService.list` |
| `DELETE /applicants/:id/attachments/:fileId` | `applicant.edit` | `fileService.softDelete`, count-- |
| `GET/POST/PATCH /applicant-sources` | `applicant.view` / `applicantSource.manage` | localized catalog; deactivate, never hard-delete |

Attachment **bytes** go through the platform Files service (module → platform); the module
owns the applicant-attachment relationship and maintains `attachmentCount` transactionally.
Attachment categories reuse the existing platform file-category catalog (OQ-25).

## 7. Events

`hr.applicant.created`, `hr.applicant.updated`, `hr.applicant.identityVerified`,
`hr.applicant.withdrawn` (in-process tier; `<module>.<entity>.<event>` naming, ADR-008).
Payloads carry ids + display fields, never Mongoose documents.

## 8. Numbering, search, export

- **Numbering:** an atomic module-local counter (`hr_sequences`, `findOneAndUpdate` +
  `$inc` upsert) gives gap-free, race-safe `APP-{YYYY}-{seq:6}` without a platform-wide
  sequence service (which doesn't exist yet); the unique `code` index is a second guard.
- **Search:** `normalizeArabic` folds hamza/alef/taa-marbuta/alef-maqsura variants and
  strips diacritics/tatweel; the normalized term matches the denormalized `searchName`, and
  code/National-ID/phone match raw (all regex-escaped — injection-safe).
- **Export:** masked by default (unmasking rules are open, OQ-27), row-capped
  (`APPLICANT_EXPORT_MAX_ROWS`), and **audited** (`action: 'export'`, row count) — the same
  discipline as the audit-module export.

## 9. Out of scope (Stage 1)

Any part of Stage 2 (Screening) or later · the unauthenticated public/mobile surface
(OQ-17/18) · external-platform adapters · OCR image extraction (stub only) · the Stage-0
requisition service (seam only) · applicant-facing notifications · the frontend · PII
retention/purge (OQ-16) · shared saved-filter views (OQ-28).
