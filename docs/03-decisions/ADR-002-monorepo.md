# ADR-002: Monorepo with npm workspaces

**Status:** Proposed · **Date:** 2026-07-08

## Context

The system has a backend (`api` + `worker`) and a frontend (`web`) that must share API contracts
(DTOs, Zod schemas, permission IDs, event names). Drift between backend and frontend types is a
top source of production bugs in long-lived systems.

## Decision

One repository, **npm workspaces**: `apps/api`, `apps/web`, `packages/contracts`,
`packages/config`. Shared contracts are a workspace package imported by both apps — no
publishing, no version skew.

## Alternatives considered

- **Separate repos** — rejected: contract sharing requires publishing versioned packages;
  cross-cutting changes need coordinated multi-repo PRs; CI/permissions duplication.
- **Nx / Turborepo** — deferred, not rejected: npm workspaces cover today's needs with zero extra
  tooling. Adopt Turborepo later if build times demand caching/task orchestration; the folder
  layout is already compatible.

## Consequences

- ✅ One PR changes API schema + backend + frontend atomically; reviewers see the whole change.
- ✅ `packages/contracts` makes backend/frontend drift a compile error.
- ⚠️ Repo grows large; mitigated by path-filtered CI jobs.
- ⚠️ Workspace hoisting quirks require a committed lockfile and pinned Node version (`.nvmrc`).
