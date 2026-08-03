# Automation Service

**Layer 1 (platform) · `apps/api/src/platform/automation/`**
Governed by [ADR-018](../03-decisions/ADR-018-automation-engine.md) and
[the Automation module design](../12-planning/automation-module-design.md) (FROZEN, Revision 1).

The seam between ECMS and whatever runtime executes automations. Delivered by **A-0**; the first
real provider (n8n) arrives at **A-6**, behind this contract.

```
ECMS modules ─▶ Automation Service ─▶ AutomationProvider ─▶ n8n / AI / email / WhatsApp / …
```

## What a module may import

One thing:

```ts
import { automationService } from '../../platform/automation';

const outcome = await automationService.trigger({
  workflow: ref,
  executionId,
  payload,
  actor: { userId, branchId },
});
```

Anything deeper — `platform/automation/providers/**`, `automation.registry`, a provider module —
is **a lint error**, enforced by `no-restricted-imports` in `eslint.config.js`. This is a rule, not
a convention: ADR-018 permits n8n on a *scope condition* (ECMS is internal to one company), and a
condition that can change must not be load-bearing in twenty modules.

## Two properties the service guarantees

**1. `trigger()` never throws.** Automation is strictly downstream of a committed transaction. A
provider being unreachable returns `{ dispatched: false, reason }` and logs; it never propagates
into a caller's business write. If this is ever "simplified" into a throwing call, a module's write
starts failing because an integration runtime is down — which is precisely the coupling ADR-018
forbids.

**2. Capabilities are asked, not assumed.** `AutomationCapabilities` is declared by every provider.
Anything gated on one rejects with `AutomationCapabilityError` rather than calling an optional
method that may not exist. A provider with no visual builder reports `visualBuilder: false` and the
UI hides the affordance instead of rendering a broken frame.

Every capability-gated method is `async`, deliberately: a method typed `Promise<T>` that throws
*synchronously* is a footgun, because `service.cancel(ref).catch(…)` never runs the catch.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `AUTOMATION_ENABLED` | `false` | `false` ⇒ the null provider stays installed, dispatches record as `skipped`, and the module's navigation entry is hidden |
| `AUTOMATION_PROVIDER` | `null` | Which provider `setAutomationProvider` will accept. `n8n` from A-6 |

The registry **refuses** a provider while the flag is off, and refuses one that is not the
configured id. That is what lets slices A-0 … A-13 merge to `main` without a user seeing a
half-built feature — a provider that installed itself anyway would make the flag advisory.

## The null provider is not a test double

It runs in production until the flag flips. Its one interesting behaviour: a dispatch is recorded
as `skipped`, **not** silently dropped and **not** reported as `success`. "The automation did not
run because automation is off" and "the automation ran and did nothing" are different facts, and an
operator reading an execution list has to be able to tell them apart.

## Adding a provider

1. Implement `AutomationProvider` under `providers/<id>/`.
2. Declare capabilities honestly — the platform believes them.
3. Run the shared contract against it, in the provider's own spec file:

   ```ts
   import { runProviderConformance } from '../../provider-conformance';
   runProviderConformance(() => myProvider, 'MyProvider');
   ```

   Import the file directly — never via the barrel. The barrel is loaded by every runtime
   entrypoint (server, worker, seeds), and the conformance suite imports `vitest`, which throws
   at import time outside a vitest run. Spec files inside `platform/automation/**` are exempt
   from the barrel-only lint rule, so the direct import is legal exactly where it is needed.

4. Register it at boot from its own module (the provider registers *itself*; the registry never
   imports providers, so it never grows a `switch` over every provider that will exist).
5. Add the id to `AUTOMATION_PROVIDER_IDS` in contracts.

**`runProviderConformance` is shipped code, not a spec file.** A TypeScript interface proves a
provider has the right method *names*; it proves nothing about behaviour, and behaviour is where a
second provider actually diverges — a ref that does not round-trip, a throw on a capability already
declared false, a status the platform has no case for. Those surface as "automation is broken"
months later. Sharing the suite means A-6's n8n provider is proved by the same assertions the
null provider is proved by today, and a provider added later cannot quietly hold a weaker contract
than the one reviewed here.

## What the seam does and does not buy

**Provider-independent:** every module, the registry, permissions, credentials, executions, audit,
scheduling, the UI.

**Not portable:** workflow **graphs**. A graph authored in n8n is n8n's format — hence
`WorkflowGraph.providerId` and the service's refusal to import a graph belonging to a different
provider (half-succeeding and failing at run time is worse than refusing). A provider swap would
mean re-authoring the graph library. That is the right trade — graphs are data an operator can
re-author, module coupling is not — but it is stated rather than implied. See ADR-018 §Honest
limit.
