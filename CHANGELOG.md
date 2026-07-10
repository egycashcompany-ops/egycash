# Changelog

All notable changes to the ECMS Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow the platform-manifest semver described in
[Development Workflow §6](docs/09-guides/development-workflow.md). Each sprint-closing PR adds
its entry here in the same PR.

## [Unreleased]

- **Sprint 4.1 planning document** (`docs/12-planning/sprint-4.1-plan.md`): HR /
  Recruitment — Applicants (Release v0.6, first business module; docs only, no
  implementation). Business analysis of the full seven-stage recruitment lifecycle
  with an in-depth Stage 1 (Applicants) treatment: registration paths (manual,
  Egyptian National-ID OCR with confidence bands/cross-checks/failure and missing-ID
  workflows, ID-less registration), attachment rules (title + category + notes),
  admin-extensible source catalog with structured referral/agency detail, public
  web/mobile intake as a new trust boundary (pending-submission review model),
  integration domain boundaries (adapters translate, the intake pipeline decides),
  a complete business classification of applicant data (10 groups with stage gates
  and sensitivity levels), a four-population documents-ownership/lifecycle model
  (temporary → applicant → sealed hiring snapshot → employee file, reference-don't-
  copy), and grid/filter/bulk/export requirements with safety rules. Records
  **24 Open Questions (OQ-7…OQ-30)** — including whether BD-001's requisition anchor
  is the unstated stage 0, the employee-before-documents ordering conflict with the
  approved domain model, and the unbuilt-dependency sequencing (sequences service,
  approvals, OCR, external-recipient notifications, frontend grid foundation) —
  **none assumed, all awaiting business resolution before planning freezes**.

## [0.5.0] - 2026-07-09

