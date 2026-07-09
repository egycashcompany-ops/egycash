# Changelog

All notable changes to the ECMS Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow the platform-manifest semver described in
[Development Workflow §6](docs/09-guides/development-workflow.md). Each sprint-closing PR adds
its entry here in the same PR.

## [Unreleased]

- **Sprint 3.2 planning document** (`docs/12-planning/sprint-3.2-plan.md`): Audit & Activity
  Service — export, entity timelines, retention governance, security signals (docs only).
  **Plan approved 2026-07-09**; implementation awaits the explicit GO.
- **BD-007 — Timeline authorization degrades gracefully**
  (`docs/01-domain/business-decisions.md`): the timeline endpoint returns only what the
  caller is authorized to see (activity-only / audit-only / merged) instead of requiring
  both view permissions — resolves the decision flagged in the sprint plan §7.

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
