# ADR-001: Modular monolith on a platform kernel

**Status:** Accepted · **Date:** 2026-07-08

## Context

ECMS must serve 11+ business modules over a 10+ year lifespan with a team growing to 20+
developers. The requirements demand strict module isolation and a future option to split into
microservices — but the team starts small, and cash-management operations need one coherent,
transactional, auditable system *now*.

## Decision

Build a **modular monolith**: one API deployable, one worker deployable, one web deployable —
with **microservice-grade boundaries enforced inside the process**:

- Modules interact only via the platform event bus and registered contracts.
- Data is partitioned per module (collection prefixes, no cross-module joins).
- All infrastructure access is mediated by Platform Core services.
- Boundaries are enforced by ESLint rules and manifest validation at boot, not by convention alone.

## Alternatives considered

- **Microservices from day one** — rejected: operational cost (service discovery, distributed
  tracing, data consistency, N deploy pipelines) is unjustifiable for the initial team size, and
  wrong service boundaries chosen early are the most expensive mistake in distributed systems.
- **Classic layered monolith (no module boundaries)** — rejected: guarantees a big ball of mud
  at 20 developers; makes future extraction a rewrite.

## Consequences

- ✅ One transaction context, simple local development, one deployment pipeline.
- ✅ Extraction path is mechanical: bus → broker, contracts → HTTP, prefixed collections → own DB.
- ⚠️ Boundary discipline must be *enforced by tooling* — human convention will not survive team growth.
- ⚠️ A single runaway module can affect process health until extracted; mitigated by queue-first
  design for heavy work (ADR-009).