Release v0.5.0 — Sprint 3.3: **Notifications Service**
([PR #15](https://github.com/egycashcompany-ops/egycash/pull/15); plan:
`docs/12-planning/sprint-3.3-plan.md`; reference:
`docs/02-architecture/notifications-service.md`). Planning went through two amendment
rounds ([PR #12](https://github.com/egycashcompany-ops/egycash/pull/12)/
[#13](https://github.com/egycashcompany-ops/egycash/pull/13)/
[#14](https://github.com/egycashcompany-ops/egycash/pull/14)) before being frozen —
see those PRs for the full design-decision history.

### Added

- **`notificationsService.notify()`** — the one platform-wide, in-process entry point
  (never an HTTP endpoint): synchronous, bilingual, entity-referenced in-app inbox
  creation (the delivery guarantee) plus asynchronous, queued delivery on every other
  enabled channel through a small channel-adapter registry (`inApp`/`email` built;
  SMS/push/WhatsApp interface-ready). Delivery failure on any channel never throws back
  to the caller.
- **In-app inbox** (self-scoped, no permission required): list, live unread count, mark
  one/all read (first-read-wins), archive.
- **Email delivery**: self-managed 5-attempt exponential-backoff retry; every
  delivery-status transition audited; final failure raises the reliable
  `platform.notification.deliveryFailed` event.
- **Versioned notification templates** (`notificationTemplate` CRUD, preview,
  test-send — permission-gated and audited): every edit, including deactivation,
  creates a new version; nothing is ever mutated in place.
- **Preferences**: category-level opt-in/out with a settings-driven default
  (`notifications.email.enabled`); quiet hours (server/UTC, `critical` priority
  bypasses).
- **Idempotency** (caller-supplied key + delivery-job status guard), `sendAt`
  scheduling, `expiresAt` expiration, and file-reference attachments (no binary
  handling this sprint, by design).
- **Socket.IO live push** (`notification:new`/`notification:read`), authenticated the
  same way as the HTTP API, relayed across the api/worker process split over Redis
  pub/sub (a real gap the plan's own text didn't account for — reliable-tier
  subscribers run in the worker, which has no Socket.IO server of its own).
- **Both initially-wired event subscriptions** (`platform.audit.alertRaised`,
  `platform.roleAssignment.changed`) produce real notifications end-to-end against
  idempotently-seeded built-in templates.
- Additive-only elsewhere: a new RBAC read query (`rbacService.listUserIdsWithPermission`)
  and two new settings (`notifications.email.enabled`,
  `notifications.quietHours.enabledByDefault`); no existing service's behavior changed.

### Fixed

- **Retry-after-failure was permanently stuck**: the delivery handler kept a failed
  channel at `processing` across its whole retry sequence, intending that as the
  idempotency guard for the next attempt — but the guard checks for status `queued`
  before proceeding, so every attempt after the first silently no-op'd. A channel now
  transitions back to `queued` before its next attempt is enqueued.

### Backlog (recorded for future release planning — not implemented)

1. Frontend inbox UI and Socket.IO client wiring.
2. SMS / push / WhatsApp channel adapters (interface-ready, not built).
3. Digest/scheduled-summary notifications (`digestMode` field reserved, unused) and
   recurring delivery (`sendAt` is a one-time timestamp only).
4. A quiet-hours-expiry sweep job, an admin "resend a failed delivery" action, and
   notification retention/purge.
5. The future administration console (template management, queue monitoring, failed
   deliveries, resend/retry, statistics) and a dedicated metrics backend.

## [0.4.0] - 2026-07-09

Release v0.4.0 — Sprint 3.2: **Audit & Activity Service**
([PR #10](https://github.com/egycashcompany-ops/egycash/pull/10); plan:
`docs/12-planning/sprint-3.2-plan.md`; reference: `docs/02-architecture/audit-service.md`).
Completes the Sprint 2.1 audit core to its full ADR-012 spec.

### Added

- **Audited CSV export** (`GET /platform/audit-logs/export`, `auditLog.export`): streams
  via a Mongo cursor (no full-result buffering), row-capped
  (`audit.export.maxRows`, default 50,000), field-name-based `nationalId` masking, and
  **the export itself is audited** (actor, filter, row count).
- **Entity timeline** (`GET /platform/timeline`): a merged view over the audit + activity
  streams for one entity, newest-first. Implements
  [BD-007](docs/01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully) —
  content degrades to whichever of `activityLog.view` / `auditLog.view` the caller holds
  (activity-only, audit-only, or merged); neither ⇒ audited 403.
- **Retention governance**: `platform.audit.retention` (daily) purges expired
  **activity** records in idempotent batches, settings-declared with a hard 365-day
  floor (`audit.retention.activityDays`); the audit stream keeps its structural
  no-delete guarantee.
- **Security-signal detection**: `platform.audit.securitySignals` (hourly) runs four
  detectors — repeated permission denials, lockout clusters, export spikes,
  refresh-token reuse — each raising an `alertRaised` audit record plus the reliable
  `platform.audit.alertRaised` event, deduplicated per (signal, subject, window).
- **Query hardening**: `moduleId` filter added to the audit list/export; new
  `ix_moduleId_at` / activity `ix_at` indexes.
- **Sprint 3.2 planning document** (`docs/12-planning/sprint-3.2-plan.md`, approved
  2026-07-09) and **BD-007 — Timeline authorization degrades gracefully**
  (`docs/01-domain/business-decisions.md`), resolving the decision flagged in the plan's §7.

No new permissions, no new collections (`check:permission-matrix` unchanged). Architecture
review: self-assessed in the PR, no code changes required.

### Backlog (recorded for future release planning — not implemented)

1. Replace the entity timeline's in-memory merge with a cursor-based merge if a given
   entity's history ever grows beyond current practical limits.
2. Generalize CSV export masking (`audit.export.ts`) into a reusable PII-masking framework,
   rather than the current field-name-based check.
3. Consider making the `lockoutCluster` and `refreshReuse` signal thresholds
   settings-configurable in a future release (currently fixed constants).
4. The future Notifications Service (v0.5.0) should _subscribe_ to
   `platform.audit.alertRaised` rather than introduce any direct coupling to the audit
   service.

## [0.3.0] - 2026-07-09

Release v0.3.0 — Sprint 3.1: **File Management Service**
([PR #6](https://github.com/egycashcompany-ops/egycash/pull/6), architecture review:
Implementation Approved; retrospective:
[2026-07-sprint-3.1](docs/11-retrospectives/2026-07-sprint-3.1.md)).

### Added

- **File Management Service** (platform `files`, ADR-010): storage providers behind one
  interface — Local, Railway volume, Amazon S3, MinIO (S3-compatible), Azure Blob — selected
  by `STORAGE_DRIVER`; upload/download/replace(versioning)/archive/restore/soft-delete/
  permanent-delete lifecycle; full metadata set (names, mime, extension, sha256 checksum,
  size, uploader, entity reference, category, tags); category catalog with per-category
  mime/size/retention rules; visibility-aware, per-download-audited authorization with a
  signed-URL abstraction (native presigning or app-level HMAC streaming); extension points
  for virus scanning, OCR and thumbnails with completion events; `platform.file.*` events
  on the reliable tier; unit + integration suites; API doc with sequence diagrams
  (`docs/02-architecture/files-service.md`).

## [0.2.0] - 2026-07-09

Documentation & governance wave (PRs
[#3](https://github.com/egycashcompany-ops/egycash/pull/3),
[#4](https://github.com/egycashcompany-ops/egycash/pull/4),
[#5](https://github.com/egycashcompany-ops/egycash/pull/5)). Release numbering follows the
sprint plan from here (0.x pre-GA); the `2.1.0`/`1.0.0` entries below predate this scheme.

### Added

- Project governance: `ECMS-BOOK.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`,
  `CODEOWNERS`, pull-request and issue templates, this changelog.
- **Phase 2.5 — Domain Model** (documentation only): `docs/01-domain/` — domain model,
  bounded contexts, entity relationships, and ubiquitous language for the whole platform.
- **Business Decisions log** (`docs/01-domain/business-decisions.md`): BD-001 requisition-driven
  recruitment (OQ-2), BD-002 organization-wide applicant numbering (OQ-3), BD-003 shared
  Client Registry (OQ-4), BD-004 multi-currency-ready EGP-first Money (OQ-5), BD-005
  separate cash/gold custody entities over a shared pattern (OQ-6), BD-006 one capability
  per implementation sprint — with the domain documents updated accordingly.

## [2.1.0] - 2026-07-09

Sprint 2.1 — Platform Core, phase 2.1 slice
([PR #2](https://github.com/egycashcompany-ops/egycash/pull/2), per
[Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md) R2).

### Added

- **Monorepo**: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`,
  `packages/config`); ESLint flat config with layer-boundary enforcement; Prettier;
  GitHub Actions CI (lint, typecheck, permission-matrix and flag-expiry gates, tests,
  build, audit); docker-compose dev stack (Mongo replica set, Redis, Mailpit); devcontainer.
- **`@ecms/contracts`**: Zod-first DTOs and schemas; platform permission catalog (single
  source of truth, synced to DB at boot); versioned event contracts (`schemaVersion`);
  error-code catalog; Egyptian NationalId validator/decoder and PhoneNumber normalizer;
  feature-flag declarations with expiry dates.
- **Kernel**: module registry with manifest validation (including `requiresPlatform`
  compatibility) that fails the boot loudly; typed event bus with in-process and
  outbox→BullMQ reliable tiers; `unitOfWork` transaction helper.
- **Auth**: argon2id login pipeline; 15-minute JWT access tokens; rotating refresh tokens
  with reuse detection and session-family revocation; session registry with revocation;
  settings-driven lockout and password policy; TOTP 2FA with single-use backup codes,
  enforced for privileged accounts.
- **RBAC**: code-declared permission registry; roles as data with protected system roles;
  time-bound role assignments enforced at permission-set computation; data scopes
  `own | branch | organization` applied centrally by `BaseRepository`.
- **Organization**: Organization singleton profile; Branch → Department → Section hierarchy
  with materialized paths, delete guards, managers and acting-manager delegation windows;
  Job Titles catalog.
- **Audit**: append-only audit and activity streams; queued writes with in-request fallback;
  `requestId` correlation across api → queue → worker; query endpoints; audited 403s.
- **Settings & feature flags**: declared-in-code registry; `user → branch → organization →
default` resolution with caching and change events; flags evaluated on the hierarchy.
- **Scheduler**: declared-task registry with pause/resume/run-now API; BullMQ repeatable
  executor; outbox sweep and expiring-assignments report.
- **Web scaffold**: login with TOTP step, in-memory access token with silent refresh,
  session bootstrap, `<Can>`/`useCan` permission gates, ar/en with RTL switching.
- **Tests**: 44 unit tests + integration suite proving login → permission → scoped data →
  audit trail, refresh-reuse detection, lockout, TOTP enforcement, optimistic concurrency,
  and hierarchy guards.

### Changed

- ADR-001…014 statuses Proposed → Accepted per the Milestone 1 approval log; **ADR-015**
  records the single-organization model (Review R1), superseding the multi-company aspects
  of the Milestone 1 design.
- README status lines updated to Milestone 2 / phase 2.1; generated permission-matrix
  companion added (Review R18).

## [1.0.0] - 2026-07-08

Milestone 1 — complete platform design documentation (`docs/`), approved by EGYCASH,
followed by Architecture Review 01 (pre-Milestone 2 critical review, R1–R32).

[Unreleased]: https://github.com/egycashcompany-ops/egycash/compare/main...HEAD
