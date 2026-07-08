# ECMS Platform — Documentation

**ECMS (Enterprise Cash Management System)** is an enterprise *platform*, not an application.
Business capabilities (HR, Fleet, Cash Transportation, ATM Operations, …) are **modules** that
plug into a reusable **Platform Core**. This documentation set is the single source of truth
for how the platform is designed, built, and operated.

> **Status: Milestone 1 — Design Phase.**
> No implementation code exists yet. Every document below must be reviewed and approved
> before implementation starts.

---

## How this documentation is organized

Documents are numbered by concern. Read them in order for a full picture; each document is
also self-contained enough to be read on its own.

| # | Area | Documents | Audience |
|---|------|-----------|----------|
| 01 | **Business** | [Business Architecture](01-business/business-architecture.md) · [Module Hierarchy](01-business/module-hierarchy.md) | Everyone |
| 02 | **Architecture** | [Software Architecture](02-architecture/software-architecture.md) · [Platform Core](02-architecture/platform-core.md) · [Folder Structure](02-architecture/folder-structure.md) · [Module Structure](02-architecture/module-structure.md) | Engineers, Architects |
| 03 | **Decisions** | [Architecture Decision Records (ADRs)](03-decisions/README.md) | Engineers, Architects |
| 04 | **Standards** | [Coding Standards](04-standards/coding-standards.md) · [Naming Conventions](04-standards/naming-conventions.md) · [API Standards](04-standards/api-standards.md) | Engineers |
| 05 | **Database** | [Database Design](05-database/database-design.md) · [ER Diagrams](05-database/er-diagrams.md) | Engineers |
| 06 | **Security** | [Security Architecture](06-security/security-architecture.md) · [Permission Matrix](06-security/permission-matrix.md) | Engineers, Security |
| 07 | **Workflows** | [Workflow & Approval Engine](07-workflows/workflow-engine.md) | Engineers, Analysts |
| 08 | **Operations** | [Deployment Strategy](08-operations/deployment-strategy.md) | DevOps, Engineers |
| 09 | **Guides** | [Development Guide](09-guides/development-guide.md) · [Development Workflow](09-guides/development-workflow.md) | Engineers |

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
| Milestone 1 (all documents) | 1.0.0-draft | ⏳ Awaiting review | — | — |
