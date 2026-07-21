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
| 02 | **Architecture** | [Software Architecture](02-architecture/software-architecture.md) · [Platform Core](02-architecture/platform-core.md) · [Folder Structure](02-architecture/folder-structure.md) · [Module Structure](02-architecture/module-structure.md) · [File Management Service](02-architecture/files-service.md) · [Audit & Activity Service](02-architecture/audit-service.md) · [Recruitment — Applicants (backend)](02-architecture/recruitment-applicants.md) · [Recruitment — Frontend Foundation](02-architecture/recruitment-frontend.md) | Engineers, Architects |
| 03 | **Decisions** | [Architecture Decision Records (ADRs)](03-decisions/README.md) | Engineers, Architects |
| 04 | **Standards** | [Coding Standards](04-standards/coding-standards.md) · [Naming Conventions](04-standards/naming-conventions.md) · [API Standards](04-standards/api-standards.md) | Engineers |
| 05 | **Database** | [Database Design](05-database/database-design.md) · [ER Diagrams](05-database/er-diagrams.md) | Engineers |
| 06 | **Security** | [Security Architecture](06-security/security-architecture.md) · [Permission Matrix](06-security/permission-matrix.md) | Engineers, Security |
| 07 | **Workflows** | [Workflow & Approval Engine](07-workflows/workflow-engine.md) | Engineers, Analysts |
| 08 | **Operations** | [Deployment Strategy](08-operations/deployment-strategy.md) | DevOps, Engineers |
| 09 | **Guides** | [Development Guide](09-guides/development-guide.md) · [Development Workflow](09-guides/development-workflow.md) | Engineers |
| 10 | **Reviews** | [Architecture Review 01 (pre-Milestone 2)](10-reviews/2026-07-architecture-review-01.md) · [Hiring Documents (Stage 6)](10-reviews/2026-07-architecture-review-hiring-documents.md) · [Electronic Employee File (Stage 7)](10-reviews/2026-07-architecture-review-employee-file.md) | Everyone |
| 11 | **Retrospectives** | [Sprint 3.1 (Release v0.3.0)](11-retrospectives/2026-07-sprint-3.1.md) · [Sprint 4.1 (Release v0.6.0)](11-retrospectives/2026-07-sprint-4.1.md) · [Sprint 4.2–4.3 (Releases v0.7.0/v0.8.0)](11-retrospectives/2026-07-sprint-4.2-4.3.md) · [Sprint 4.4 (Release v0.9.0)](11-retrospectives/2026-07-sprint-4.4.md) · [Sprint 4.5 (Release v0.10.0)](11-retrospectives/2026-07-sprint-4.5.md) · [Sprint 5.1 — Recruitment Frontend (Release v0.13.0)](11-retrospectives/2026-07-sprint-5.1-recruitment-frontend.md) · [Sprint 5.2 — Applicants Frontend (Release v0.14.0)](11-retrospectives/2026-07-sprint-5.2-applicants-frontend.md) · [Sprint 5.3 — Screening Frontend (Release v0.15.0)](11-retrospectives/2026-07-sprint-5.3-screening-frontend.md) · [Sprint 5.4 — Interviews Frontend + TOTP dev-login fix (Release v0.16.0)](11-retrospectives/2026-07-sprint-5.4-interviews-frontend.md) · [Sprint 5.5 — Job Offer Frontend (Release v0.17.0)](11-retrospectives/2026-07-sprint-5.5-job-offer-frontend.md) · [Sprint 5.6 — Employees Frontend (Release v0.18.0)](11-retrospectives/2026-07-sprint-5.6-employees-frontend.md) · [Sprint 5.7 — Hiring Documents Frontend (Release v0.19.0)](11-retrospectives/2026-07-sprint-5.7-hiring-documents-frontend.md) · [Sprint 5.8 — Electronic Employee File Frontend (Release v0.20.0)](11-retrospectives/2026-07-sprint-5.8-employee-file-frontend.md) · [Sprint 5.9 — Applicants Intake + Reusable National-ID OCR (Release v0.21.0)](11-retrospectives/2026-07-sprint-5.9-applicants-intake-ocr.md) | Everyone |
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
| Sprint 4.1 plan — frozen; Stage 1 implementation GO ([PR #18](https://github.com/egycashcompany-ops/egycash/pull/18)) | 1.3.0 | 🧊 **Frozen & approved — 8 decisions (OQ-7/8/9/10/29/30/31/32); Stage 1 backend GO** | EGYCASH | 2026-07-10 |
| Sprint 4.1 — HR/Recruitment: Applicants Stage 1 ([PR #18](https://github.com/egycashcompany-ops/egycash/pull/18)) | 0.6.0 | ✅ Reviewed & merged (business + architecture review: no blocking issues) | EGYCASH | 2026-07-10 |
| Sprint 4.1 retrospective + Release v0.6.0 recorded ([PR #19](https://github.com/egycashcompany-ops/egycash/pull/19)) | — | ✅ Completed & merged | EGYCASH | 2026-07-11 |
| Sprint 4.2 — HR/Recruitment: Initial Screening Stage 2 ([PR #20](https://github.com/egycashcompany-ops/egycash/pull/20)) | 0.7.0 | ✅ Reviewed & merged (business + architecture review: no blocking issues) | EGYCASH | 2026-07-11 |
| Sprint 4.3 — HR/Recruitment: Interviews Stage 3 ([PR #21](https://github.com/egycashcompany-ops/egycash/pull/21)) | 0.8.0 | ✅ Reviewed & merged (two review improvements — decoupled panel reassignment, gated decision — folded in before merge) | EGYCASH | 2026-07-11 |
| Sprint 4.2–4.3 retrospective + Releases v0.7.0/v0.8.0 recorded ([PR #22](https://github.com/egycashcompany-ops/egycash/pull/22)) | — | ✅ Completed & merged | EGYCASH | 2026-07-11 |
| Sprint 4.4 — HR/Recruitment: Job Offer Stage 4 ([PR #23](https://github.com/egycashcompany-ops/egycash/pull/23)) | 0.9.0 | ✅ Reviewed & merged (two blocking items — offer number, immutable accepted snapshot — implemented before merge) | EGYCASH | 2026-07-12 |
| Sprint 4.4 retrospective + Release v0.9.0 recorded ([PR #24](https://github.com/egycashcompany-ops/egycash/pull/24)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 4.5 — HR/Recruitment: Employee Creation Stage 5 ([PR #25](https://github.com/egycashcompany-ops/egycash/pull/25)) | 0.10.0 | ✅ Reviewed & merged (business + architecture review: no blocking issues) | EGYCASH | 2026-07-12 |
| Sprint 4.5 retrospective + Release v0.10.0 recorded ([PR #26](https://github.com/egycashcompany-ops/egycash/pull/26)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 4.6 — HR/Recruitment: Hiring Documents Stage 6 ([PR #27](https://github.com/egycashcompany-ops/egycash/pull/27)) | 0.11.0 | ✅ Reviewed & merged (self-conducted [architecture review](10-reviews/2026-07-architecture-review-hiring-documents.md); no Critical/High findings — HD-01 mitigation applied in-PR) | EGYCASH | 2026-07-12 |
| Architecture Review — Hiring Documents (Stage 6) | 1.0.0 | ✅ Completed (18 findings; approvable, no Critical/High) | EGYCASH | 2026-07-12 |
| Sprint 4.6 close-out — Release v0.11.0 recorded ([PR #28](https://github.com/egycashcompany-ops/egycash/pull/28)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 4.7 — HR/Recruitment: Electronic Employee File Stage 7 ([PR #29](https://github.com/egycashcompany-ops/egycash/pull/29)) | 0.12.0 | ✅ Reviewed & merged (self-conducted [architecture review](10-reviews/2026-07-architecture-review-employee-file.md); no Critical/High findings — all documented, no in-PR code change) | EGYCASH | 2026-07-12 |
| Architecture Review — Electronic Employee File (Stage 7) | 1.0.0 | ✅ Completed (18 findings; approvable, no Critical/High) | EGYCASH | 2026-07-12 |
| Sprint 4.7 close-out — Release v0.12.0 recorded ([PR #30](https://github.com/egycashcompany-ops/egycash/pull/30)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 5.1 — HR/Recruitment: Frontend Foundation Phase 1 ([PR #31](https://github.com/egycashcompany-ops/egycash/pull/31)) | 0.13.0 | ✅ Reviewed & merged (aligns with architecture; no blocking comments; two backlog notes) | EGYCASH | 2026-07-12 |
| Sprint 5.1 retrospective — Recruitment Frontend Foundation | — | ✅ Completed | EGYCASH | 2026-07-12 |
| Sprint 5.1 close-out — Release v0.13.0 recorded ([PR #32](https://github.com/egycashcompany-ops/egycash/pull/32)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 5.2 — HR/Recruitment: Applicants Frontend Phase 2 ([PR #33](https://github.com/egycashcompany-ops/egycash/pull/33)) | 0.14.0 | ✅ Reviewed & merged (two review changes — URL-synced list state, placeholder reference controls — folded in before merge) | EGYCASH | 2026-07-12 |
| Sprint 5.2 retrospective — Applicants Frontend | — | ✅ Completed | EGYCASH | 2026-07-12 |
| Sprint 5.2 close-out — Release v0.14.0 recorded ([PR #34](https://github.com/egycashcompany-ops/egycash/pull/34)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 5.3 — HR/Recruitment: Initial Screening Frontend Phase 3 ([PR #35](https://github.com/egycashcompany-ops/egycash/pull/35)) | 0.15.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-12 |
| Sprint 5.3 retrospective — Screening Frontend | — | ✅ Completed | EGYCASH | 2026-07-12 |
| Sprint 5.3 close-out — Release v0.15.0 recorded ([PR #36](https://github.com/egycashcompany-ops/egycash/pull/36)) | — | ✅ Completed & merged | EGYCASH | 2026-07-12 |
| Sprint 5.4 — HR/Recruitment: Interviews Frontend Phase 4 ([PR #37](https://github.com/egycashcompany-ops/egycash/pull/37)) | 0.16.0 | ✅ Reviewed & merged (one quality-review pass — tightened cache invalidation — folded in before merge) | EGYCASH | 2026-07-13 |
| Auth: scannable QR for TOTP enrollment ([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38)) | 0.16.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-13 |
| Fix: dev-login TOTP seed enforcement + login regression test ([PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)) | 0.16.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.4 retrospective — Interviews Frontend + TOTP dev-login fix | — | ✅ Completed | EGYCASH | 2026-07-13 |
| Sprint 5.4 close-out — Release v0.16.0 recorded ([PR #40](https://github.com/egycashcompany-ops/egycash/pull/40)) | — | ✅ Completed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.5 — HR/Recruitment: Job Offer Frontend Phase 5 ([PR #41](https://github.com/egycashcompany-ops/egycash/pull/41)) | 0.17.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.5 retrospective — Job Offer Frontend | — | ✅ Completed | EGYCASH | 2026-07-13 |
| Sprint 5.5 close-out — Release v0.17.0 recorded ([PR #42](https://github.com/egycashcompany-ops/egycash/pull/42)) | — | ✅ Completed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.6 — HR/Recruitment: Employees Frontend Phase 6 ([PR #43](https://github.com/egycashcompany-ops/egycash/pull/43)) | 0.18.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.6 retrospective — Employees Frontend | — | ✅ Completed | EGYCASH | 2026-07-13 |
| Sprint 5.6 close-out — Release v0.18.0 recorded ([PR #44](https://github.com/egycashcompany-ops/egycash/pull/44)) | — | ✅ Completed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.7 — HR/Recruitment: Hiring Documents Frontend Phase 7 ([PR #45](https://github.com/egycashcompany-ops/egycash/pull/45)) | 0.19.0 | ✅ Reviewed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.7 retrospective — Hiring Documents Frontend | — | ✅ Completed | EGYCASH | 2026-07-13 |
| Sprint 5.7 close-out — Release v0.19.0 recorded ([PR #46](https://github.com/egycashcompany-ops/egycash/pull/46)) | — | ✅ Completed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.8 — HR/Recruitment: Electronic Employee File Frontend Phase 8 ([PR #47](https://github.com/egycashcompany-ops/egycash/pull/47)) | 0.20.0 | ✅ Reviewed & merged (final recruitment stage; comprehensive module completion review conducted before merge — no blocking findings) | EGYCASH | 2026-07-13 |
| Sprint 5.8 retrospective — Electronic Employee File Frontend (Recruitment module complete) | — | ✅ Completed | EGYCASH | 2026-07-13 |
| Sprint 5.8 close-out — Release v0.20.0 recorded ([PR #48](https://github.com/egycashcompany-ops/egycash/pull/48)) | — | ✅ Completed & merged | EGYCASH | 2026-07-13 |
| Sprint 5.9 — HR/Recruitment: Applicants intake improvements + reusable National-ID OCR ([PR #49](https://github.com/egycashcompany-ops/egycash/pull/49)) | 0.21.0 | ✅ Reviewed & merged (first polish sprint on the completed module; direct intake + dedicated reusable OCR review flow) | EGYCASH | 2026-07-21 |
| Sprint 5.9 retrospective — Applicants Intake + Reusable National-ID OCR | — | ✅ Completed | EGYCASH | 2026-07-21 |
| Sprint 5.9 close-out — Release v0.21.0 recorded (this PR) | — | 🔍 Under review | — | 2026-07-21 |
