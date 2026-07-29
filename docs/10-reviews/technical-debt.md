# Technical Debt Register

Known, accepted, deliberately-not-fixed-yet. An item lands here when it is **real**, **understood**,
and **someone decided not to act on it now** — not as a wish list. Each entry names what it costs,
what has been done to contain it, and what would trigger paying it down.

An entry that turns out to need a decision rather than a fix graduates to an ADR.

| ID | Area | Raised | Status |
|---|---|---|---|
| [TD-001](#td-001--two-publishers-emit-ten-hr-event-names-with-different-payloads) | HR events | A-2.1 (2026-07-29) | Accepted, contained |

---

## TD-001 — Two publishers emit ten HR event names with different payloads

**Raised by:** A-2.1, by the publisher-scanning test
(`apps/api/src/platform/kernel/event-publishers.spec.ts`).
**Decision:** accepted as-is. Not to be fixed as part of the Automation milestone.

### What

Ten event names have two publishers that emit **different payload shapes**:

```
hr.applicant.withdrawn
hr.interview.scheduled · started · cancelled
hr.jobOffer.created · sent · accepted · rejected · withdrawn · expired
```

The recruitment workflow engine mirrors every validated transition onto the platform bus
(`workflow-dispatcher.ts`) carrying the **transition** — `applicantId`, `applicantCode`,
`entityId`, `from`, `to`. The feature service that owns the entity emits the same name carrying
the **entity** — `offerId`, `applicantCode`, `status`, and so on.

Both are real, both are published today, and both have consumers.

### What it costs

A consumer that filters on a payload field only one publisher sends will match one cause and not
the other. For automation that reads as "the workflow fires sometimes", which is among the harder
bugs to diagnose because nothing errors — the run simply does not happen.

It also means an event name does not uniquely determine a payload shape, so a generated SDK type
for these ten names is accurate for one publisher and wrong for the other.

### Why it is not being fixed now

Unifying the shapes is a **domain** change to a working recruitment pipeline: it would touch the
workflow engine's dispatcher, every existing consumer of both shapes, and the timeline
materializer. Doing it inside the Automation milestone would mix domain refactoring with platform
implementation, expanding the blast radius of a milestone that currently changes no existing
behaviour at all.

### How it is contained

- The event catalogue marks each affected name with `alsoPublishedBy`, describing the second
  publisher's shape — so the divergence is **data**, not folklore.
- A-3's trigger validation raises a **warning** on any filter over an affected event, naming the
  problem at the moment someone writes the filter.
- `event-publishers.spec.ts` asserts `EVENT_MULTI_PUBLISHER` equals exactly the set the scanner
  computes from source. The list cannot silently grow or shrink: a new divergence fails the suite,
  and so does a fixed one.

**The Automation layer stays compatible with the event contracts as they are.** Nothing in
`modules/automation/**` assumes a unified shape.

### What would trigger paying it down

Any of:

- a recruitment change that already touches the dispatcher (do it while the file is open);
- a real automation that needs to filter one of these ten names on an entity field;
- SDK generation moving from "possible" to "shipped", where a wrong generated type stops being
  theoretical.

The likely shape of a fix is an envelope: publish the transition under a distinct
`hr.recruitment.*` name and let the entity-owning service keep the entity name, so one name means
one shape. That is an ADR-sized decision, not a refactor — hence this entry rather than a ticket.
