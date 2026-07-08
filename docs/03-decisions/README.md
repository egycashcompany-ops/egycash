# Architecture Decision Records (ADRs)

Every significant architectural decision is recorded here: the context, the decision, the
alternatives rejected, and the consequences we accept. ADRs are **immutable** — to change a
decision, write a new ADR that supersedes the old one.

**Format:** Status · Context · Decision · Alternatives considered · Consequences.
**Numbering:** sequential, never reused.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith on a platform kernel | Proposed |
| [ADR-002](ADR-002-monorepo.md) | Monorepo with npm workspaces | Proposed |
| [ADR-003](ADR-003-layered-feature-architecture.md) | Feature-based structure with Controller → Service → Repository layers | Proposed |
| [ADR-004](ADR-004-permission-based-authorization.md) | Permission-based authorization (roles are only bundles) | Proposed |
| [ADR-005](ADR-005-mongodb-mongoose.md) | MongoDB + Mongoose with module-prefixed collections | Proposed |
| [ADR-006](ADR-006-jwt-refresh-tokens.md) | JWT access tokens + rotating refresh tokens with reuse detection | Proposed |
| [ADR-007](ADR-007-zod-validation.md) | Zod validation at every boundary; types inferred from schemas | Proposed |
| [ADR-008](ADR-008-event-bus.md) | Typed event bus + outbox for inter-module communication | Proposed |
| [ADR-009](ADR-009-bullmq-jobs.md) | BullMQ worker process for all long-running work | Proposed |
| [ADR-010](ADR-010-file-storage.md) | File metadata in MongoDB, binaries behind a StorageAdapter | Proposed |
| [ADR-011](ADR-011-workflow-engine.md) | Configurable workflow engine as data, not code | Proposed |
| [ADR-012](ADR-012-logging-audit.md) | Three log streams: audit, activity, system (Pino) | Proposed |
| [ADR-013](ADR-013-frontend-state.md) | TanStack Query for server state, Redux Toolkit for session/UI state | Proposed |
| [ADR-014](ADR-014-ocr-independent-service.md) | OCR as an independent, provider-pluggable service | Proposed |

All ADRs move to **Accepted** together with Milestone 1 approval.
