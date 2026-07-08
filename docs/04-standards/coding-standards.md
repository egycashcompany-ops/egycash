# Coding Standards

These standards are **enforced by tooling wherever possible** (ESLint, Prettier, TypeScript
strict, CI gates) and by review otherwise. "It compiles" is not the bar; "the next developer
understands it in one read" is.

## 1. Language & compiler

- **TypeScript everywhere**, `strict: true` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`. No new `.js` files.
- `any` is lint-banned (`unknown` + narrowing instead). `as` casts require a comment justifying
  why the type system can't prove it.
- ESM modules throughout; Node version pinned in `.nvmrc` and `engines`.

## 2. Layer rules (backend)

The full rules live in [Module Structure](../02-architecture/module-structure.md); the enforced core:

- **Controllers**: no business logic, no DB access, no try/catch pyramids — extract validated
  input, call one service method, map to the response envelope.
- **Services**: all business rules; receive typed input, return DTOs; no `req`/`res`; no Mongoose
  query building (that's the repository's job); emit events; record audit entries for mutations.
- **Repositories**: only place Mongoose is imported in a feature; no business decisions; return
  lean objects to services.
- **Cross-layer imports** and **cross-module imports** are blocked by `eslint-plugin-boundaries`
  configured to the folder structure. Features are imported only via their `index.ts`.

## 3. Errors

- Throw typed errors from `shared/errors`:
  `ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`, `BusinessRuleError`,
  `IntegrationError` — each with a stable `code` from the error-code catalog
  ([API Standards §5](api-standards.md)).
- The **central error handler** is the only place errors become HTTP responses. No `res.status(500)`
  scattered in features; no swallowed errors (`catch {}` is lint-banned).
- Expected business failures are errors with codes, not `null` returns that force callers to guess.

## 4. Async & data

- `async/await` only; no floating promises (`no-floating-promises` is an error).
- Multi-document consistency uses the platform `unitOfWork` (Mongo transactions) — never
  sequential writes with manual "rollback".
- All list queries paginate (BaseRepository enforces limits); unbounded `find()` is a review reject.
- All external calls (HTTP, OCR, mail) go through platform integrations with timeouts and retries;
  raw `fetch` to external hosts inside features is banned.

## 5. Naming, comments, size

- Naming rules: see [Naming Conventions](naming-conventions.md).
- Comments explain **why**, never what; TODOs carry an issue reference (`// TODO(#123): …`).
- Guidance (not dogma): functions ≲ 40 lines, files ≲ 300 lines; a service growing past that is
  usually two services.
- No dead code, no commented-out code — git history is the archive.

## 6. Frontend specifics

- Components are function components; hooks-first; no class components.
- shadcn/ui is imported **only** via `shared/ui` wrappers; Tailwind uses design tokens
  (no arbitrary hex values in features).
- All user-visible strings go through the localization layer — hard-coded UI strings (either
  language) are a review reject. Layout uses CSS logical properties (`ms-`, `me-`, `start`, `end`)
  for RTL correctness.
- Server data via TanStack Query hooks in the feature's `api/` folder only — no `fetch` in components
  ([ADR-013](../03-decisions/ADR-013-frontend-state.md)).
- Every action-triggering UI element is permission-gated with `<Can>` / `useCan()`.

## 7. Testing standards

| Level | Scope | Tooling | Requirement |
|---|---|---|---|
| Unit | Services (with repo fakes), utils, guards | Vitest | Every business rule and edge case |
| Integration | Repository + real Mongo (memory server); route → DB per feature | Vitest + supertest | Every endpoint: happy path, authZ failure, validation failure |
| E2E | Critical flows (login, applicant lifecycle) | Playwright | Per release |

- Test names state behavior: `rejects transition when user lacks applicant.approve`.
- Test data via factories (per feature), not shared fixtures that couple tests.
- CI blocks merge on: lint, typecheck, unit + integration tests, boundary rules.
- Coverage is tracked per package; new code is expected not to lower it (quality of assertions
  outranks the percentage).

## 8. Security hygiene (developer-facing)

- No secrets in code or logs; environment variables validated by Zod at boot; PII fields are
  redacted in system logs by the Pino redaction config.
- Never build Mongo queries from raw user input (repositories accept typed filters only —
  prevents operator injection).
- File uploads: validate mime + size per category; never trust client-provided names as storage keys.
- Full model: [Security Architecture](../06-security/security-architecture.md).

## 9. Tooling (single source of truth in `packages/config`)

- **Prettier** for formatting (no style debates in review), **ESLint** flat config with the
  boundary rules, **lint-staged + husky** pre-commit, **commitlint** for Conventional Commits
  ([Development Workflow](../09-guides/development-workflow.md)).
