# Contributing to ECMS

This is the working summary of how changes reach `main`. The authoritative references are
[Development Workflow](docs/09-guides/development-workflow.md),
[Development Guide](docs/09-guides/development-guide.md), and
[Coding Standards](docs/04-standards/coding-standards.md) — when in doubt, they win.

## 1. First-time setup

```bash
git clone git@github.com:egycashcompany-ops/egycash.git
cd egycash
nvm use                     # Node version pinned in .nvmrc
npm install                 # installs all workspaces
cp .env.example .env        # defaults work with docker-compose
docker compose up -d        # mongo (replica set) + redis + mailpit
npm run seed                # platform reference data + dev users
npm run dev                 # api + worker + web concurrently
```

## 2. Branches & commits

- Branch off the integration trunk, short-lived (≤ a few days):
  `<type>/<scope>-<short-desc>` — e.g. `feat/hr-applicant-ocr`, `fix/auth-refresh-rotation`.
- **Conventional Commits** with module scope: `feat(platform/auth): …`,
  `docs(adr): …`. PRs are squash-merged, so the PR title follows the same format.
- Design before code for anything architectural (new platform service, schema change,
  new permission): documentation PR first, including an ADR when a decision is being made.

## 3. Before opening a PR

Run the same gates CI runs:

```bash
npm run lint          # ESLint incl. layer-boundary rules
npm run typecheck     # tsc strict across workspaces
npm run test:unit
npm run test:integration   # needs Docker Mongo or downloads an in-memory binary
npm run build
npm run check:permission-matrix   # regenerate with npm run gen:permission-matrix
npm run check:flag-expiry
```

Integration tests default to an in-memory MongoDB replica set. Where binary downloads are
restricted, point them at the compose stack instead:

```bash
MONGO_TEST_URI="mongodb://localhost:27017?replicaSet=rs0&directConnection=true" npm run test:integration
```

## 4. Pull requests

- Small and focused: one feature-layer slice or one concern; > ~500 changed lines should be split.
- **Docs travel with code**: a PR that changes behavior updates the relevant document in the
  same PR (permission matrix, database design, CHANGELOG, ADR if architectural).
- Fill in the [PR template](.github/pull_request_template.md) checklist — it mirrors the
  review checklist reviewers actually apply.
- One approval required; changes touching `platform/auth`, `platform/rbac`, `platform/files`,
  migrations, or CI/deploy need a second reviewer (enforced by
  [CODEOWNERS](.github/CODEOWNERS)).
- Reviews critique the code, not the author; requested changes come with reasons or
  references to the standards documents.

## 5. The rules that get PRs rejected

- Cross-module imports, cross-module `$lookup`s, or modules touching infrastructure
  directly (use platform services).
- Role names in business code — check permissions (`authorize('applicant.create')`), never roles.
- Unaudited mutations, unvalidated boundaries (Zod at every edge), unpaginated list queries.
- Hard-coded UI strings in either language; layouts that break in RTL.
- `console.*`, `any`, floating promises, `catch {}` — all lint-enforced.

## 6. Reporting issues & vulnerabilities

- Bugs and feature requests: use the [issue templates](.github/ISSUE_TEMPLATE).
- Security vulnerabilities: **never open a public issue** — follow [SECURITY.md](SECURITY.md).
