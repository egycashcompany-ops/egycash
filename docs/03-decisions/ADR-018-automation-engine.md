# ADR-018: A provider-backed Automation Service, alongside (not replacing) the Workflow Engine

**Status:** Accepted · **Date:** 2026-07-29 · **Supersedes:** nothing · **Amends:** ADR-011 (§scope boundary)

> **Revision 1 (2026-07-29, approver).** Three changes to the Proposed text, all tightening the
> boundary: business modules may never reach n8n — or any provider — directly; the engine sits
> behind an `AutomationProvider` interface so the provider is replaceable; and the licensing
> question is resolved (§Licensing). The decision is no longer "adopt n8n" but "adopt a provider
> seam, whose first implementation is n8n."

## Context

ECMS modules need to cause effects **outside their own data**: message a driver on WhatsApp when a
vehicle is assigned, push an invoice to an accounting system, ask a model to summarise a contract,
post to Teams when a purchase request is approved. Today each of those would be bespoke code in the
module that happens to notice the event.

ADR-011 already established a **Workflow Engine**: versioned definitions as data, states,
transitions, guards, approvals, SLA timers. It explicitly **rejected embedding an external BPMN
engine** (Camunda/Zeebe) as "a heavyweight external dependency and modeling language for processes
that are, in practice, guarded state machines."

That rejection was correct and it still stands. The question this ADR answers is different: those
two engines are not the same engine, and the reasoning that rejects Camunda does not automatically
reject n8n — but it does not automatically permit it either.

## The distinction that makes both defensible

| | Workflow Engine (ADR-011) | Automation Engine (this ADR) |
|---|---|---|
| Owns | **Entity state** — what stage a contract/requisition is in | **Side effects** — what happens elsewhere because something happened here |
| Data | Definitions + instances in ECMS collections | Workflow graphs in n8n; ECMS holds the registry |
| Failure mode | An entity is stuck in a state | An outbound action did not fire |
| On the write path? | **Yes** — a transition is part of the business transaction | **No** — always downstream of a committed event |
| Audience | Business admins configuring an approval chain | Automation authors wiring systems together |
| If it is down | Approvals stop | Notifications are delayed and retried |

**The hard rule this ADR sets: the Automation Engine may never be the authority on entity state.**
A workflow may *call* an ECMS API that performs a state transition — through the same permissioned,
audited endpoint a human would use — but the transition is still executed and recorded by the
Workflow Engine. n8n is never asked "what state is this in", and no ECMS read path depends on it.

Camunda was rejected because it wanted to own the state machine. n8n is accepted because it is
explicitly forbidden from owning it.

## Decision

1. **An Automation Service is the only door.** A platform service `platform/automation/` sits
   between business modules and every automation runtime. Business modules depend on its contracts
   and never on a provider:

   ```
   ECMS modules ─▶ Automation Service ─▶ AutomationProvider ─▶ n8n / AI / email / WhatsApp / …
   ```

   No module imports an n8n client, knows an n8n URL, or handles an n8n type. A module that wants
   to trigger something calls `automationService.trigger(...)`. This is the same seam discipline
   ADR-003 already applies to Files, Notifications and OCR.

2. **The engine is behind an interface, not wired in.** `AutomationProvider` declares the runtime's
   contract — create/update/enable a workflow, dispatch, cancel, inspect an execution, import and
   export a graph, report health and *capabilities*. `N8nAutomationProvider` is the first
   implementation. A `NullAutomationProvider` backs the feature flag being off. Future providers
   (native runner, Temporal, Camunda) are new implementations, not a migration of every module.

   Capabilities are declared rather than assumed: a provider that has no visual builder reports
   `visualBuilder: false` and the UI adapts, instead of the platform hard-coding that a builder
   exists.

3. **n8n runs as a separate Railway service**, reachable only from the ECMS API over the private
   network. It is never exposed to browsers directly; the Automation Service proxies the builder UI
   behind ECMS authentication.

