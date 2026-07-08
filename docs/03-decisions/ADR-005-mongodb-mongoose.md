# ADR-005: MongoDB + Mongoose with module-prefixed collections

**Status:** Proposed · **Date:** 2026-07-08

## Context

The stack mandates MongoDB + Mongoose. The architectural question is how to use a schemaless
database safely in a modular system for 10+ years: data partitioning, schema discipline,
transactions, and migrations.

## Decision

- **One database, module-prefixed collections**: platform collections unprefixed (`users`,
  `roles`), module collections prefixed (`hr_applicants`). Cross-module joins
  (`$lookup` across module boundaries) are **forbidden** — modules read foreign data via events
  (denormalized copies) or platform query contracts.
- **Schema discipline in three layers**: Zod at the API boundary, Mongoose schemas with
  `strict: true` at the data layer, and a `schemaVersion` field on every document for lazy migration.
- **Transactions**: MongoDB multi-document transactions (replica set required) wrapped by the
  platform `unitOfWork` helper; used for aggregate + sequence + audit consistency.
- **Migrations**: versioned migration scripts (`infrastructure/database/migrations`) run explicitly
  on deploy; lazy per-document migration via `schemaVersion` for large collections.
- **Indexes are code**: declared in the model file, synced deliberately on deploy (not autoIndex
  in production).

## Alternatives considered

- **Database-per-module now** — rejected: kills cross-entity transactions the platform needs
  (workflow + audit + sequence); the prefix scheme reserves the option.
- **Dropping Mongoose for the raw driver** — rejected: Mongoose's schema layer, middleware and
  typing conventions are a net win for a large team; hot paths may use the raw driver via the
  repository when profiling justifies it.

## Consequences

- ✅ Module data ownership is visible in every collection name; extraction = move prefixed collections.
- ✅ Documents self-describe their schema version; migrations are explicit and reviewable.
- ⚠️ Denormalized copies (event-carried state) must be designed per case — accepted as the price
  of module isolation.
- ⚠️ Requires a replica set even in development (docker-compose provides one) for transactions.
