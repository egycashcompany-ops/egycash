# ECMS Platform

**Enterprise Cash Management System** — the operational platform of **EGYCASH**, a leader in
money transfer and storage services, precious-metals custody, and ATM replenishment and
maintenance.

ECMS is an **enterprise platform, not a single application**: a reusable Platform Core
(identity, authorization, organization, workflow, approvals, files, audit, notifications,
reporting, localization) with isolated business modules (HR, Fleet, Cash Transportation, ATM
Operations, Vault Management, and more) plugged in on top.

## Status

**Latest release: [v0.24.0](docs/13-releases/v0.24.0.md) — HR, complete** (2026-07-28).

The Platform Core is in place (kernel, auth, users, RBAC, organization, files, audit,
notifications, settings, scheduler), and the **HR module is delivered end to end**:

| Capability | State |
| --- | --- |
| Recruitment (7 stages, workflow engine, timeline, counters) | ✅ Released — frozen design RW1–RW17 / I1–I15 fully implemented and audited |
| Employee Management (registry, lifecycle, personnel actions) | ✅ Released |
| Leave Management (calendar, types, ledger, approvals, ESS) | ✅ Released |
| Contracts (types, versioned templates, PDF, public verification) | ✅ Released |
| Authentication & Employee Account Lifecycle | ✅ Released |
| Organization Structure (Company · Branch · Department · Section · Job Titles) | ✅ Released |

Job Positions and Job Requisitions remain **intentionally deferred**, and per
[ADR-016](docs/03-decisions/ADR-016-optional-position-requisition-linkage.md) applicants are never
required to link to either — the Talent Pool is first-class.

Beyond HR, the platform now carries Fleet, Operations, IT and — newly — **Gold Vault**, the
standalone precious-metals vault system ported in as a module: its business rules unchanged, with
branches, vault custodians and the transport crew/vehicle read from ECMS instead of kept twice
([port record](docs/12-planning/gold-module-port.md)).

The full roadmap and project index live in [ECMS-BOOK.md](ECMS-BOOK.md);
release history in [CHANGELOG.md](CHANGELOG.md).

### Quick start (development)

```bash
nvm use                # match pinned Node
npm install            # all workspaces
cp .env.example .env   # defaults work with docker-compose
docker compose up -d   # mongo (replica set) + redis + mailpit
npm run seed           # organization, roles, dev users
npm run dev            # api + worker + web
```

## Documentation

The full design lives in [`docs/`](docs/README.md):

- [Business Architecture](docs/01-business/business-architecture.md) · [Module Hierarchy](docs/01-business/module-hierarchy.md)
- [Software Architecture](docs/02-architecture/software-architecture.md) · [Platform Core](docs/02-architecture/platform-core.md) · [Folder Structure](docs/02-architecture/folder-structure.md) · [Module Structure](docs/02-architecture/module-structure.md)
- [Architecture Decision Records](docs/03-decisions/README.md)
- [Coding Standards](docs/04-standards/coding-standards.md) · [Naming Conventions](docs/04-standards/naming-conventions.md) · [API Standards](docs/04-standards/api-standards.md)
- [Database Design](docs/05-database/database-design.md) · [ER Diagrams](docs/05-database/er-diagrams.md)
- [Security Architecture](docs/06-security/security-architecture.md) · [Permission Matrix](docs/06-security/permission-matrix.md)
- [Workflow & Approval Engine](docs/07-workflows/workflow-engine.md)
- [Deployment Strategy](docs/08-operations/deployment-strategy.md)
- [Development Guide](docs/09-guides/development-guide.md) · [Development Workflow](docs/09-guides/development-workflow.md)

## Technology stack

React · TypeScript · Vite · TanStack Query · Redux Toolkit · Tailwind CSS · shadcn/ui —
Node.js · Express · MongoDB · Mongoose · Zod — Redis · BullMQ · Socket.IO · Pino —
deployed on Railway.
