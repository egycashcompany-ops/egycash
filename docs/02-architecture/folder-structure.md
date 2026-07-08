# Folder Structure

ECMS is a **monorepo** using npm workspaces ([ADR-002](../03-decisions/ADR-002-monorepo.md)):
one repository, three deployables (`api`, `worker` entry inside api workspace, `web`), and shared
packages. The folder tree *is* the architecture — layers and modules are visible on disk, and the
dependency rules from the [Module Hierarchy](../01-business/module-hierarchy.md) are enforced
against these paths by ESLint (`eslint-plugin-boundaries`).

## 1. Repository root

```
egycash/
├── apps/
│   ├── api/                      # Backend: Express API + BullMQ worker (two entrypoints)
│   └── web/                      # Frontend: React SPA
├── packages/
│   ├── contracts/                # Shared API contracts: Zod schemas, DTO types, permission
│   │                             #   IDs, event names — imported by BOTH api and web
│   └── config/                   # Shared tooling presets: tsconfig, eslint, prettier
├── docs/                         # This documentation (see docs/README.md)
├── scripts/                      # Repo-level scripts (seed, codegen, module scaffolder)
├── .github/
│   └── workflows/                # CI pipelines (lint, typecheck, test, build, deploy)
├── .env.example                  # Documented environment variables (never commit real .env)
├── package.json                  # Workspace root
└── README.md
```

## 2. Backend — `apps/api/`

```
apps/api/
├── src/
│   ├── platform/                           # ── LAYER 1: Platform Core ──
│   │   ├── auth/
│   │   ├── users/
│   │   ├── rbac/
│   │   ├── organization/
│   │   │   ├── companies/                  # platform services with sub-features
│   │   │   ├── branches/                   #   follow the same feature shape
│   │   │   ├── departments/
│   │   │   ├── sections/
│   │   │   └── job-titles/
│   │   ├── settings/
│   │   ├── notifications/
│   │   ├── files/
│   │   ├── audit/
│   │   ├── search/
│   │   ├── workflow/
│   │   ├── approvals/
│   │   ├── dashboards/
│   │   ├── reports/
│   │   ├── sequences/
│   │   ├── localization/
│   │   ├── integrations/
│   │   ├── ai/
│   │   │   └── ocr/                        # OCR: independent service, provider pattern
│   │   └── kernel/                         # platform runtime: module registry, manifest
│   │       ├── module-registry.ts          #   loader/validator, event bus, unit-of-work,
│   │       ├── event-bus.ts                #   boot sequence
│   │       └── bootstrap.ts
│   │
│   ├── modules/                            # ── LAYER 2: Business Modules ──
│   │   ├── hr/
│   │   │   ├── hr.module.ts                # ModuleManifest for HR
│   │   │   ├── recruitment/
│   │   │   │   ├── applicants/             # ← feature (structure in §4)
│   │   │   │   ├── screening/
│   │   │   │   ├── interviews/
│   │   │   │   ├── offers/
│   │   │   │   ├── hiring/
│   │   │   │   ├── hiring-documents/
│   │   │   │   └── employee-file/
│   │   │   └── shared/                     # shared ONLY within the hr module
│   │   ├── fleet/                          # (empty placeholder until designed)
│   │   ├── cash-transport/
│   │   ├── atm/
│   │   ├── vault/
│   │   ├── gold-vault/
│   │   ├── contracts/
│   │   ├── administration/
│   │   ├── accounting/
│   │   ├── security/
│   │   └── it/
│   │
│   ├── shared/                             # ── LAYER 3: Shared Components ──
│   │   ├── errors/                         # AppError hierarchy, error codes
│   │   ├── types/                          # LocalizedString, Pagination, AuthContext, ...
│   │   ├── utils/                          # pure utilities only (no I/O)
│   │   ├── constants/
│   │   └── base/                           # BaseRepository, BaseController, BaseService
│   │
│   ├── infrastructure/                     # ── LAYER 4: Infrastructure ──
│   │   ├── database/                       # Mongo connection, transactions, migrations
│   │   ├── redis/
│   │   ├── queue/                          # BullMQ queues/workers wiring
│   │   ├── socket/                         # Socket.IO server + auth handshake
│   │   ├── storage/                        # StorageAdapter + LocalDisk/S3 implementations
│   │   ├── mail/
│   │   ├── http/                           # express app assembly, global middleware,
│   │   │                                   #   error handler, request context (AsyncLocalStorage)
│   │   └── logging/                        # Pino setup, requestId correlation
│   │
│   ├── app.ts                              # compose express app (no listen)
│   ├── server.ts                           # ENTRYPOINT: api process
│   └── worker.ts                           # ENTRYPOINT: worker process
│
├── tests/
│   ├── integration/                        # per feature, hits real Mongo (memory server)
│   └── e2e/                                # API-level flows
├── package.json
└── tsconfig.json
```

