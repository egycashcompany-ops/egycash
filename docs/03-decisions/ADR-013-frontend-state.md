# ADR-013: TanStack Query for server state, Redux Toolkit for session/UI state

**Status:** Proposed · **Date:** 2026-07-08

## Context

The stack includes both TanStack Query and Redux Toolkit. Without a written boundary, teams
duplicate server data into Redux, hand-roll caching, and fight staleness bugs — the classic
failure mode of large React apps.

## Decision

- **TanStack Query owns all server state**: every API read/write goes through query/mutation
  hooks defined in each feature's `api/` folder. Query keys follow a factory convention
  (`['hr','applicants','list',filters]`); invalidation rules live beside the mutations.
  Socket events (e.g., a workflow transition) trigger targeted invalidations.
- **Redux Toolkit owns global client state only**: auth session + effective permission set,
  locale and text direction, layout/UI preferences, notification badge count. Nothing in Redux
  is fetched-and-cached server data.
- **Litmus test (enforced in review):** *if it came from the API and can go stale, it belongs to
  Query; if the client owns it for the session, Redux; if one component owns it, `useState`.*
- Forms use react-hook-form + the shared Zod schemas from `packages/contracts`.

## Alternatives considered

- **Redux for everything (RTK Query)** — workable, but TanStack Query is mandated by the stack
  and superior for cache orchestration; running both query caches is the worst option — banned.
- **Query + Context only (no Redux)** — viable, but the stack mandates RTK and session/permission
  state benefits from devtools and middleware (e.g., permission-version resync).

## Consequences

- ✅ No duplicated caches, no hand-rolled staleness logic; each state item has one obvious home.
- ✅ Optimistic updates and background refetching come from Query for free.
- ⚠️ Discipline is required at review time; the litmus test above is part of the PR checklist.
