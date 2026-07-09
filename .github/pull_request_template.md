## What & why

<!-- What does this PR change, and which design document / issue / sprint item drives it? -->

## Scope

- Sprint / phase: <!-- e.g. Sprint 2.2 -->
- Type: <!-- feat / fix / docs / refactor / test / chore -->

## Review checklist (Development Workflow §4)

- [ ] Layer rules respected (thin controller, logic in service, data access in repository)
- [ ] No cross-module imports; features imported via `index.ts` only
- [ ] Permissions declared + route `authorize(...)` present; frontend gated with `<Can>`
- [ ] Zod validation at every new boundary; types inferred, not duplicated
- [ ] Mutations audited; events named per convention; reliable tier where business-critical
- [ ] Tests: unit for rules, integration for endpoints (happy + authZ + validation)
- [ ] ar + en translations; RTL-safe layout
- [ ] Docs updated in this PR (permission matrix, DB design, CHANGELOG, ADR if architectural)

## Verification

<!-- Paste the local gate results: lint / typecheck / test / build -->

## Notes for reviewers

<!-- Trade-offs, deliberate simplifications, anything needing extra scrutiny -->
