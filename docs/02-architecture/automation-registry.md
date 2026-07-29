# Automation Registry — workflows and variables

**Layer 2 · `apps/api/src/modules/automation/`** · delivered by **A-3** · behind
`AUTOMATION_ENABLED` (default off)

The ECMS-side record of an automation: what it listens to, who it runs as, whether it is allowed
to run. The provider owns the graph; **this owns everything else**, and if the provider were
rebuilt from scratch tomorrow every workflow's identity, ownership, trigger and history would
survive here.

## The feature flag withholds the MANIFEST, not the routes

```ts
export const moduleManifests: ModuleManifest[] = [
  hrModule,
  ...(env.AUTOMATION_ENABLED ? [automationModule] : []),
];
```

With the flag off, nothing loads: no routes mounted, no permissions synced into the registry, no
event subscriptions. Gating at the route layer instead would leave `automation.*` permissions in
the role editor and a half-feature for someone to find. Flipping the flag registers the module at
the next boot like any other.

## A workflow runs as its owner

`ownerUserId` is not decoration — it bounds what the automation can do (ADR-018 §7.2). Three
consequences are implemented here rather than described:

- **`branchId` is denormalized from the owner at save time.** The dispatch lookup
  (`{trigger.event, status, branchId}`) runs on every published event; a join to `users` on that
  path would put a user read on the hot path of the whole platform.
- **A deactivated owner's active workflows are suspended**, via a subscription to
  `platform.user.statusChanged`. Offboarding somebody has to actually stop what they set in
  motion, or automation becomes a way for a revoked account to keep acting.
- **`suspended` is not `disabled`.** A human chose one; the platform imposed the other. Re-enabling
  a suspended workflow is refused until `workflow.transfer` gives it a live owner — and a transfer
  leaves it as a `draft`, because what it may now do has changed and a person should confirm that.

## Triggers are validated against the real event catalogue

This is what [the event catalogue](event-catalog.md) was built for. At **save** time:

| Refused | Why |
|---|---|
| An event no module publishes | The workflow would be enabled, green, and permanently inert |
| A filter field the payload does not carry | Matches nothing, forever |
| An enum value outside the declared set | Same, and it looks like a business rule |
| Filters on a schedule/manual trigger | No payload to filter — dead code that reads as a condition |

Warned, not refused: an event with **two publishers of different payload shapes** (a filter there
matches one cause and not the other), and an event declared with no publisher yet — saveable as a
draft for a team building ahead of the publisher.

**Enabling is stricter than saving.** `canEnableTrigger` refuses anything that would be silently
inert, because enabling is the moment a workflow starts touching production. Editing the trigger of
a *live* workflow drops it back to `draft`: re-pointing a running automation at a different event
changes what fires it, and that deserves a human.

`GET /workflows/:id/diagnostics` re-runs the same checks against a stored workflow, because a
workflow can go stale without being touched — the event it listens to may be deprecated after it
was written.

## Permissions

`workflow.enable` is separate from `workflow.edit`, and `workflow.transfer` from both. Authoring an
automation, deciding it may start running, and changing the principal it runs as are three
different acts with three different blast radii (§7.1).

## Variables are not secrets

`automation_variables` holds non-secret configuration a workflow reads at run time — a threshold,
an approver's address, a channel name — editable without touching the graph. Anything that must
not be readable cannot be a variable: secrets live in `automation_credentials` (A-4), sealed and
write-only.

Upsert is by `(key, scope, target)` rather than by id, because that is how a caller thinks about
it ("set `approverEmail` for this branch"), and a unique index enforces one row per triple. Without
it two rows for one key resolve in whatever order the index returns.

## Collections

| Collection | Notes |
|---|---|
| `automation_workflows` | `ux_key` (unique among live rows), `ix_dispatch` on `{trigger.event, status, branchId}` — the hot path — and `ix_owner` |
| `automation_variables` | `ux_scoped_key` on `{key, scope, branchId, workflowId}` |

Both are new. No migration; nothing existing is altered.

## Not here yet

Executions (A-7), credentials (A-4), the dispatch bridge that turns a published event into a run
(A-5), and the provider push that gives a workflow a `providerRef` (A-6). `providerRef` is `null`
for every workflow this slice creates, and the DTO's `lastRun` / `stats` report `null` and zeroes —
a stable shape reporting nothing, rather than invented numbers a UI would render as real.
