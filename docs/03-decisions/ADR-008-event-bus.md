# ADR-008: Typed event bus + outbox for inter-module communication

**Status:** Accepted · **Date:** 2026-07-08

## Context

Modules must never depend on each other, yet business processes cross modules (an applicant
becomes an employee; a hire triggers IT provisioning). We need decoupled communication that is
reliable when it matters and cheap when it doesn't — and that survives the future microservice split.

## Decision

Two delivery tiers behind one publishing API (`eventBus.emit(name, payload)`):

1. **In-process tier** — synchronous fan-out inside the API process for lightweight reactions
   (cache invalidation, live notification push). Delivery is best-effort.
2. **Reliable tier (outbox → BullMQ)** — events flagged `reliable` are written to an `outbox`
   collection **inside the emitting service's transaction**, then relayed to BullMQ. Consumers
   are idempotent (event ID dedup). This is the tier for anything with business consequences.

Conventions:

- Names: `<module>.<entity>.<event>` past tense (`hr.applicant.hired`); platform events use the
  `platform.` prefix. Constants + payload types live in `packages/contracts/events`.
- Payloads carry IDs and denormalized display fields — never live documents.
- Subscriptions are declared in module manifests (visible, reviewable wiring).

## Alternatives considered

- **Direct service calls between modules** — rejected: creates the compile-time coupling the
  architecture exists to prevent.
- **External broker now (RabbitMQ/Kafka)** — rejected: infrastructure we don't need yet; the
  outbox + BullMQ pattern gives at-least-once delivery with tools already in the stack, and swaps
  to a broker without changing emit/subscribe call sites.
- **Mongo change streams as the bus** — rejected: couples consumers to collection shapes — the
  exact coupling we forbid.

## Consequences

- ✅ Zero compile-time coupling between modules; wiring is explicit in manifests.
- ✅ At-least-once delivery with transactional emission for business-critical events.
- ⚠️ Idempotent consumers are mandatory (enforced by a consumer base class with event-ID dedup).
- ⚠️ Eventual consistency between modules — accepted and made visible in UX (e.g., timeline entries).
