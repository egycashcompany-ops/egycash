# ADR-018: n8n as the Automation Engine, alongside (not replacing) the Workflow Engine

**Status:** Proposed · **Date:** 2026-07-29 · **Supersedes:** nothing · **Amends:** ADR-011 (§scope boundary)

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

1. **n8n runs as a separate Railway service**, reachable only from the ECMS API over the private
   network. It is never exposed to browsers directly; the ECMS Automation module proxies the
   builder UI behind ECMS authentication.
2. **The trigger path is the existing event bus** (ADR-008), reliable tier. Automation subscribes
   like any other module: outbox → BullMQ → idempotent handler → n8n webhook. No module learns that
   automation exists, and an automation outage cannot fail a business transaction.
3. **The action path is the existing REST API.** n8n calls ECMS back with a scoped service token
   that carries a real permission set and a branch scope. There is no privileged back door and no
   direct database access from n8n.
4. **ECMS owns the registry**; n8n owns the graph. `automation_workflows` holds identity,
   ownership, branch scope, enablement, and the n8n workflow id. This is what makes RBAC, branch
   isolation and audit possible at all — n8n Community has no tenancy model to borrow.
5. **Secrets stay in ECMS.** Credentials are stored encrypted in `automation_credentials` and
   injected into an execution at dispatch time. n8n's own credential store is not used for
   ECMS-managed secrets, so there is exactly one place a secret can leak from and one place to
   rotate it.

## Consequences

- ✅ Every module becomes automatable without any module code changing — the event catalogue is
  already the integration surface.
- ✅ Business users get a visual builder and a connector library that would take years to write.
- ✅ The blast radius is bounded: automation is downstream of commit, behind a queue, on its own
  service, with its own token.
- ⚠️ **Licensing is a business decision, not a technical one.** n8n is fair-code under the
  Sustainable Use License, not OSI open source. Internal automation inside ECMS is permitted;
  offering n8n's own builder to third parties as a service is not. If ECMS is ever sold as a
  platform where customers author their own automations, this needs legal review and possibly an
  n8n Embed licence. **This must be confirmed before implementation starts.**
- ⚠️ A second runtime to operate, upgrade and back up.
- ⚠️ n8n Community has no multi-tenancy. Branch isolation is enforced entirely at the ECMS boundary
  (registry + token scope). A workflow author who can reach n8n directly bypasses it — hence the
  proxy-only rule in decision 1, which is load-bearing rather than cosmetic.
- ⚠️ AI actions send ECMS data to third-party model providers. That is a data-egress decision
  distinct from this ADR; see the design document §8 for the policy gate it requires.

## Alternatives considered

- **Extend the Workflow Engine with outbound actions.** Rejected: it would put HTTP calls, retries
  and connector maintenance on the entity write path, and turn a state machine into an integration
  bus. The failure modes are different and should stay separated.
- **A native action runner (no n8n).** A real option, and the fallback if the licence review fails.
  Gives full control and no second runtime, but no visual builder and no connector library — every
  integration becomes bespoke code, which is the problem being solved.
- **Zapier/Make (hosted).** Rejected: ECMS data would leave the deployment for a third-party SaaS
  on every trigger, which is incompatible with the platform's data-residency posture.
