# ECMS Platform

**Enterprise Cash Management System** — the operational platform of **EGYCASH**, a leader in
money transfer and storage services, precious-metals custody, and ATM replenishment and
maintenance.

ECMS is an **enterprise platform, not a single application**: a reusable Platform Core
(identity, authorization, organization, workflow, approvals, files, audit, notifications,
reporting, localization) with isolated business modules (HR, Fleet, Cash Transportation, ATM
Operations, Vault Management, and more) plugged in on top.

## Status

**Milestone 1 — Design Phase (awaiting review).**
The complete platform design is documented; no implementation code exists yet. Implementation
begins only after the design documents are reviewed and approved.

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
