# ADR-003: Feature-based structure with Controller → Service → Repository layers

**Status:** Accepted · **Date:** 2026-07-08

## Context

With 20+ future developers, the dominant costs are navigation, code review, and onboarding.
Technical-type layering (`controllers/`, `services/` as top-level folders) scatters one business
concept across the tree; unlayered feature folders devolve into fat controllers touching the DB.

## Decision

Combine both axes:

- **Feature-based folders** — everything about one aggregate lives in one folder
  (`modules/hr/recruitment/applicants/`).
- **Fixed internal layering per feature** — `routes → controller → service → repository → model`,
  plus `validation` and `events`. Controllers are thin; business logic lives in services;
  repositories are the only place Mongoose queries exist; features expose only `index.ts`.
- Base classes in `shared/base` (BaseRepository with scope filtering + pagination,
  BaseService with audit/transaction helpers) remove boilerplate without hiding logic.

## Alternatives considered

- **Type-based layering** — rejected: feature changes touch 5 distant folders; module boundaries
  become invisible.
- **Free-form feature folders** — rejected: consistency dies at team scale; reviews become style debates.
- **Full hexagonal with ports/adapters per feature** — rejected as ceremony: the repository
  interface *is* the port we need; more indirection hurts readability (KISS).

## Consequences

- ✅ "Where is X?" and "where does X go?" have one answer; scaffolder generates the shape.
- ✅ Services are unit-testable with repository fakes; repositories integration-tested against Mongo.
- ⚠️ Simple CRUD passes through layers that feel like ceremony; accepted — uniformity is worth
  more than saving one file in trivial features, and base classes keep trivial CRUD tiny.
