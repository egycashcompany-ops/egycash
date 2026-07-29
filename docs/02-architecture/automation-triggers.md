# Automation Triggers — a published event becomes runs

**Layer 2 · `apps/api/src/modules/automation/triggers/` + `executions/`** · delivered by **A-5** ·
behind `AUTOMATION_ENABLED`

The bridge between "a business thing happened" and "an automation runs". A module emits
`hr.employee.created` inside its transaction exactly as it always has; this bridge, **downstream of
that commit**, decides which workflows the event fires and starts them.

## Automation is an ordinary event consumer

The single most important reuse decision in the design (§3.1), made concrete: **no new bus, no new
delivery guarantee, no change to any publisher.** The bridge subscribes one handler to every
cataloged event — generated from the event catalogue, so automation listens to exactly what the
platform can emit, and a new module's events become automatable with no change here.

Because it is a plain consumer, it inherits the platform's tiers for free: a `reliable`-tier event
(business-critical, survives a crash via the outbox) reaches the bridge deduplicated on
`${eventId}:${handlerId}`; a best-effort event reaches it in-process. The bridge adds its own
execution-level idempotency on top (below).

## It never throws into the bus

`handleTriggerEvent` swallows its own errors. A provider outage, a bad filter, a full disk — none
may fail the delivery of a business event to its *other* consumers (ADR-018 decision 4: automation
is strictly downstream and degrades alone). A failure is logged; the event's other subscribers are
untouched.

## What a dispatch does

For each active workflow subscribed to the event:

1. **Filter** the payload (below). A miss records nothing — it is not a run that happened to do
   nothing, it is a run that never started.
2. **Create an execution row idempotently** — `createIfNew` on a unique `(eventId, workflowId)`
   index. A redelivered event (bus retry, two workers draining one message) cannot start a second
   run; the duplicate-key error *is* the idempotency, caught rather than pre-checked so there is no
   race window.
3. **Redact the input snapshot** (A-4) *before* it touches the collection. The snapshot is retained
   business data; a workflow that authenticates would otherwise leave its credential in the row.
4. **Dispatch through `automationService.trigger()`** — the A-0 seam, which never throws — running
   as the workflow's owner in the owner's branch (§7.2). The outcome (`running` / `skipped`, and
   the provider ref) is written back to the row.

A workflow with **no provider ref yet** — enabled before A-6 has pushed its graph — is recorded as
`skipped` rather than dropped or invented. "Enabled but not yet runnable" is a real state and the
execution list shows it.

## Filters are the run-time half of validation

A-3 already refused, at *save* time, a filter on a field the event does not declare. `filter-eval.ts`
is the *run*-time half: given a real payload, decide match. Pure, no I/O — the decision "does this
event fire this workflow?" is testable without a database.

It is the same restricted expression form ADR-011 mandates for workflow guards — field comparisons,
never code — so a filter can do nothing an attacker could turn into execution. Two deliberate
choices:

- **Equality tolerates the wire.** A filter authored in a form arrives as `'3'`; the payload
  carries `3`. Primitives compare by string form, so a numeric filter matches a numeric payload
  instead of silently never matching.
- **A bad comparison is a no-match, not a throw.** `gt` against a non-numeric value returns false.
  An exception on the dispatch path would drop the event for *every* workflow, which is a far worse
  failure than one filter not matching.

Empty filter list = matches everything (a trigger with no condition fires on every occurrence).

## The re-entrancy guard

An automation action may emit an event that re-triggers the same workflow; unbounded, `entity.updated
→ update entity` is an infinite loop writing to production. Every execution carries a **depth**. A
business event is depth 0; an event emitted *by* an automation action carries its originating
execution's depth + 1. Past `MAX_TRIGGER_DEPTH` (3) the bridge refuses to dispatch and records
nothing new — the loop ends there.

Depth *propagation* from automation-emitted events lands with the action surface (A-6); the guard
is enforced now so A-6 does not have to retrofit it into the dispatch path. Until then every real
dispatch is depth 0, and the guard is exercised by passing depth explicitly.

## Executions collection

`automation_executions`, introduced here as the row a dispatch produces. A-7 grows the lifecycle on
top — retry, cancel, per-node results, the stuck-execution sweep — on the same shape.

| Index | For |
|---|---|
| `ux_event_workflow` on `{trigger.eventId, workflowId}` (unique, partial) | idempotency; partial so manual/cron rows with no eventId don't collide on null |
| `ix_workflow_recent` on `{workflowId, createdAt:-1}` | a workflow's run history (A-7) |
| `ix_status_sweep` on `{status, createdAt}` | the stuck-execution sweep (A-7) |

Operational data: no soft-delete — an execution record is history, never "deleted".

## Known limit until A-6

Workflows created through the API carry `providerRef: null` until A-6 pushes their graph to a
provider, so on `main` today every dispatch records `skipped`. The bridge, filters, idempotency and
depth guard are all exercisable now (the integration test stands in for A-6 by setting a provider
ref directly); the actual provider run arrives with A-6.
