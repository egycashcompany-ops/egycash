# The ECMS Book

The single entry point to the **ECMS Platform** — what it is, how it is designed, how it is
built, and where the project stands. Everything here **links to the authoritative documents**
rather than duplicating them; when this book and a linked document disagree, the linked
document wins and this book gets fixed.

---

## 1. What ECMS is

**ECMS (Enterprise Cash Management System)** is the operational backbone of **EGYCASH** —
money transfer and storage, precious-metals custody, and ATM replenishment and maintenance,
operating under strict physical-security, auditability, and regulatory constraints.

The single most important decision: **ECMS is a platform, not an application.**
A stable Platform Core (identity, authorization, organization, workflow, files, audit,
notifications, reporting) with business capabilities (HR, Fleet, Cash Transportation, ATM
Operations, …) as **plug-in modules** — the way SAP, Dynamics, Odoo, and ServiceNow are built.

- Business context and module map: [Business Architecture](docs/01-business/business-architecture.md)
- Canonical layer/module/feature hierarchy and IDs: [Module Hierarchy](docs/01-business/module-hierarchy.md)
- The business domain itself — entities, bounded contexts, relationships, vocabulary:
  [Domain Model](docs/01-domain/domain-model.md) ·
  [Bounded Contexts](docs/01-domain/bounded-contexts.md) ·
  [Entity Relationships](docs/01-domain/entity-relationships.md) ·
  [Ubiquitous Language](docs/01-domain/ubiquitous-language.md) ·
  [Business Decisions](docs/01-domain/business-decisions.md)
- Corrected operating model — **one organization, ~6 branches, branch is the primary scope**:
  [ADR-015](docs/03-decisions/ADR-015-single-organization-model.md)

## 2. How it is designed

| Concern                                                         | Authoritative document                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Architectural style, boot sequence, cross-cutting concerns      | [Software Architecture](docs/02-architecture/software-architecture.md)                                                              |
| The 17 platform services and their contracts                    | [Platform Core](docs/02-architecture/platform-core.md)                                                                              |
| Repository layout — the folder tree _is_ the architecture       | [Folder Structure](docs/02-architecture/folder-structure.md)                                                                        |
| File Management Service (API, providers, sequences)             | [files-service.md](docs/02-architecture/files-service.md)                                                                           |
| Audit & Activity Service (export, timeline, retention, signals) | [audit-service.md](docs/02-architecture/audit-service.md)                                                                           |
| What a business module is and must obey                         | [Module Structure](docs/02-architecture/module-structure.md)                                                                        |
| Every significant decision, with alternatives and consequences  | [ADR index](docs/03-decisions/README.md) (ADR-001…015, all Accepted)                                                                |
| Coding, naming, and API standards                               | [docs/04-standards](docs/04-standards/coding-standards.md)                                                                          |
| Database conventions and key schemas                            | [Database Design](docs/05-database/database-design.md)                                                                              |
| Security model (authn/authz/data protection)                    | [Security Architecture](docs/06-security/security-architecture.md)                                                                  |
| Permission catalog                                              | [Permission Matrix](docs/06-security/permission-matrix.md) · [generated inventory](docs/06-security/permission-matrix.generated.md) |
| Workflow & approval engine design                               | [Workflow Engine](docs/07-workflows/workflow-engine.md)                                                                             |
| Deployment topology, environments, CI/CD                        | [Deployment Strategy](docs/08-operations/deployment-strategy.md)                                                                    |
| Pre-implementation critical review (R1–R32 verdicts)            | [Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md)                                                         |

**Ground rules that never bend:** modules never import each other; business modules never touch
infrastructure directly; code checks permissions, never role names; every mutation is audited;
everything user-facing is bilingual (ar/en, RTL-first).

## 3. How it is built

- Day-to-day workflow, scripts, cheat sheets: [Development Guide](docs/09-guides/development-guide.md)
- Branching, commits, reviews, releases: [Development Workflow](docs/09-guides/development-workflow.md)
  — summarized for newcomers in [CONTRIBUTING.md](CONTRIBUTING.md)
- Sprint retrospectives: [docs/11-retrospectives](docs/11-retrospectives/2026-07-sprint-3.1.md)
- Sprint planning: [docs/12-planning](docs/12-planning/sprint-3.3-plan.md)
- Governance: [CODEOWNERS](.github/CODEOWNERS) · [SECURITY.md](SECURITY.md) ·
  [CHANGELOG.md](CHANGELOG.md) · [LICENSE](LICENSE)

## 4. Delivery plan & status