4. **The trigger path is the existing event bus** (ADR-008), reliable tier. The Automation Service
   subscribes like any other consumer: outbox → BullMQ → idempotent handler → provider dispatch. No
   module learns that automation exists, and an automation outage cannot fail a business
   transaction.

5. **The action path is the existing REST API.** The provider calls ECMS back with a scoped service
   token carrying a real permission set and branch scope. There is no privileged back door and no
   direct database access from any provider.

6. **ECMS owns the registry**; the provider owns the graph. `automation_workflows` holds identity,
   ownership, branch scope, enablement, and the opaque provider reference. This is what makes RBAC,
   branch isolation and audit possible at all — n8n Community has no tenancy model to borrow, and
   neither will most alternatives.

7. **Secrets stay in ECMS.** Credentials are stored encrypted in `automation_credentials` and
   injected into an execution at dispatch time. A provider's own credential store is not used for
   ECMS-managed secrets, so there is exactly one place a secret can leak from and one place to
   rotate it.

8. **Templates are data, not code.** Workflow templates are versioned, signed packages that are
   imported and exported at runtime; they are never compiled into the application and never require
   a deployment to change. See the design document §11.

## Consequences

- ✅ Every module becomes automatable without any module code changing — the event catalogue is
  already the integration surface.
- ✅ Business users get a visual builder and a connector library that would take years to write.
- ✅ The blast radius is bounded: automation is downstream of commit, behind a queue, on its own
  service, with its own token.
- ✅ The provider is replaceable without touching a single business module — which is what makes
  the licensing position below a *contained* risk rather than a structural one.
- ⚠️ A second runtime to operate, upgrade and back up.
- ⚠️ n8n Community has no multi-tenancy. Branch isolation is enforced entirely at the ECMS boundary
  (registry + token scope). A workflow author who can reach n8n directly bypasses it — hence the
  proxy-only rule in decision 1, which is load-bearing rather than cosmetic.
- ⚠️ AI actions send ECMS data to third-party model providers. That is a data-egress decision
  distinct from this ADR; see the design document §8 for the policy gate it requires.

## Licensing (resolved, Revision 1)

n8n is fair-code under the **Sustainable Use License**, not OSI open source. The licence permits
internal business use and forbids offering n8n's own functionality to third parties as a service.

**The approver has confirmed ECMS is an internal enterprise system for a single company, not a
multi-tenant SaaS product, and that ECMS is not being built as a workflow platform for external
customers.** Under that scope the Community edition is used within its licence.

This is recorded rather than assumed because it is a *scope* condition, not a permanent property.
If ECMS is later offered to other companies as a product in which they author their own
automations, this ADR must be revisited — and decision 2 is what makes that revisit cheap: an n8n
Embed licence, or swapping `N8nAutomationProvider` for a native one, without touching a business
module.

## Alternatives considered

- **Extend the Workflow Engine with outbound actions.** Rejected: it would put HTTP calls, retries
  and connector maintenance on the entity write path, and turn a state machine into an integration
  bus. The failure modes are different and should stay separated.
- **Wire n8n in directly, without a provider seam.** Rejected in Revision 1. Cheaper by perhaps one
  PR, and it would put an n8n dependency in every module that ever automates anything — making the
  licensing condition above a structural risk instead of a contained one.
- **A native action runner instead of n8n.** No longer the fallback; it is now simply *another
  provider* that can be added later. Full control and no second runtime, but no visual builder and
  no connector library.
- **Zapier/Make (hosted).** Rejected: ECMS data would leave the deployment for a third-party SaaS
  on every trigger, which is incompatible with the platform's data-residency posture.

## Honest limit of the abstraction

The seam makes the *platform* provider-independent. It does not make **workflow graphs** portable:
a graph authored in n8n is n8n's format, and a future provider would need its own graphs. What
survives a provider swap is every module, the registry, permissions, credentials, executions,
audit, scheduling and the UI. What would be rebuilt is the library of graphs. That is the right
trade — graphs are data an operator can re-author, module coupling is not — but it should not be
sold as more than it is.
