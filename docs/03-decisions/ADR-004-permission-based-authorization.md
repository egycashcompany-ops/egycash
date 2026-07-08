# ADR-004: Permission-based authorization (roles are only bundles)

**Status:** Proposed · **Date:** 2026-07-08

## Context

Cash-management operations require fine-grained, auditable access control: who may approve an
offer differs from who may create an applicant, per branch. Pure role checks
(`if (user.role === 'hr-manager')`) hard-code organizational assumptions into code and break the
moment the org chart changes.

## Decision

- Code checks **permissions only**: `authorize('applicant.approve')`. Role names never appear in
  business code.
- Permissions follow `<resource>.<action>` with a **closed action vocabulary**
  (`view, create, edit, delete, export, print, approve, reject`, extendable via ADR).
- Permissions are **declared in code** (platform services + module manifests) and synced to the DB
  registry at boot; roles are **data** created by administrators to bundle permissions.
- Role assignments carry an optional **data scope** (`own | branch | company | all`) applied
  automatically by the repository base class.
- Effective permission sets are cached in Redis, versioned per user, invalidated on change.

## Alternatives considered

- **Role-based checks in code** — rejected: every org change becomes a code change; the exact
  anti-pattern the requirements prohibit.
- **Full ABAC / policy engine (OPA, Casbin)** — rejected for now: powerful but adds a policy
  language 20 developers must learn; our needs (permission + scope) are covered by a simpler
  model. Revisit via a new ADR if rule complexity demands it.

## Consequences

- ✅ New roles, reorganizations, per-branch responsibility splits — all admin operations, zero deploys.
- ✅ The permission registry doubles as documentation ([Permission Matrix](../06-security/permission-matrix.md)).
- ⚠️ Permission count grows with features (~8 per resource); mitigated by matrix UI grouped by
  module/resource and role templates.