Delivery follows the **vertical-slice plan** (Architecture Review 01, R2): each phase builds
the platform to the depth the first module (Recruitment) needs, contracts designed to full
spec, implementations scoped.

| Phase                                            | Scope                                                                                                                                                                                                                                                                            | Proves                                           | Status                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Milestone 1**                                  | Complete platform design documentation                                                                                                                                                                                                                                           | design is reviewable                             | ✅ Approved 2026-07-08                                                                                                                                        |
| **Architecture Review 01**                       | Critical pre-implementation review (R1–R32)                                                                                                                                                                                                                                      | design survives scrutiny                         | ✅ Approved 2026-07-08                                                                                                                                        |
| **Sprint 2.1**                                   | Kernel (module registry, event bus, unit-of-work) + auth + users + rbac + organization + audit + settings, plus phase-2.1 review items (ADR-015, scheduler, TOTP 2FA, time-bound assignments, feature flags, …)                                                                  | login → permission → scoped data → audit trail   | ✅ **Completed — [PR #2](https://github.com/egycashcompany-ops/egycash/pull/2) merged 2026-07-09**                                                            |
| **Phase 2.5**                                    | Domain modeling (design-only): entity catalogs, bounded contexts, relationships, ubiquitous language                                                                                                                                                                             | shared vocabulary before further services        | ✅ **Completed — [PR #4](https://github.com/egycashcompany-ops/egycash/pull/4)/[#5](https://github.com/egycashcompany-ops/egycash/pull/5) merged 2026-07-09** |
| Phase 2.2 (as single-capability sprints, BD-006) | files → **Sprint 3.1** · sequences · notifications · localization                                                                                                                                                                                                                | document handling end-to-end                     | 🔨 In progress                                                                                                                                                |
| **Sprint 3.1 (Release 0.3)**                     | **File Management Service** — one capability (BD-006): storage providers (local/Railway/S3/MinIO/Azure), upload/versioning/archive/delete lifecycle, signed URLs, extension points (scan/OCR/thumbnails)                                                                         | generic, reusable file handling for every module | ✅ **Completed — [PR #6](https://github.com/egycashcompany-ops/egycash/pull/6) merged 2026-07-09 (v0.3.0)**                                                   |
| **Sprint 3.2 (Release v0.4.0)**                  | **Audit & Activity Service** — complete the 2.1 audit core to full ADR-012 spec: audited export, entity timeline (BD-007), retention governance, security signals ([plan](docs/12-planning/sprint-3.2-plan.md), [reference](docs/02-architecture/audit-service.md))              | compliance answers are queries                   | ✅ **Completed — [PR #10](https://github.com/egycashcompany-ops/egycash/pull/10) merged 2026-07-09 (v0.4.0)**                                                 |
| **Sprint 3.3 (Release v0.5.0)**                  | **Notifications Service** — in-app inbox + email, channel-adapter extension points (SMS/push/WhatsApp future), versioned templates, categories, quiet hours, priority levels, scheduling, idempotency, Socket.IO live push ([plan](docs/12-planning/sprint-3.3-plan.md), [reference](docs/02-architecture/notifications-service.md)) | humans learn what happened, on their channel     | ✅ **Completed — [PR #15](https://github.com/egycashcompany-ops/egycash/pull/15) merged 2026-07-09 (v0.5.0)**                                                 |
| **Sprint 4.1 (Release v0.6)**                    | **HR / Recruitment: Applicants** — first business module; Stage 1 of the seven-stage recruitment lifecycle: registration (manual + National-ID OCR + ID-less), sources catalog, public web/mobile intake, integration boundaries, documents strategy, grids/filters/bulk ([plan](docs/12-planning/sprint-4.1-plan.md)) | the first business workflow enters the platform  | ✅ **Stage 1 (Applicants) Completed — [PR #18](https://github.com/egycashcompany-ops/egycash/pull/18) merged 2026-07-10 (v0.6.0); first Layer 2 module, backend-first ([reference](docs/02-architecture/recruitment-applicants.md), [retrospective](docs/11-retrospectives/2026-07-sprint-4.1.md)). Stage 2 (Screening) and Stage 3 (Interviews) delivered below; Stages 4–7 later sprints** |
| **Sprint 4.2 (Release v0.7)**                    | **HR / Recruitment: Initial Screening** — Stage 2: one screening per applicant, Accepted/Rejected outcomes only (OQ-32), stored notes + rejection reasons; a rejection rejects the applicant (frees the live National-ID), an acceptance advances toward interviews | screening enters the pipeline                    | ✅ **Completed — [PR #20](https://github.com/egycashcompany-ops/egycash/pull/20) merged 2026-07-11 (v0.7.0)** |
| **Sprint 4.3 (Release v0.8)**                    | **HR / Recruitment: Interviews** — Stage 3: administrator-configurable stages (default two), panel scheduling, per-interviewer evaluation states (pending/submitted/skipped), reschedule/independent panel reassignment/cancel, gated pass/fail decision, Notifications integration, applicant progression | interview rounds run end-to-end                  | ✅ **Completed — [PR #21](https://github.com/egycashcompany-ops/egycash/pull/21) merged 2026-07-11 (v0.8.0); [retrospective](docs/11-retrospectives/2026-07-sprint-4.2-4.3.md)** |
| **Sprint 4.4 (Release v0.9)**                    | **HR / Recruitment: Job Offer** — Stage 4: versioned compensation package, immutable searchable offer number (`JO-{YYYY}-{seq:6}`), draft/sent/accepted/rejected/expired/withdrawn lifecycle, immutable accepted-revision snapshot, one-active-offer invariant, automatic expiration sweep, Notifications integration, full audit | the offer stage runs end-to-end                  | ✅ **Completed — [PR #23](https://github.com/egycashcompany-ops/egycash/pull/23) merged 2026-07-12 (v0.9.0); [retrospective](docs/11-retrospectives/2026-07-sprint-4.4.md)** |
| **Sprint 4.5 (Release v0.10)**                   | **HR / Recruitment: Employee Creation** — Stage 5: hire from the immutable Accepted Offer Snapshot, unique employee number (`EMP-{YYYY}-{seq:6}`), atomic transactional creation, duplicate-hire prevention (unique offer index), preserved applicant/requisition/offer references, copied employment terms, initial status + hiring date, events, notification, full audit | the applicant becomes an employee                | ✅ **Completed — [PR #25](https://github.com/egycashcompany-ops/egycash/pull/25) merged 2026-07-12 (v0.10.0); [retrospective](docs/11-retrospectives/2026-07-sprint-4.5.md)** |
| **Sprint 4.6 (Release v0.11)**                   | **HR / Recruitment: Hiring Documents** — Stage 6: admin-defined required/optional document types, PDF uploads via the Files service (original preserved, versioned replacement), stored document metadata, required-completion validation, immutable-once-completed-except-versioning, events, notification, full audit | new-hire documents are collected                 | ✅ **Completed — [PR #27](https://github.com/egycashcompany-ops/egycash/pull/27) merged 2026-07-12 (v0.11.0); [architecture review](docs/10-reviews/2026-07-architecture-review-hiring-documents.md)** |
| Sprint 2.3                                       | workflow v1 + approvals v1 (+ OCR with its first consumer)                                                                                                                                                                                                                       | recruitment pipeline runs                        | ⏳ Planned                                                                                                                                                    |
| Sprint 2.4                                       | search v1 + dashboards v1 + reports v1                                                                                                                                                                                                                                           | operational visibility                           | ⏳ Planned                                                                                                                                                    |
| Milestone 3+                                     | HR/Recruitment module, then Fleet, Cash Transportation, ATM, …                                                                                                                                                                                                                   | business value                                   | ⏳ Planned                                                                                                                                                    |

All business questions raised through Phase 2.5 are **resolved** — see the
[Business Decisions log](docs/01-domain/business-decisions.md): requisition-driven
recruitment (BD-001), organization-wide applicant numbering (BD-002), one shared Client
Registry (BD-003), multi-currency-ready EGP-first Money (BD-004), and separate cash/gold
custody entities over a shared pattern (BD-005). OQ-1 was answered earlier in ADR-015.

**Sprint sizing rule (BD-006):** every implementation sprint delivers **exactly one
capability**; the phase groupings above are roadmap structure, delivered as a series of
single-capability sprints unless combining is explicitly approved.

## 5. Quick start

```bash
nvm use                # match pinned Node
npm install            # all workspaces
cp .env.example .env   # defaults work with docker-compose
docker compose up -d   # mongo (replica set) + redis + mailpit
npm run seed           # organization, roles, dev users
npm run dev            # api + worker + web
```

Dev URLs and seeded logins: [Development Guide §2](docs/09-guides/development-guide.md).

## 6. Keeping this book honest

- Every sprint-closing PR updates §4 (status) and [CHANGELOG.md](CHANGELOG.md) in the same PR.
- Structural changes to the documentation set update §2's map.
- This book never carries design detail of its own — it points at the source of truth.
