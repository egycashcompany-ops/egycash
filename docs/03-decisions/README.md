# Architecture Decision Records (ADRs)

Every significant architectural decision is recorded here: the context, the decision, the
alternatives rejected, and the consequences we accept. ADRs are **immutable** — to change a
decision, write a new ADR that supersedes the old one.

**Format:** Status · Context · Decision · Alternatives considered · Consequences.
**Numbering:** sequential, never reused.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith on a platform kernel | Accepted |
| [ADR-002](ADR-002-monorepo.md) | Monorepo with npm workspaces | Accepted |
| [ADR-003](ADR-003-layered-feature-architecture.md) | Feature-based structure with Controller → Service → Repository layers | Accepted |
| [ADR-004](ADR-004-permission-based-authorization.md) | Permission-based authorization (roles are only bundles) | Accepted |
| [ADR-005](ADR-005-mongodb-mongoose.md) | MongoDB + Mongoose with module-prefixed collections | Accepted |
| [ADR-006](ADR-006-jwt-refresh-tokens.md) | JWT access tokens + rotating refresh tokens with reuse detection | Accepted |
| [ADR-007](ADR-007-zod-validation.md) | Zod validation at every boundary; types inferred from schemas | Accepted |
| [ADR-008](ADR-008-event-bus.md) | Typed event bus + outbox for inter-module communication | Accepted |
| [ADR-009](ADR-009-bullmq-jobs.md) | BullMQ worker process for all long-running work | Accepted |
| [ADR-010](ADR-010-file-storage.md) | File metadata in MongoDB, binaries behind a StorageAdapter | Accepted |
| [ADR-011](ADR-011-workflow-engine.md) | Configurable workflow engine as data, not code | Accepted |
| [ADR-012](ADR-012-logging-audit.md) | Three log streams: audit, activity, system (Pino) | Accepted |
| [ADR-013](ADR-013-frontend-state.md) | TanStack Query for server state, Redux Toolkit for session/UI state | Accepted |
| [ADR-014](ADR-014-ocr-independent-service.md) | OCR as an independent, provider-pluggable service | Accepted |
| [ADR-015](ADR-015-single-organization-model.md) | Single-organization, multi-branch model (Branch is the primary scope) | Accepted |
| [ADR-016](ADR-016-optional-position-requisition-linkage.md) | Job Positions & Job Requisitions are OPTIONAL for applicants (Talent Pool) | Accepted |
| [ADR-017](ADR-017-platform-identity-and-access-control.md) | Platform Identity & Organizational Access Control (hierarchical scopes, employee-linked logins, branch-based employee code) | Accepted |

ADR-001…014 were accepted with Milestone 1 approval (2026-07-08). ADR-015 records the
single-organization correction from [Architecture Review 01](../10-reviews/2026-07-architecture-review-01.md),
superseding the multi-company aspects of the Milestone 1 design. ADR-016 records the HR-Foundation
invariant that an applicant need not belong to any vacancy (the Talent Pool). ADR-017 records the
Platform-Identity foundation: hierarchical data scopes (Self→Company), employee-linked login accounts
(username-or-email), and the branch-based, globally-sequenced Employee Code.
