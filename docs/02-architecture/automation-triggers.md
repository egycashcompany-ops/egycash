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

## Asynchronous and retry-safe

The event handler does the **minimum synchronously — it enqueues one job** onto the `automation`
queue (added in A-1 for exactly this) and returns. The real work — resolve workflows, evaluate
filters, create runs, dispatch — happens in the **worker**, off the thread that delivered the
business event. Two reasons this matters:

- **Asynchrony.** A slow provider or a large fan-out must never run on the event-delivery path.
- **Retry.** The event bus marks a reliable event *processed before* calling the handler, so a
  failure inside the handler would never be retried by the bus. On the queue, BullMQ retries the
  job with exponential backoff (5 attempts), and the execution collection's unique index makes
  those retries idempotent. The job also carries `jobId = trigger_<eventId>`, so BullMQ dedups a
  redelivered event beneath the DB index — two layers.

The handler swallows its own errors: a failure even to *enqueue* degrades automation, never the
event's delivery to other consumers.

Wiring is declarative: the automation manifest declares the queue handler
(`jobHandlers: [{ queue: 'automation', jobName: 'automation.trigger', handler }]`), registered
generically at boot the same way `eventSubscriptions` are — a small platform seam added here
(`ModuleManifest.jobHandlers`) so a module can own a worker handler without the kernel importing it.

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

## The provider behind the seam — real n8n over HTTP

`automationService.trigger()` reaches whichever provider the deployment registered. A-5 adds the
**real n8n provider** next to the `null` one, so a dispatch can now leave the process as an
authenticated HTTP request to a running n8n — while everything above this line stays provider-blind.

Three pieces, each doing one job:

- **`N8nClient`** (`platform/automation/providers/n8n/n8n.client.ts`) — the single place ECMS
  speaks HTTP to n8n. Base URL from **`N8N_BASE_URL`** (never hardcoded; trailing slash trimmed),
  API key from **`N8N_API_KEY`** sent as `X-N8N-API-KEY` (never logged), per-request timeout
  (`N8N_TIMEOUT_MS`, default 30 s), and bounded retry (`N8N_MAX_RETRIES`) on transport failure and
  retryable statuses (`408/429/5xx`) — **never a 4xx**, which would fail identically. Each request
  also carries an `X-Request-Id` (correlation id) and an `Idempotency-Key` (the execution id, stable
  across BullMQ retries), held identical across the client's own retries so n8n sees one logical
  trigger. It is n8n-*workflow*-unaware: it sends a request and reports what happened. Every future
  consumer (HR, Fleet, Contracts, ATM — always *through* the provider seam, never importing the
  client) gets this one hardened transport rather than its own `fetch`.
- **`N8nAutomationProvider`** — implements the A-0 `AutomationProvider` interface. `dispatch()` POSTs
  the run to the workflow's webhook (`/webhook/<ref>`); `health()` reports reachability via
  `/healthz` without throwing. Its `capabilities` are declared **all-false**: workflow authoring,
  graph import/export, cancellation and per-node progress light up at A-6, and until then those
  methods reject with `N8nNotImplementedError` rather than pretending.

  Every request carries a **stable event envelope**, never a bare payload, so an n8n workflow can
  route on the type, dedup on the id, order on `occurredAt` and read the payload under a known
  schema version (ADR-008) — the same shape for every event ECMS emits:

  ```json
  {
    "eventId": "evt_…",
    "eventType": "hr.employee.created",
    "occurredAt": "2026-01-02T03:04:05.000Z",
    "correlationId": "req_…",
    "version": 1,
    "payload": { "…": "redacted business data" },
    "executionId": "ex_…",
    "actor": { "userId": "…", "branchId": "…" },
    "depth": 0
  }
  ```

  The envelope identity is threaded end to end — the event handler enqueues `id`/`type`/`occurredAt`/
  `schemaVersion`/`requestId`, and the worker rebuilds a faithful envelope for the provider, so a run
  dispatched minutes later off the queue still reports the *event's* time, not the worker's.
- **`registerN8nProvider()`** — opt-in. It installs the provider only when
  `AUTOMATION_PROVIDER=n8n` *and* **both** `N8N_BASE_URL` and `N8N_API_KEY` are set; miss either and
  it logs which is absent and leaves the `null` provider active, so nothing about the deployment
  changes and no business transaction fails over config. It does **not** probe n8n at boot — a slow
  or restarting n8n must never block or fail an ECMS deploy; the provider degrades per dispatch.

**Best-effort is preserved end to end.** If n8n is unreachable the client times out, the dispatch
propagates a failure into `automationService.trigger()` — which never throws — the execution row is
recorded `skipped`/`failed` with the reason, and the originating business transaction (long since
committed) is untouched. An n8n outage costs one logged trigger, never a business write.

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

The HTTP path to n8n is real and tested; what A-6 still owns is **registering** a workflow in n8n
so it has a webhook to hit. Workflows created through the API carry `providerRef: null` until then,
so on `main` today every dispatch records `skipped` — the bridge reaches `dispatchOne`, sees no ref
and stops before the n8n client. The bridge, filters, idempotency, depth guard and the n8n client
itself are all exercisable now (the integration test stands in for A-6 by setting a provider ref
directly; the client's unit tests exercise the transport against a stubbed `fetch`); the end-to-end
provider run against a live n8n arrives with A-6, when the conformance suite runs against it.
