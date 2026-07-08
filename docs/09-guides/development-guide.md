# Development Guide

How to work on ECMS day to day. Prerequisite reading:
[Software Architecture](../02-architecture/software-architecture.md) ·
[Folder Structure](../02-architecture/folder-structure.md) ·
[Coding Standards](../04-standards/coding-standards.md).

## 1. Prerequisites

- Node.js (version pinned in `.nvmrc`), npm ≥ 10
- Docker + Docker Compose (local MongoDB **replica set** + Redis)
- Git configured with your work identity

## 2. First-time setup

```bash
git clone git@github.com:egycashcompany-ops/egycash.git
cd egycash
nvm use                     # match pinned Node
npm install                 # installs all workspaces
cp .env.example .env        # fill in local values (defaults work with docker-compose)
docker compose up -d        # mongo (replica set) + redis
npm run seed                # platform reference data + dev users + demo module data
npm run dev                 # api + worker + web concurrently
```

Dev URLs: web `http://localhost:5173` · api `http://localhost:3000/api/v1` ·
API docs `http://localhost:3000/api/docs`.
Seeded logins (dev only): `admin@ecms.local` (Super Admin), `hr@ecms.local` (HR Manager) —
passwords in `.env.example`.

## 3. Everyday scripts (workspace root)

| Script | Does |
|---|---|
| `npm run dev` | api + worker + web with hot reload |
| `npm run lint` / `lint:fix` | ESLint incl. boundary rules |
| `npm run typecheck` | `tsc --noEmit` across workspaces |
| `npm run test` / `test:integration` | Vitest suites |
| `npm run build` | build all workspaces |
| `npm run seed` | reseed local DB |
| `npm run scaffold:feature -- hr/recruitment/offers` | generate the canonical feature shape |
| `npm run scaffold:module -- fleet` | generate a module skeleton + manifest |

## 4. Adding a feature (the golden path)

1. **Docs first**: add/extend the feature's design in `docs/` (entities, permissions, API,
   workflow touchpoints). Get it reviewed.
2. **Contracts**: add Zod schemas + DTOs + permission keys + event names to `packages/contracts`.
3. **Scaffold**: `npm run scaffold:feature -- <module>/<sub-module>/<feature>`.
4. **Model → Repository → Service → Controller → Routes** (in that order; tests alongside —
   see the layer contracts in [Software Architecture §3](../02-architecture/software-architecture.md)).
5. **Register** in the module manifest: permissions, routes, nav, workflow/sequence/searchable
   declarations as needed.
6. **Frontend**: `api/` hooks from contracts, pages, components; permission-gate every action;
   add translations (ar + en).
7. **Verify**: lint, typecheck, tests, manual pass in dev; update the permission matrix and
   database design docs if they changed.

## 5. Adding a module

1. Design doc under `docs/` (business architecture addition + module design) — reviewed first.
2. `npm run scaffold:module -- <module-id>` → folder + manifest + registration line.
3. Build features per §4. The kernel wires permissions, nav, workflows, and search from the
   manifest — no platform code changes.

## 6. Working with platform services (cheat sheet)

| Need | Use | Never |
|---|---|---|
| Store/attach a file | `files` service API | Multer directly in a feature, raw fs |
| Notify someone | `notifications.notify(...)` | Socket.IO/SMTP directly |
| Number a document | `sequences.next('hr.applicant', scope)` | Manual counters |
| Status/stage logic | `workflow` engine + instance state | Status enums in module code |
| Approvals | `approvals` chains via workflow or direct | Ad-hoc "approvedBy" fields |
| React to other modules | Event subscription in manifest | Importing their code |
| Record history | Service-layer `audit.record` (auto for base CRUD) | Mongoose hooks, manual logs |
| Read org/settings | Cached org/settings services | Direct collection reads |

## 7. Testing expectations

Defined in [Coding Standards §7](../04-standards/coding-standards.md): unit tests for every
business rule, integration tests for every endpoint (happy + authZ + validation paths),
E2E for critical flows. CI blocks merges on all of them.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Boot fails with manifest validation error | Permission naming / collection prefix / route prefix violation — the error names the module and rule |
| Boot fails with env schema error | Missing/invalid `.env` value — the report lists exact keys |
| Transactions fail locally | Mongo not running as replica set — use the provided docker-compose |
| 403 on a new endpoint | Permission not declared in manifest, or your dev user's role lacks it — check `/api/docs` for the declared permission |
| Lint "boundaries" error | You imported across a layer/module boundary — see the dependency table in [Module Hierarchy](../01-business/module-hierarchy.md) |