*(Unit tests live next to the code they test: `applicant.service.spec.ts` beside
`applicant.service.ts`.)*

## 3. Frontend — `apps/web/`

```
apps/web/
├── src/
│   ├── platform/                           # app shell & platform features
│   │   ├── app/                            # root: providers, router assembly, error boundary
│   │   ├── auth/                           # login page, session handling, token refresh
│   │   ├── layout/                         # shell: sidebar (from manifests), topbar, RTL
│   │   ├── rbac/                           # <Can/>, useCan(), permission-aware routing
│   │   ├── organization/
│   │   ├── settings/
│   │   ├── notifications/                  # inbox, toasts, socket subscription
│   │   ├── files/                          # uploader, file list, preview components
│   │   ├── audit/                          # timeline & audit viewers
│   │   ├── search/                         # global search UI
│   │   ├── workflow/                       # stage stepper, transition dialogs
│   │   ├── approvals/                      # approval inbox, decision UI
│   │   ├── dashboards/                     # widget grid renderer
│   │   ├── reports/                        # report runner, parameter forms, export
│   │   └── localization/                   # i18n init, locale switcher, direction provider
│   │
│   ├── modules/
│   │   └── hr/
│   │       ├── hr.module.ts                # frontend ModuleManifest (routes, nav, widgets)
│   │       └── recruitment/
│   │           ├── applicants/
│   │           │   ├── pages/              # ApplicantListPage, ApplicantDetailsPage, ...
│   │           │   ├── components/         # feature-private components
│   │           │   ├── api/                # TanStack Query hooks + api client calls
│   │           │   └── index.ts
│   │           ├── screening/ ...          # same shape per feature
│   │
│   ├── shared/
│   │   ├── ui/                             # wrapped shadcn/ui components (only import point)
│   │   ├── hooks/
│   │   ├── lib/                            # api client (fetch wrapper), query client, utils
│   │   └── types/
│   │
│   └── store/                              # Redux Toolkit: authSlice, uiSlice, localeSlice
│
├── public/
├── index.html
├── package.json
├── tailwind.config.ts
└── vite.config.ts
```

## 4. The canonical feature shape (backend)

Every feature — platform or module — looks exactly like this. The scaffolder
(`scripts/scaffold-feature`) generates it; reviews reject deviations.

```
applicants/
├── applicant.model.ts          # Mongoose schema + indexes (collection: hr_applicants)
├── applicant.repository.ts     # extends BaseRepository — data access only
├── applicant.service.ts        # business rules, transactions, events, platform calls
├── applicant.controller.ts     # thin HTTP mapping
├── applicant.validation.ts     # Zod schemas (re-exported from packages/contracts where shared)
├── applicant.routes.ts         # router: authenticate → authorize → validate → controller
├── applicant.events.ts         # typed event names + payloads this feature emits
├── applicant.service.spec.ts   # unit tests beside the code
└── index.ts                    # public surface of the feature (nothing else is importable)
```

**Import boundary:** other code may import only from a feature's `index.ts`. Deep imports
(`.../applicants/applicant.repository`) are lint-blocked — this is what keeps refactors local.

## 5. `packages/contracts` — the shared contract package

Types and validation shared between backend and frontend live in one place, so the API and the
UI can never drift apart silently:

```
packages/contracts/
└── src/
    ├── platform/                # DTOs + Zod schemas per platform service
    ├── modules/
    │   └── hr/recruitment/      # ApplicantDto, CreateApplicantSchema, ...
    ├── permissions/             # the permission ID catalog (single source of truth)
    ├── events/                  # event name constants + payload types
    └── common/                  # LocalizedString, ApiEnvelope, Pagination, enums
```

Rules: **Zod-first** — types are `z.infer<>` from schemas; no Mongoose, React, or Express
imports allowed here (pure TS + Zod only).

## 6. Why this structure (summary)

| Choice | Reason |
|---|---|
| Monorepo, npm workspaces | Atomic cross-cutting changes, one CI, shared contracts without publishing packages ([ADR-002](../03-decisions/ADR-002-monorepo.md)) |
| Layers as top-level folders | The dependency rules become path rules → machine-enforceable |
| Feature folders, identical shape | 20+ devs can navigate any feature instantly; scaffolding + review automation |
| `index.ts` public surface | Module/feature encapsulation without process boundaries |
| `contracts` package | One definition of every DTO/permission/event, consumed by both apps |
| Placeholder module folders | The module map is visible on disk from day one; adding a module never restructures the repo |
