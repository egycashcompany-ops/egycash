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
  [Ubiquitous Language](docs/01-domain/ubiquitous-language.md)
- Corrected operating model — **one organization, ~6 branches, branch is the primary scope**:
  [ADR-015](docs/03-decisions/ADR-015-single-organization-model.md)

## 2. How it is designed

| Concern                                                        | Authoritative document                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Architectural style, boot sequence, cross-cutting concerns     | [Software Architecture](docs/02-architecture/software-architecture.md)                                                              |
| The 17 platform services and their contracts                   | [Platform Core](docs/02-architecture/platform-core.md)                                                                              |
| Repository layout — the folder tree _is_ the architecture      | [Folder Structure](docs/02-architecture/folder-structure.md)                                                                        |
| What a business module is and must obey                        | [Module Structure](docs/02-architecture/module-structure.md)                                                                        |
| Every significant decision, with alternatives and consequences | [ADR index](docs/03-decisions/README.md) (ADR-001…015, all Accepted)                                                                |
| Coding, naming, and API standards                              | [docs/04-standards](docs/04-standards/coding-standards.md)                                                                          |
| Database conventions and key schemas                           | [Database Design](docs/05-database/database-design.md)                                                                              |
| Security model (authn/authz/data protection)                   | [Security Architecture](docs/06-security/security-architecture.md)                                                                  |
| Permission catalog                                             | [Permission Matrix](docs/06-security/permission-matrix.md) · [generated inventory](docs/06-security/permission-matrix.generated.md) |
| Workflow & approval engine design                              | [Workflow Engine](docs/07-workflows/workflow-engine.md)                                                                             |
| Deployment topology, environments, CI/CD                       | [Deployment Strategy](docs/08-operations/deployment-strategy.md)                                                                    |
| Pre-implementation critical review (R1–R32 verdicts)           | [Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md)                                                         |

**Ground rules that never bend:** modules never import each other; business modules never touch
infrastructure directly; code checks permissions, never role names; every mutation is audited;
everything user-facing is bilingual (ar/en, RTL-first).

## 3. How it is built

- Day-to-day workflow, scripts, cheat sheets: [Development Guide](docs/09-guides/development-guide.md)
- Branching, commits, reviews, releases: [Development Workflow](docs/09-guides/development-workflow.md)
  — summarized for newcomers in [CONTRIBUTING.md](CONTRIBUTING.md)
- Governance: [CODEOWNERS](.github/CODEOWNERS) · [SECURITY.md](SECURITY.md) ·
  [CHANGELOG.md](CHANGELOG.md) · [LICENSE](LICENSE)

## 4. Delivery plan & status

Delivery follows the **vertical-slice plan** (Architecture Review 01, R2): each phase builds
the platform to the depth the first module (Recruitment) needs, contracts designed to full
spec, implementations scoped.

| Phase                      | Scope                                                                                                                                                                                                           | Proves                                         | Status                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Milestone 1**            | Complete platform design documentation                                                                                                                                                                          | design is reviewable                           | ✅ Approved 2026-07-08                                                                             |
| **Architecture Review 01** | Critical pre-implementation review (R1–R32)                                                                                                                                                                     | design survives scrutiny                       | ✅ Approved 2026-07-08                                                                             |
| **Sprint 2.1**             | Kernel (module registry, event bus, unit-of-work) + auth + users + rbac + organization + audit + settings, plus phase-2.1 review items (ADR-015, scheduler, TOTP 2FA, time-bound assignments, feature flags, …) | login → permission → scoped data → audit trail | ✅ **Completed — [PR #2](https://github.com/egycashcompany-ops/egycash/pull/2) merged 2026-07-09** |
| **Phase 2.5**              | Domain modeling (design-only): entity catalogs, bounded contexts, relationships, ubiquitous language                                                                                                            | shared vocabulary before further services      | 🔍 In review                                                                                       |
| Sprint 2.2                 | files + sequences + notifications (in-app + email) + localization                                                                                                                                               | document handling end-to-end                   | ⏳ Not started (awaiting approval to begin)                                                        |
| Sprint 2.3                 | workflow v1 + approvals v1 (+ OCR with its first consumer)                                                                                                                                                      | recruitment pipeline runs                      | ⏳ Planned                                                                                         |
| Sprint 2.4                 | search v1 + dashboards v1 + reports v1                                                                                                                                                                          | operational visibility                         | ⏳ Planned                                                                                         |
| Milestone 3+               | HR/Recruitment module, then Fleet, Cash Transportation, ATM, …                                                                                                                                                  | business value                                 | ⏳ Planned                                                                                         |

Open business questions blocking later phases: **OQ-2** (requisition-driven recruitment?) before
phase 2.3 detail design; **OQ-3** (branch- vs organization-scoped applicant numbering) before
phase 2.2 sequence seeds. OQ-1 was answered _departments belong to branches_ in ADR-015.

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
