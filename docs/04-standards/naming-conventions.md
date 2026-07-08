# Naming Conventions

One name, one meaning, everywhere: the same business concept uses the same identifier in folders,
permissions, routes, collections, events, and UI keys.
The traceability table in [Module Hierarchy §5](../01-business/module-hierarchy.md) is the master pattern.

## 1. Files & folders

| Item | Convention | Example |
|---|---|---|
| Folders (all) | `kebab-case` | `hiring-documents/` |
| Backend feature files | `<entity>.<layer>.ts` | `applicant.service.ts`, `applicant.repository.ts` |
| Module manifest | `<module>.module.ts` | `hr.module.ts` |
| Tests | `<file>.spec.ts` beside the code | `applicant.service.spec.ts` |
| React components | `PascalCase.tsx` | `ApplicantDetailsPage.tsx` |
| Hooks | `use<Thing>.ts` | `useApplicantTimeline.ts` |
| Non-component TS (web) | `kebab-case.ts` | `query-keys.ts` |

## 2. Code identifiers (TypeScript)

| Item | Convention | Example |
|---|---|---|
| Variables, functions | `camelCase` | `effectivePermissions` |
| Classes, types, interfaces, enums | `PascalCase` (no `I` prefix) | `ApplicantService`, `AuthContext` |
| Enum members / const unions | `SCREAMING_SNAKE` for consts, string literals `kebab-case` for stored values | `status: 'in-review'` |
| Zod schemas | `PascalCase` + `Schema` | `CreateApplicantSchema` |
| Inferred types | schema name minus `Schema` | `CreateApplicant` |
| Booleans | `is/has/can` prefix | `isLocked`, `canTransition` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_UPLOAD_SIZE_MB` |

## 3. Database (MongoDB)

| Item | Convention | Example |
|---|---|---|
| Platform collections | `snake_case` plural, **no prefix** | `users`, `audit_logs` |
| Module collections | `<moduleId>_<entity>` snake_case plural | `hr_applicants`, `hr_interviews` |
| Fields | `camelCase` | `nationalId`, `createdAt` |
| Foreign keys | `<entity>Id` | `companyId`, `applicantId` |
| Localized fields | `LocalizedString` object | `name: { ar, en }` |
| Standard metadata (every collection) | `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `schemaVersion`, and where scoped: `companyId`, `branchId` | — |
| Indexes | named `ix_<fields>` / `ux_` for unique | `ux_nationalId_companyId` |

## 4. API

| Item | Convention | Example |
|---|---|---|
| Base path | `/api/v1` | — |
| Module routes | `/api/v1/<moduleId>/<resource-plural>` | `/api/v1/hr/applicants` |
| Platform routes | `/api/v1/platform/<service>/…` (auth shortcuts allowed: `/api/v1/auth/login`) | `/api/v1/platform/files` |
| Path style | `kebab-case`, plural resources, no verbs | `/hiring-documents` |
| Actions beyond CRUD | sub-resource POST | `POST /applicants/:id/transitions`, `POST /offers/:id/approval-decisions` |
| Query params | `camelCase` | `?branchId=…&sortBy=createdAt` |
| Headers | standard + `X-Request-Id`, `Idempotency-Key` | — |

## 5. Permissions

`<resource>.<action>` — resource singular `camelCase`, action from the closed vocabulary
(`view, create, edit, delete, export, print, approve, reject`; see
[Permission Matrix](../06-security/permission-matrix.md)).
Examples: `applicant.create`, `workflowDefinition.edit`.

## 6. Events

`<moduleId>.<entity>.<pastTenseEvent>` — `hr.applicant.created`, `hr.applicant.hired`,
`platform.approval.completed`. Constants live in `packages/contracts/events`; string literals at
call sites are lint-banned.

## 7. Queues & jobs

| Item | Convention | Example |
|---|---|---|
| Queue | domain noun | `ocr`, `notifications`, `reports` |
| Job name | `<queue>.<verb-noun>` | `ocr.extract-document`, `reports.generate-pdf` |

## 8. Localization keys

`<moduleId>.<feature>.<area>.<key>` — `hr.applicants.list.title`, `platform.auth.login.submit`.
Namespaces map 1:1 to translation catalogs shipped per module.

## 9. Git

| Item | Convention | Example |
|---|---|---|
| Branches | `<type>/<scope>-<short-desc>` | `feat/hr-applicant-ocr`, `fix/auth-refresh-rotation` |
| Commits | Conventional Commits with module scope | `feat(hr/applicants): add national ID OCR prefill` |
| See | [Development Workflow](../09-guides/development-workflow.md) | — |

## 10. Environment variables

`SCREAMING_SNAKE_CASE`, grouped by prefix: `MONGO_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`JWT_ACCESS_TTL`, `STORAGE_DRIVER`, `OCR_PROVIDER`. Every variable is declared, typed, and
defaulted in the boot-time Zod env schema and documented in `.env.example`.
