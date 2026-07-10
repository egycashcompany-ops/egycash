# ECMS Platform — Documentation

**ECMS (Enterprise Cash Management System)** is an enterprise *platform*, not an application.
Business capabilities (HR, Fleet, Cash Transportation, ATM Operations, …) are **modules** that
plug into a reusable **Platform Core**. This documentation set is the single source of truth
for how the platform is designed, built, and operated.

> **Status: Milestone 2 — Platform Core implementation (phase 2.1 in progress).**
> Milestone 1 (design) is approved. Implementation follows the vertical-slice plan in
> [Architecture Review 01](10-reviews/2026-07-architecture-review-01.md) (phases 2.1–2.4).

---

## How this documentation is organized

Documents are numbered by concern. Read them in order for a full picture; each document is
also self-contained enough to be read on its own.

| # | Area | Documents | Audience |
|---|------|-----------|----------|
| 01 | **Business** | [Business Architecture](01-business/business-architecture.md) · [Module Hierarchy](01-business/module-hierarchy.md) | Everyone |
| 01 | **Domain** | [Domain Model](01-domain/domain-model.md) · [Bounded Contexts](01-domain/bounded-contexts.md) · [Entity Relationships](01-domain/entity-relationships.md) · [Ubiquitous Language](01-domain/ubiquitous-language.md) · [Business Decisions](01-domain/business-decisions.md) | Everyone |
| 02 | **Architecture** | [Software Architecture](02-architecture/software-architecture.md) · [Platform Core](02-architecture/platform-core.md) · [Folder Structure](02-architecture/folder-structure.md) · [Module Structure](02-architecture/module-structure.md) · [File Management Service](02-architecture/files-service.md) · [Audit & Activity Service](02-architecture/audit-service.md) | Engineers, Architects |
| 03 | **Decisions** | [Architecture Decision Records (ADRs)](03-decisions/README.md) | Engineers, Architects |
| 04 | **Standards** | [Coding Standards](04-standards/coding-standards.md) · [Naming Conventions](04-standards/naming-conventions.md) · [API Standards](04-standards/api-standards.md) | Engineers |
| 05 | **Database** | [Database Design](05-database/database-design.md) · [ER Diagrams](05-database/er-diagrams.md) | Engineers |
| 06 | **Security** | [Security Architecture](06-security/security-architecture.md) · [Permission Matrix](06-security/permission-matrix.md) | Engineers, Security |
| 07 | **Workflows** | [Workflow & Approval Engine](07-workflows/workflow-engine.md) | Engineers, Analysts |
| 08 | **Operations** | [Deployment Strategy](08-operations/deployment-strategy.md) | DevOps, Engineers |
| 09 | **Guides** | [Development Guide](09-guides/development-guide.md) · [Development Workflow](09-guides/development-workflow.md) | Engineers |
| 10 | **Reviews** | [Architecture Review 01 (pre-Milestone 2)](10-reviews/2026-07-architecture-review-01.md) | Everyone |
| 11 | **Retrospectives** | [Sprint 3.1 (Release v0.3.0)](11-retrospectives/2026-07-sprint-3.1.md) | Everyone |
| 12 | **Planning** | [Sprint 3.3 — Notifications Service](12-planning/sprint-3.3-plan.md) | Everyone |

---

## Documentation rules

1. **Documentation-first.** A feature or platform service is designed here *before* it is coded.
2. **ADRs are immutable.** A decision is superseded by a new ADR, never edited into something else.
3. **Diagrams as code.** All diagrams are [Mermaid](https://mermaid.js.org/) so they render on GitHub and diff in PRs.
4. **Every PR that changes behavior updates the relevant document** in the same PR.
5. **English is the documentation language.** The product UI is bilingual (Arabic / English) — see Localization in [Platform Core](02-architecture/platform-core.md).

## Review & approval log

| Document set | Version | Status | Approved by | Date |
|---|---|---|---|---|
| Milestone 1 (all documents) | 1.0.0 | ✅ Approved | EGYCASH | 2026-07-08 |
| Architecture Review 01 (pre-Milestone 2) | 1.0.0 | ✅ Approved (implementation of phases 2.1–2.4 authorized) | EGYCASH | 2026-07-08 |
| Sprint 2.1 implementation ([PR #2](https://github.com/egycashcompany-ops/egycash/pull/2)) | 2.1.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.1 — File Management Service ([PR #6](https://github.com/egycashcompany-ops/egycash/pull/6)) | 0.3.0 | ✅ Reviewed & merged (architecture review: Implementation Approved) | EGYCASH | 2026-07-09 |
| Sprint 3.1 retrospective ([PR #7](https://github.com/egycashcompany-ops/egycash/pull/7)) | — | ✅ Completed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.2 plan — Audit & Activity Service ([PR #8](https://github.com/egycashcompany-ops/egycash/pull/8)) | 1.0.0 | ✅ Approved (§7 resolved by [BD-007](01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully); implementation awaiting GO) | EGYCASH | 2026-07-09 |
| Sprint 3.2 — Audit & Activity Service ([PR #10](https://github.com/egycashcompany-ops/egycash/pull/10)) | 0.4.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.2 bookkeeping — Release v0.4.0 recorded ([PR #11](https://github.com/egycashcompany-ops/egycash/pull/11)) | — | ✅ Reviewed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.3 plan — Notifications Service ([PR #12](https://github.com/egycashcompany-ops/egycash/pull/12)) | 1.0.0 | ✅ Approved (implementation awaiting GO) | EGYCASH | 2026-07-09 |
| Sprint 3.3 plan amendment — 10 additional decisions ([PR #13](https://github.com/egycashcompany-ops/egycash/pull/13)) | 1.1.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.3 plan — 10 more decisions, planning frozen ([PR #14](https://github.com/egycashcompany-ops/egycash/pull/14)) | 1.2.0 | 🧊 **Frozen & approved — implementation GO given** | EGYCASH | 2026-07-09 |
| Sprint 3.3 — Notifications Service ([PR #15](https://github.com/egycashcompany-ops/egycash/pull/15)) | 0.5.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-09 |
| Sprint 3.3 bookkeeping — Release v0.5.0 recorded ([PR #16](https://github.com/egycashcompany-ops/egycash/pull/16)) | — | ✅ Reviewed & merged | EGYCASH | 2026-07-10 |
| Sprint 4.1 plan — HR/Recruitment: Applicants business analysis ([PR #17](https://github.com/egycashcompany-ops/egycash/pull/17)) | 1.2.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-10 |
| Sprint 4.1 plan — frozen; Stage 1 implementation GO (this PR) | 1.3.0 | 🧊 **Frozen & approved — 7 decisions (OQ-7/8/9/10/29/30/31/32); Stage 1 backend GO** | EGYCASH | 2026-07-10 |
